"""The Transactions page (task 1.5, specs § 12): every expense and payment across the viewer's spaces, newest first.

What the list holds: every expense in the viewer's spaces, and the payments the viewer is part of (paid or received).
A space the viewer has left is not in it. Filters: all, expenses, payments, and one space.

The order, the same for every page and for both kinds of row:
  1. newest first, by the moment a row takes in the list: a payment's `created_at`, and for an expense the midnight (UTC)
     that starts its `date`. So a payment made at noon comes before an expense dated that day;
  2. at exactly the same moment, a payment before an expense;
  3. then the higher id first.

Paging is by marker, not by offset, so a row added or deleted between two requests cannot shift or repeat a row. The
marker is `<microseconds since 1970>.<0 for a payment or 1 for an expense>.<id>` of the last row of the page. The two
tables are each read in their own order, `limit + 1` rows from each, after the marker, and merged. The first
`limit + 1` of the merge are exactly the next page and one row more, which says whether there is another page.
"""

import datetime as dt
import re

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.models.expense import Expense
from app.models.payment import Settlement
from app.models.user import User
from app.schemas.group import SettlementRow
from app.schemas.transaction import ExpenseTransaction, PaymentTransaction, TransactionListOut, TransactionSpace
from app.schemas.user import UserSummary
from app.services import balance_service, expense_service
from app.services.space_access import member_space
from app.utils.errors import field_error

PAYMENT, EXPENSE = 0, 1  # the kind in a marker, and the order of a tie: a payment before an expense
EPOCH = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)
# Explicit ASCII digits: a bare `\d` also matches digits of other scripts.
MARKER = re.compile(r"^([0-9]{1,18})\.([01])\.([0-9]{1,10})$")  # microseconds since 1970 . kind . id


def _micros(when: dt.datetime) -> int:
    """Whole microseconds since 1970: an exact integer, so there is no float to round."""
    return (when - EPOCH) // dt.timedelta(microseconds=1)


def _expense_at(day: dt.date) -> dt.datetime:
    """The moment an expense takes in the list: the midnight (UTC) that starts its day."""
    return dt.datetime(day.year, day.month, day.day, tzinfo=dt.timezone.utc)


def _parse_marker(before: str) -> tuple[dt.datetime, int, int]:
    """(moment, kind, id) of the row a page ended on. Anything that is not a marker from this list is a 422."""
    try:
        match = MARKER.fullmatch(before)
        if match is None:
            raise ValueError
        at = EPOCH + dt.timedelta(microseconds=int(match.group(1)))  # a huge number is past the last date there is
    except (ValueError, OverflowError):
        raise field_error("before", "That is not a page marker from this list") from None
    return at, int(match.group(2)), int(match.group(3))


def _expenses_after(marker: tuple[dt.datetime, int, int]):
    """What comes after the marker, for the expense table (which is read by date, then id, newest first)."""
    at, kind, row_id = marker
    day = at.date()
    if kind == PAYMENT or at != _expense_at(day):
        # The marked row is a payment, or is later in its day than midnight: every expense of that day is still to come.
        return Expense.date <= day
    return or_(Expense.date < day, and_(Expense.date == day, Expense.id < row_id))


def _payments_after(marker: tuple[dt.datetime, int, int]):
    """What comes after the marker, for the payment table (which is read by moment, then id, newest first)."""
    at, kind, row_id = marker
    if kind == EXPENSE:  # a payment at the very same moment would already have been shown
        return Settlement.created_at < at
    return or_(Settlement.created_at < at, and_(Settlement.created_at == at, Settlement.id < row_id))


def list_transactions(
    db: Session, user: User, kind: str, space_id: int | None, before: str | None, limit: int
) -> TransactionListOut:
    """One page of the viewer's transactions. `kind` is "all", "expenses" or "payments"."""
    marker = _parse_marker(before) if before is not None else None
    me = user.username
    spaces = balance_service.spaces_of(db, me)
    if space_id is not None:
        member_space(db, me, space_id)  # a space you are not in does not exist for you: 404
        spaces = [s for s in spaces if s.id == space_id]
    by_id = {s.id: s for s in spaces}
    space_ids = list(by_id)

    # (moment, kind, id, the rows of that kind, the space): the first three are what the merge sorts by.
    entries: list[tuple] = []
    if kind != "payments" and space_ids:
        stmt = expense_service.expense_select(me).where(Expense.space_id.in_(space_ids))
        if marker is not None:
            stmt = stmt.where(_expenses_after(marker))
        rows = db.execute(stmt.order_by(Expense.date.desc(), Expense.id.desc()).limit(limit + 1)).all()
        entries += [(_expense_at(row[0].date), EXPENSE, row[0].id, row, by_id[row[0].space_id]) for row in rows]
    if kind != "expenses" and space_ids:
        stmt = select(Settlement).where(
            Settlement.space_id.in_(space_ids), or_(Settlement.payer == me, Settlement.payee == me)
        )  # only payments the viewer is part of
        if marker is not None:
            stmt = stmt.where(_payments_after(marker))
        payments = db.scalars(stmt.order_by(Settlement.created_at.desc(), Settlement.id.desc()).limit(limit + 1)).all()
        entries += [(p.created_at, PAYMENT, p.id, p, by_id[p.space_id]) for p in payments]

    entries.sort(key=lambda e: (-_micros(e[0]), e[1], -e[2]))  # newest first, then payment before expense, then higher id
    window = entries[: limit + 1]
    page = window[:limit]

    usernames: set[str] = set()
    for _, entry_kind, _, row, _ in page:
        if entry_kind == EXPENSE:
            usernames |= {row[0].paid_by, row[0].created_by}
        else:
            usernames |= {row.payer, row.payee}
    names = dict(db.execute(select(User.username, User.name).where(User.username.in_(usernames))).all()) if usernames else {}

    def person(username: str) -> UserSummary:
        return UserSummary(username=username, name=names.get(username, username))

    items = []
    for _, entry_kind, _, row, space in page:
        where = TransactionSpace(space_id=space.id, space_name=space.name, currency=space.currency)
        if entry_kind == EXPENSE:
            card = expense_service.expense_row(*row, names)
            items.append(ExpenseTransaction(**card.model_dump(), **where.model_dump()))
        else:
            payment = SettlementRow(
                id=row.id,
                from_user=person(row.payer),
                to_user=person(row.payee),
                amount_minor=row.amount_minor,
                status=row.status,
                created_at=row.created_at,
                answered_at=row.answered_at,
            )
            items.append(PaymentTransaction(**payment.model_dump(), **where.model_dump()))

    next_before = None
    if len(window) > limit:  # one more row exists: the marker is where this page ended
        when, last_kind, last_id, _, _ = page[-1]
        next_before = f"{_micros(when)}.{last_kind}.{last_id}"
    return TransactionListOut(items=items, next_before=next_before)
