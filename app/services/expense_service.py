"""Expenses (task 1.3): add, edit, delete, the tick and the cross, the detail screen and the paged list.

Rules the server enforces itself, because a server that trusts the app is not safe:
  - Only people in the space can see or add an expense (a space you are not in is a 404, never a 403).
  - The server works out every share with the app's rounding rule (split_service), and refuses a split that does
    not add up. The payer's share, and the creator's, are accepted at once; everyone else is asked.
  - Only the person a share belongs to can answer it. Only the creator can edit or delete the expense.
  - Every change and the cards it sends are saved in one transaction, or not at all.
"""

from decimal import Decimal

from sqlalchemy import and_, delete, exists, select, update
from sqlalchemy.orm import Session, aliased

from app.currencies import format_money
from app.database import utcnow
from app.models.expense import Expense, SplitType
from app.models.expense_split import ExpenseShare, ShareStatus
from app.models.group import Space
from app.models.group_member import SpaceMember
from app.models.notification import Notification, NotificationType
from app.models.reminder import Reminder
from app.models.user import User
from app.schemas.expense import ExpenseDetailOut, ExpenseListOut, ExpenseWrite, ShareOut
from app.schemas.group import ExpenseRow, MemberOut, SpaceHeader
from app.schemas.user import UserSummary
from app.services import split_service
from app.services.notification_service import create_notification
from app.services.space_access import first_name, lock_space, member_space, person
from app.utils.errors import api_error, field_error, forbidden

Row = tuple[str, int, Decimal | None]  # username, what they owe, what was typed for them


def expense_select(viewer: str):
    """The select behind every expense card: (the expense, the viewer's share, its answer, is it disputed).

    Add the `where` (which space or spaces) and the `order_by` yourself. The viewer's own share is joined in when
    they have one, and `disputed` is true when anyone rejected their share.
    """
    mine = aliased(ExpenseShare)  # the viewer's own share of each expense, if they have one
    disputed = exists().where(ExpenseShare.expense_id == Expense.id, ExpenseShare.status == ShareStatus.REJECTED)
    return (
        select(Expense, mine.amount_minor, mine.status, disputed.label("disputed"))
        .select_from(Expense)
        .outerjoin(mine, and_(mine.expense_id == Expense.id, mine.username == viewer))
    )


def expense_row(expense: Expense, my_share, my_status, is_disputed, names: dict[str, str]) -> ExpenseRow:
    """One row of `expense_select`, as the card the app shows. `names` maps username to name."""

    def who(username: str) -> UserSummary:
        return UserSummary(username=username, name=names.get(username, username))

    return ExpenseRow(
        id=expense.id,
        description=expense.description,
        amount_minor=expense.amount_minor,
        split_type=expense.split_type,
        paid_by=who(expense.paid_by),
        created_by=who(expense.created_by),
        date=expense.date,
        created_at=expense.created_at,
        updated_at=expense.updated_at,
        my_share_minor=my_share,
        my_share_status=my_status,
        disputed=is_disputed,
    )


def expense_rows(
    db: Session, space_id: int, viewer: str, names: dict[str, str], limit: int, before: int | None = None
) -> list[ExpenseRow]:
    """The expense cards of a space, newest first, each with the viewer's own share. `before` is an expense id."""
    stmt = expense_select(viewer).where(Expense.space_id == space_id)
    if before is not None:
        stmt = stmt.where(Expense.id < before)
    rows = db.execute(stmt.order_by(Expense.id.desc()).limit(limit)).all()
    return [expense_row(expense, my_share, my_status, is_disputed, names) for expense, my_share, my_status, is_disputed in rows]


def list_expenses(db: Session, user: User, space_id: int, before: int | None, limit: int) -> ExpenseListOut:
    """Every expense of a space, page by page, so a space with more than 50 is fully reachable."""
    member_space(db, user.username, space_id)
    names = dict(
        db.execute(
            select(SpaceMember.username, User.name)
            .select_from(SpaceMember)
            .join(User, User.username == SpaceMember.username)
            .where(SpaceMember.space_id == space_id)
        ).all()
    )
    rows = expense_rows(db, space_id, user.username, names, limit + 1, before)  # one extra row says there is more
    page = rows[:limit]
    return ExpenseListOut(items=page, next_before=page[-1].id if len(rows) > limit else None)


def get_expense(db: Session, user: User, expense_id: int) -> ExpenseDetailOut:
    expense, space = _expense_of(db, user.username, expense_id)
    return _detail(db, expense, space)


