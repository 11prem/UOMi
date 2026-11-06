"""Spaces: creating one, the Home page list, and the Group page.

Everything starts from the signed-in username: a space you are not in does not exist as far as
you are concerned (404, never 403), so nobody can probe for other people's spaces.
"""

from decimal import Decimal

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.models.expense import Expense
from app.models.expense_split import ExpenseShare
from app.models.group import Space
from app.models.group_member import SpaceMember
from app.models.notification import NotificationType
from app.models.user import User
from app.schemas.group import (
    BillOut,
    DebtOut,
    MemberOut,
    SpaceCreate,
    SpaceDetailOut,
    SpaceListOut,
    SpaceSummary,
)
from app.schemas.user import UserSummary
from app.services import balance_service, notification_service
from app.utils.errors import api_error

BILLS_LIMIT = 50


def _money(minor: int) -> Decimal:
    """The API still shows amounts as two-place decimals; it switches to integer minor units later."""
    return Decimal(minor).scaleb(-2)


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

    space = Space(name=data.name, icon=data.icon, created_by=creator.username)
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
    """Home page: the spaces you are in, each with your balance, plus the overall balance."""
    member_counts = (
        select(SpaceMember.space_id, func.count().label("member_count"))
        .group_by(SpaceMember.space_id)
        .subquery()
    )
    rows = db.execute(
        select(Space, member_counts.c.member_count)
        .join(
            SpaceMember,
            and_(SpaceMember.space_id == Space.id, SpaceMember.username == user.username),
        )
        .join(member_counts, member_counts.c.space_id == Space.id)
        .order_by(Space.id.desc())
    ).all()

    balances = balance_service.get_balances(db, user.username, [space.id for space, _ in rows])
    return SpaceListOut(
        currency=user.currency,
        overall_balance=_money(sum(balances.values(), balance_service.ZERO)),
        spaces=[
            SpaceSummary(
                id=space.id,
                name=space.name,
                icon=space.icon,
                member_count=count,
                balance=_money(balances[space.id]),
            )
            for space, count in rows
        ],
    )


def get_space_detail(db: Session, user: User, space_id: int) -> SpaceDetailOut:
    """Group page: header, your balance, the bills and who owes whom."""
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

    bill_rows = db.execute(
        select(Expense, User.name, ExpenseShare.amount_minor, ExpenseShare.status)
        .select_from(Expense)
        .join(User, User.username == Expense.paid_by)
        .outerjoin(
            ExpenseShare,
            and_(ExpenseShare.expense_id == Expense.id, ExpenseShare.username == user.username),
        )
        .where(Expense.space_id == space_id)
        .order_by(Expense.id.desc())
        .limit(BILLS_LIMIT)
    ).all()

    def person(username: str) -> UserSummary:
        return UserSummary(username=username, name=names.get(username, username))

    return SpaceDetailOut(
        id=space.id,
        name=space.name,
        icon=space.icon,
        currency=user.currency,
        balance=_money(balance_service.get_space_balance(db, user.username, space_id)),
        members=[MemberOut(username=u, name=n, position=p) for u, n, p in member_rows],
        bills=[
            BillOut(
                id=expense.id,
                title=expense.description,
                amount=_money(expense.amount_minor),
                paid_by=UserSummary(username=expense.paid_by, name=payer_name),
                created_at=expense.created_at,
                my_share=None if my_share is None else _money(my_share),
                my_share_status=my_share_status,
            )
            for expense, payer_name, my_share, my_share_status in bill_rows
        ],
        who_owes_whom=[
            DebtOut(debtor=person(d.debtor), creditor=person(d.creditor), amount=_money(d.amount))
            for d in balance_service.get_debts(db, space_id)
        ],
    )
