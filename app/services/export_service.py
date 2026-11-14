"""Export my data (task 1.7.3): the signed-in person's profile, spaces, expenses, shares, payments and notifications.

Only what they are entitled to see: the spaces they are in now, and the people in them by name, as on the Space page.
A person whose account was deleted is named "Deleted user", as everywhere else.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import utcnow
from app.models.expense import Expense
from app.models.expense_split import ExpenseShare, ShareStatus
from app.models.group_member import SpaceMember
from app.models.notification import Notification
from app.models.payment import Settlement
from app.models.user import User
from app.schemas.expense import ShareOut
from app.schemas.export import (
    AccountExport,
    ExportExpense,
    ExportMember,
    ExportProfile,
    ExportSettlement,
    ExportSpace,
)
from app.schemas.notification import NotificationOut
from app.schemas.user import UserSummary
from app.services import balance_service


def build_export(db: Session, user: User) -> AccountExport:
    spaces = sorted(balance_service.spaces_of(db, user.username), key=lambda space: space.id)
    space_ids = [space.id for space in spaces]

    members = (
        db.scalars(select(SpaceMember).where(SpaceMember.space_id.in_(space_ids)).order_by(SpaceMember.space_id, SpaceMember.position)).all()
        if space_ids
        else []
    )
    expenses = (
        db.scalars(select(Expense).where(Expense.space_id.in_(space_ids)).order_by(Expense.space_id, Expense.id)).all() if space_ids else []
    )
    shares = (
        db.scalars(
            select(ExpenseShare)
            .where(ExpenseShare.expense_id.in_(select(Expense.id).where(Expense.space_id.in_(space_ids))))
            .order_by(ExpenseShare.id)
        ).all()
        if space_ids
        else []
    )
    settlements = (
        db.scalars(select(Settlement).where(Settlement.space_id.in_(space_ids)).order_by(Settlement.space_id, Settlement.id)).all()
        if space_ids
        else []
    )

    usernames = {m.username for m in members} | {s.username for s in shares}
    usernames |= {e.paid_by for e in expenses} | {e.created_by for e in expenses}
    usernames |= {s.payer for s in settlements} | {s.payee for s in settlements}
    names = dict(db.execute(select(User.username, User.name).where(User.username.in_(usernames))).all()) if usernames else {}

    def person(username: str) -> UserSummary:
        return UserSummary(username=username, name=names.get(username, username))

    shares_of: dict[int, list[ExpenseShare]] = {}
    for share in shares:
        shares_of.setdefault(share.expense_id, []).append(share)

    notifications = db.scalars(select(Notification).where(Notification.username == user.username).order_by(Notification.id)).all()
    return AccountExport(
        exported_at=utcnow(),
        profile=ExportProfile(
            username=user.username,
            name=user.name,
            phone=user.phone,
            currency=user.currency,
            notifications_on=user.notifications_on,
            created_at=user.created_at,
        ),
        spaces=[
            ExportSpace(
                id=space.id,
                name=space.name,
                icon=space.icon,
                currency=space.currency,
                owner_username=space.created_by,
                created_at=space.created_at,
                members=[
                    ExportMember(username=m.username, name=names.get(m.username, m.username), position=m.position, joined_at=m.joined_at)
                    for m in members
                    if m.space_id == space.id
                ],
            )
            for space in spaces
        ],
        expenses=[
            ExportExpense(
                id=e.id,
                space_id=e.space_id,
                description=e.description,
                amount_minor=e.amount_minor,
                split_type=e.split_type,
                paid_by=person(e.paid_by),
                created_by=person(e.created_by),
                date=e.date,
                created_at=e.created_at,
                updated_at=e.updated_at,
                disputed=any(s.status == ShareStatus.REJECTED for s in shares_of.get(e.id, [])),
                shares=[
                    ShareOut(
                        user=person(s.username),
                        amount_minor=s.amount_minor,
                        status=s.status,
                        responded_at=s.responded_at,
                        input=None if s.input is None else float(s.input),
                    )
                    for s in shares_of.get(e.id, [])
                ],
            )
            for e in expenses
        ],
        settlements=[
            ExportSettlement(
                id=s.id,
                space_id=s.space_id,
                from_user=person(s.payer),
                to_user=person(s.payee),
                amount_minor=s.amount_minor,
                status=s.status,
                created_at=s.created_at,
                answered_at=s.answered_at,
            )
            for s in settlements
        ],
        notifications=[NotificationOut.model_validate(n) for n in notifications],
    )