def create_expense(db: Session, user: User, space_id: int, data: ExpenseWrite) -> ExpenseDetailOut:
    space = member_space(db, user.username, space_id, lock=True)
    rows = _prepare(db, space, data)
    expense = Expense(
        space_id=space.id,
        paid_by=data.paid_by,
        created_by=user.username,
        description=data.description,
        amount_minor=data.amount_minor,
        split_type=data.split_type,
        date=data.date,
    )
    db.add(expense)
    db.flush()  # fills in expense.id
    _save_shares(db, expense, space, rows)
    db.commit()  # the expense, its shares and the cards are saved together, or not at all
    return _detail(db, expense, space)


def update_expense(db: Session, user: User, expense_id: int, data: ExpenseWrite) -> ExpenseDetailOut:
    """Saving an edit asks everyone again: every answer is reset and everyone in the split gets a fresh card."""
    expense, space = _expense_of(db, user.username, expense_id, lock=True)
    if expense.created_by != user.username:
        raise forbidden("not_creator", "Only the person who added this expense can change it")
    rows = _prepare(db, space, data)  # everything is checked before anything changes

    _clear_answers(db, expense.id)
    # The old question cards go; what people said ("share_rejected") stays in the creator's history.
    _clear_cards(db, expense.id, (NotificationType.EXPENSE_SHARE,))
    expense.description = data.description
    expense.amount_minor = data.amount_minor
    expense.paid_by = data.paid_by
    expense.split_type = data.split_type
    expense.date = data.date
    expense.updated_at = utcnow()  # set by hand: an edit that changes nothing must still move it
    db.flush()
    _save_shares(db, expense, space, rows)
    db.commit()
    return _detail(db, expense, space)


def delete_expense(db: Session, user: User, expense_id: int) -> None:
    """Balances recalculate, and no card is left asking about an expense that is gone."""
    expense, _ = _expense_of(db, user.username, expense_id, lock=True)
    if expense.created_by != user.username:
        raise forbidden("not_creator", "Only the person who added this expense can delete it")
    _clear_answers(db, expense.id)
    _clear_cards(db, expense.id, (NotificationType.EXPENSE_SHARE, NotificationType.SHARE_REJECTED))
    db.delete(expense)
    db.commit()


