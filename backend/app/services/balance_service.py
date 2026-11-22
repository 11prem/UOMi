"""Balance maths for the Home page cards and the Group page ("You owe ₹100", who owes whom).

Everything is pairwise: how much one person owes one other person in one space.
  - A share counts when its expense is not disputed (no share on it is rejected). The share's own
    status is then pending or accepted, so waiting for a tick does not hide it.
  - The payer's own share never counts.
  - A settlement counts only when it is confirmed. Paying someone back cancels what you owed them,
    and paying too much flips the pair.

A pair is keyed `(a, b)` with `a < b`; a value above 0 means b owes a. `side_of` turns that into
one person's view: other person -> amount, positive when they owe the viewer.

Every amount here is an integer in minor units (paise, cents).
"""

from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime
from itertools import chain

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.expense import Expense
from app.models.expense_split import ExpenseShare, ShareStatus
from app.models.group import Space
from app.models.group_member import SpaceMember
from app.models.payment import Settlement, SettlementStatus
from app.models.user import User
from app.schemas.group import OverallLine, SpaceCard

Pairs = dict[tuple[str, str], int]


def _nets(db: Session, space_ids: list[int]) -> dict[int, Pairs]:
    """The non-zero pairs of every given space, using two grouped queries in total."""
    nets: dict[int, Pairs] = {space_id: {} for space_id in space_ids}
    if not space_ids:
        return nets

    def add(space_id: int, debtor: str, creditor: str, amount: int) -> None:
        """`debtor` owes `creditor` this much more (a negative amount means less)."""
        key = (creditor, debtor) if creditor < debtor else (debtor, creditor)
        nets[space_id][key] = nets[space_id].get(key, 0) + (amount if debtor > creditor else -amount)

    disputed = select(ExpenseShare.expense_id).where(ExpenseShare.status == ShareStatus.REJECTED)
    shares = db.execute(
        select(Expense.space_id, ExpenseShare.username, Expense.paid_by, func.sum(ExpenseShare.amount_minor))
        .select_from(ExpenseShare)
        .join(Expense, Expense.id == ExpenseShare.expense_id)
        .where(
            Expense.space_id.in_(space_ids),
            Expense.id.not_in(disputed),
            ExpenseShare.username != Expense.paid_by,
        )
        .group_by(Expense.space_id, ExpenseShare.username, Expense.paid_by)
    )
    for space_id, debtor, creditor, total in shares:
        add(space_id, debtor, creditor, total)

    payments = db.execute(
        select(Settlement.space_id, Settlement.payer, Settlement.payee, func.sum(Settlement.amount_minor))
        .where(Settlement.space_id.in_(space_ids), Settlement.status == SettlementStatus.CONFIRMED)
        .group_by(Settlement.space_id, Settlement.payer, Settlement.payee)
    )
    for space_id, payer, payee, total in payments:
        add(space_id, payer, payee, -total)

    return {space_id: {key: v for key, v in pairs.items() if v} for space_id, pairs in nets.items()}


def pairwise(db: Session, space_id: int) -> Pairs:
    """Who owes whom in one space, netted per pair. Pairs that cancel out are left out."""
    return _nets(db, [space_id])[space_id]


def side_of(pairs: Pairs, username: str) -> dict[str, int]:
    """One person's view of the pairs: other username -> amount, positive when they owe `username`."""
    side: dict[str, int] = {}
    for (a, b), amount in pairs.items():
        if username == a:
            side[b] = amount
        elif username == b:
            side[a] = -amount
    return side


def viewer_pairs(db: Session, space_id: int, username: str) -> dict[str, int]:
    return side_of(pairwise(db, space_id), username)


def spaces_of(db: Session, username: str) -> list[Space]:
    """The spaces `username` is in."""
    return list(
        db.scalars(
            select(Space)
            .join(SpaceMember, SpaceMember.space_id == Space.id)
            .where(SpaceMember.username == username)
            .order_by(Space.id.desc())
        )
    )


def _last_activity(db: Session, spaces: Iterable[Space]) -> dict[int, datetime]:
    """The latest of a space's creation, its expenses' updates and its settlements' creation/answer."""
    latest = {space.id: space.created_at for space in spaces}
    ids = list(latest)
    expenses = db.execute(
        select(Expense.space_id, func.max(Expense.updated_at))
        .where(Expense.space_id.in_(ids))
        .group_by(Expense.space_id)
    )
    settlements = db.execute(
        select(Settlement.space_id, func.max(Settlement.created_at), func.max(Settlement.answered_at))
        .where(Settlement.space_id.in_(ids))
        .group_by(Settlement.space_id)
    )
    for space_id, *stamps in chain(expenses, settlements):
        latest[space_id] = max([latest[space_id], *(s for s in stamps if s)])
    return latest


def space_cards(db: Session, spaces: list[Space], username: str) -> list[SpaceCard]:
    """One Home page card per space, in the order given, from a fixed number of queries."""
    if not spaces:
        return []
    ids = [space.id for space in spaces]
    sides = {space_id: side_of(pairs, username) for space_id, pairs in _nets(db, ids).items()}
    member_counts = dict(
        db.execute(
            select(SpaceMember.space_id, func.count())
            .where(SpaceMember.space_id.in_(ids))
            .group_by(SpaceMember.space_id)
        ).all()
    )
    activity = _last_activity(db, spaces)

    def counterparties(side: dict[str, int]) -> list[str]:
        """The people on the side of the net: whoever the viewer owes when it is negative,
        whoever owes the viewer when it is positive, nobody when it is zero."""
        net = sum(side.values())
        direction = (net > 0) - (net < 0)
        return [other for other, amount in side.items() if amount * direction > 0]

    people = {space_id: counterparties(side) for space_id, side in sides.items()}
    wanted = {names[0] for names in people.values() if len(names) == 1}
    full_names = (
        dict(db.execute(select(User.username, User.name).where(User.username.in_(wanted))).all())
        if wanted
        else {}
    )

    return [
        SpaceCard(
            id=space.id,
            name=space.name,
            icon=space.icon,
            currency=space.currency,
            member_count=member_counts[space.id],
            balance_minor=sum(sides[space.id].values()),
            open_balances=len(sides[space.id]),
            counterparty_name=full_names[people[space.id][0]] if len(people[space.id]) == 1 else None,
            counterparty_count=len(people[space.id]),
            last_activity_at=activity[space.id],
        )
        for space in spaces
    ]


def space_card(db: Session, space: Space, username: str) -> SpaceCard:
    return space_cards(db, [space], username)[0]


def overall(db: Session, username: str) -> list[OverallLine]:
    """What `username` owes and is owed across their spaces, one line per currency.

    owe = every negative pair added up, owed = every positive pair added up (so a pair is never
    netted against a different person). Currencies with nothing owed either way are left out."""
    spaces = spaces_of(db, username)
    nets = _nets(db, [space.id for space in spaces])
    owe: defaultdict[str, int] = defaultdict(int)
    owed: defaultdict[str, int] = defaultdict(int)
    for space in spaces:
        for amount in side_of(nets[space.id], username).values():
            if amount < 0:
                owe[space.currency] -= amount
            else:
                owed[space.currency] += amount
    return [
        OverallLine(currency=c, net_minor=owed[c] - owe[c], owe_minor=owe[c], owed_minor=owed[c])
        for c in sorted(owe.keys() | owed.keys())
    ]
