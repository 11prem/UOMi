"""Spaces: creating one, the Home page list, and the Group page.

Everything starts from the signed-in username: a space you are not in does not exist as far as
you are concerned (404, never 403), so nobody can probe for other people's spaces.
"""

from sqlalchemy import and_, exists, select
from sqlalchemy.orm import Session, aliased

from app.models.expense import Expense
from app.models.expense_split import ExpenseShare, ShareStatus
from app.models.group import Space
from app.models.group_member import SpaceMember
from app.models.notification import NotificationType
from app.models.payment import Settlement
from app.models.user import User
from app.schemas.group import (
    ExpenseRow,
    MemberOut,
    PairOut,
    SettlementRow,
    SpaceCreate,
    SpaceDetailOut,
    SpaceListOut,
)
from app.schemas.user import UserSummary
from app.services import balance_service, notification_service
from app.utils.errors import api_error

EXPENSES_LIMIT = 50


def create_space(db: Session, creator: User, data: SpaceCreate) -> Space:
    """Add People page, tick to create. One transaction: the space, its members, and one
    "you were added" card for each person added."""
    usernames = [u for u in data.usernames if u != creator.username]

    if usernames:
        found = set(db.scalars(select(User.username).where(User.username.in_(usernames))))
        missing = [u for u in usernames if u not in found]
        if missing:
            raise api_error(
                422, "unknown_usernames", "Some of these usernames do not exist.", usernames=missing
            )

    space = Space(
        name=data.name,
        icon=data.icon,
        currency=data.currency or creator.currency,
        created_by=creator.username,
    )
    db.add(space)
    db.flush()  # fills in space.id

    db.add(SpaceMember(space_id=space.id, username=creator.username, position=1))
    for position, username in enumerate(usernames, start=2):
        db.add(SpaceMember(space_id=space.id, username=username, position=position))
        notification_service.create_notification(
            db,
            username,
            NotificationType.SPACE_ADDED,
            message=f"{creator.name} added you to {space.name}.",
            space_id=space.id,
        )
    db.commit()
    return space


def list_spaces(db: Session, user: User) -> SpaceListOut:
    """Home page: the overall balance per currency, and the spaces you are in, latest activity first."""
    cards = balance_service.space_cards(db, balance_service.spaces_of(db, user.username), user.username)
    cards.sort(key=lambda card: (card.last_activity_at, card.id), reverse=True)
    return SpaceListOut(overall=balance_service.overall(db, user.username), spaces=cards)


def get_space_detail(db: Session, user: User, space_id: int) -> SpaceDetailOut:
    """Group page: header, your balance, the members, expenses, payments and who owes whom."""
    if db.get(SpaceMember, (space_id, user.username)) is None:
        raise api_error(404, "space_not_found", "Space not found.")
    space = db.get(Space, space_id)

    member_rows = db.execute(
        select(SpaceMember.username, User.name, SpaceMember.position)
        .select_from(SpaceMember)
        .join(User, User.username == SpaceMember.username)
        .where(SpaceMember.space_id == space_id)
        .order_by(SpaceMember.position)
    ).all()
    names = {username: name for username, name, _ in member_rows}

    def person(username: str) -> UserSummary:
        return UserSummary(username=username, name=names.get(username, username))

    mine = aliased(ExpenseShare)  # the viewer's own share of each expense, if they have one
    disputed = exists().where(
        ExpenseShare.expense_id == Expense.id, ExpenseShare.status == ShareStatus.REJECTED
    )
    expense_rows = db.execute(
        select(Expense, mine.amount_minor, mine.status, disputed.label("disputed"))
        .select_from(Expense)
        .outerjoin(mine, and_(mine.expense_id == Expense.id, mine.username == user.username))
        .where(Expense.space_id == space_id)
        .order_by(Expense.id.desc())
        .limit(EXPENSES_LIMIT)
    ).all()

    settlements = db.scalars(
        select(Settlement).where(Settlement.space_id == space_id).order_by(Settlement.id.desc())
    ).all()

    pairs = balance_service.pairwise(db, space_id)
    return SpaceDetailOut(
        id=space.id,
        name=space.name,
        icon=space.icon,
        currency=space.currency,
        owner_username=space.created_by,
        created_at=space.created_at,
        balance_minor=sum(balance_service.side_of(pairs, user.username).values()),
        members=[MemberOut(username=u, name=n, position=p) for u, n, p in member_rows],
        expenses=[
            ExpenseRow(
                id=expense.id,
                description=expense.description,
                amount_minor=expense.amount_minor,
                split_type=expense.split_type,
                paid_by=person(expense.paid_by),
                created_by=person(expense.created_by),
                date=expense.date,
                created_at=expense.created_at,
                updated_at=expense.updated_at,
                my_share_minor=my_share,
                my_share_status=my_status,
                disputed=is_disputed,
            )
            for expense, my_share, my_status, is_disputed in expense_rows
        ],
        settlements=[
            SettlementRow(
                id=s.id,
                from_user=person(s.payer),
                to_user=person(s.payee),
                amount_minor=s.amount_minor,
                status=s.status,
                created_at=s.created_at,
                answered_at=s.answered_at,
            )
            for s in settlements
        ],
        pairwise=[
            PairOut(
                debtor=person(b if amount > 0 else a),  # a value above 0 means b owes a
                creditor=person(a if amount > 0 else b),
                amount_minor=abs(amount),
            )
            for (a, b), amount in sorted(pairs.items())
        ],
    )