def answer_share(db: Session, user: User, expense_id: int, verdict: ShareStatus) -> ExpenseDetailOut:
    """The tick (accept) or the cross (reject) on your own share.

    You may change your mind: rejecting disputes the expense and tells its creator (every time you reject),
    accepting again lifts the dispute. Giving the answer you already gave changes nothing.
    """
    expense, space = _expense_of(db, user.username, expense_id, lock=True)
    share = db.scalar(
        select(ExpenseShare).where(ExpenseShare.expense_id == expense.id, ExpenseShare.username == user.username)
    )
    if share is None:
        raise forbidden("not_your_share", "Only the person a share belongs to can answer it")
    if user.username in (expense.paid_by, expense.created_by):
        raise forbidden("own_share", "Your own share is accepted automatically")
    if share.status == verdict:
        return _detail(db, expense, space)

    # Claimed with one conditional UPDATE: of several requests giving the same answer at the same moment, exactly one
    # changes the share and sends the card, and the rest change nothing (as the docs promise).
    claimed = db.execute(
        update(ExpenseShare)
        .where(ExpenseShare.id == share.id, ExpenseShare.status != verdict)
        .values(status=verdict, responded_at=utcnow())
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        db.rollback()
        return _detail(db, expense, space)
    db.execute(  # the question on the original card is answered
        update(Notification)
        .where(
            Notification.username == user.username,
            Notification.type == NotificationType.EXPENSE_SHARE,
            Notification.ref_id == expense.id,
        )
        .values(needs_answer=False, read=True)
    )
    if verdict == ShareStatus.REJECTED:
        create_notification(
            db,
            username=expense.created_by,
            type=NotificationType.SHARE_REJECTED,
            message=(
                f"{first_name(db, user.username)} rejected their "
                f"{format_money(share.amount_minor, space.currency)} share of ‘{expense.description}’"
            ),
            space_id=space.id,
            space_name=space.name,
            ref_id=expense.id,
        )
    db.commit()
    return _detail(db, expense, space)


# --- helpers ------------------------------------------------------------------------------------


def _expense_of(db: Session, username: str, expense_id: int, *, lock: bool = False) -> tuple[Expense, Space]:
    """The expense and its space, if `username` is in that space. Otherwise it does not exist for them.

    `lock` is for what changes the expense or what people owe: it takes the space's lock first (see space_access.lock_space),
    then holds the expense's own row until this request commits (PostgreSQL; SQLite takes its write lock anyway). So two
    edits of one expense, say a double tap, run one after the other instead of both deleting and re-adding its shares,
    and so does an edit and the owner deleting the space.
    """
    if lock:
        space_id = db.scalar(select(Expense.space_id).where(Expense.id == expense_id))
        if space_id is not None:
            lock_space(db, space_id)
    expense = db.get(Expense, expense_id, with_for_update=lock)
    if expense is None or db.get(SpaceMember, (expense.space_id, username)) is None:
        raise api_error(404, "expense_not_found", "Expense not found.")
    return expense, db.get(Space, expense.space_id)


def _prepare(db: Session, space: Space, data: ExpenseWrite) -> list[Row]:
    """Check the parts that need the database and work out every share. Raises before anything is written."""
    positions = dict(
        db.execute(select(SpaceMember.username, SpaceMember.position).where(SpaceMember.space_id == space.id)).all()
    )
    if data.paid_by not in positions:
        raise field_error("paid_by", "The person who paid must be in this space")
    if any(share.username not in positions for share in data.shares):
        raise field_error("shares", "Everyone in the split must be in this space")

    # Leftover units go to people in member-list order, whatever order the app sent them in.
    ordered = sorted(data.shares, key=lambda share: positions[share.username])
    typed = [None if data.split_type == SplitType.EQUAL else share.input for share in ordered]
    try:
        amounts = split_service.split(data.amount_minor, data.split_type, typed, space.currency)
    except ValueError as problem:
        raise field_error("shares", str(problem)) from None
    return [(share.username, amount, value) for share, amount, value in zip(ordered, amounts, typed)]


def _save_shares(db: Session, expense: Expense, space: Space, rows: list[Row]) -> None:
    """One row per person. The payer and the creator are accepted at once; everyone else gets a card to answer."""
    now = utcnow()
    creator = first_name(db, expense.created_by)
    for username, amount, typed in rows:
        automatic = username in (expense.paid_by, expense.created_by)
        db.add(
            ExpenseShare(
                expense_id=expense.id,
                username=username,
                amount_minor=amount,
                input=None if typed is None else format(typed.normalize(), "f"),
                status=ShareStatus.ACCEPTED if automatic else ShareStatus.PENDING,
                responded_at=now if automatic else None,
            )
        )
        if not automatic:
            create_notification(
                db,
                username=username,
                type=NotificationType.EXPENSE_SHARE,
                message=f"{creator} added ‘{expense.description}’ — your share is {format_money(amount, space.currency)}",
                space_id=space.id,
                space_name=space.name,
                ref_id=expense.id,
                needs_answer=True,
            )


def _clear_answers(db: Session, expense_id: int) -> None:
    """Remove the shares of an expense, and the reminder log that hangs off them (the clock starts again)."""
    share_ids = select(ExpenseShare.id).where(ExpenseShare.expense_id == expense_id)
    db.execute(delete(Reminder).where(Reminder.expense_share_id.in_(share_ids)))
    db.execute(delete(ExpenseShare).where(ExpenseShare.expense_id == expense_id))


def _clear_cards(db: Session, expense_id: int, types: tuple[NotificationType, ...]) -> None:
    """Only these types: `ref_id` is an expense id for share cards but a payment id for payment cards."""
    db.execute(delete(Notification).where(Notification.ref_id == expense_id, Notification.type.in_(types)))


def _detail(db: Session, expense: Expense, space: Space) -> ExpenseDetailOut:
    members = [
        MemberOut(username=username, name=name, position=position)
        for username, name, position in db.execute(
            select(SpaceMember.username, User.name, SpaceMember.position)
            .select_from(SpaceMember)
            .join(User, User.username == SpaceMember.username)
            .where(SpaceMember.space_id == space.id)
            .order_by(SpaceMember.position)
        ).all()
    ]
    names = {member.username: member.name for member in members}
    positions = {member.username: member.position for member in members}

    def who(username: str) -> UserSummary:
        return UserSummary(username=username, name=names[username]) if username in names else person(db, username)

    shares = list(db.scalars(select(ExpenseShare).where(ExpenseShare.expense_id == expense.id)).all())
    shares.sort(key=lambda share: (positions.get(share.username, len(positions) + 1), share.id))
    return ExpenseDetailOut(
        id=expense.id,
        description=expense.description,
        amount_minor=expense.amount_minor,
        split_type=expense.split_type,
        paid_by=who(expense.paid_by),
        created_by=who(expense.created_by),
        date=expense.date,
        created_at=expense.created_at,
        updated_at=expense.updated_at,
        disputed=any(share.status == ShareStatus.REJECTED for share in shares),
        space=SpaceHeader(
            id=space.id,
            name=space.name,
            icon=space.icon,
            currency=space.currency,
            owner_username=space.created_by,
            created_at=space.created_at,
        ),
        members=members,
        shares=[
            ShareOut(
                user=who(share.username),
                amount_minor=share.amount_minor,
                status=share.status,
                responded_at=share.responded_at,
                input=None if share.input is None else float(share.input),
            )
            for share in shares
        ],
    )
