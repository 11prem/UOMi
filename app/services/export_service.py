"""Export my data (task 1.7.3): the signed-in person's profile, spaces, expenses, shares, payments and notifications.

Only what they are entitled to see: the spaces they are in now, and the people in them by name, as on the Space page.
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
from app.schemas.export import DataExport, ExportExpense, ExportProfile, ExportSpace
from app.schemas.group import MemberOut, SettlementRow
from app.schemas.notification import NotificationOut
from app.schemas.user import UserSummary
from app.services import balance_service


def build_export(db: Session, user: User) -> DataExport:
    spaces = sorted(balance_service.spaces_of(db, user.username), key=lambda space: space.id)
    exported = []
    for space in spaces:
        members = db.execute(
            select(SpaceMember.username, User.name, SpaceMember.position)
            .select_from(SpaceMember)
            .join(User, User.username == SpaceMember.username)
            .where(SpaceMember.space_id == space.id)
            .order_by(SpaceMember.position)
        ).all()
        expenses = db.scalars(select(Expense).where(Expense.space_id == space.id).order_by(Expense.id)).all()
        shares = db.execute(
            select(ExpenseShare, User.name)
            .join(User, User.username == ExpenseShare.username)
            .where(ExpenseShare.expense_id.in_([e.id for e in expenses]))
            .order_by(ExpenseShare.id)
        ).all() if expenses else []
        settlements = db.scalars(select(Settlement).where(Settlement.space_id == space.id).order_by(Settlement.id)).all()

        usernames = {m.username for m in members} | {e.paid_by for e in expenses} | {e.created_by for e in expenses}
        usernames |= {s.payer for s in settlements} | {s.payee for s in settlements}
        names = dict(db.execute(select(User.username, User.name).where(User.username.in_(usernames))).all()) if usernames else {}

        def person(username: str, names=names) -> UserSummary:
            return UserSummary(username=username, name=names.get(username, username))

        by_expense: dict[int, list[ExpenseShare]] = {}
        for share, _name in shares:
            by_expense.setdefault(share.expense_id, []).append(share)
        exported.append(
            ExportSpace(
                id=space.id,
                name=space.name,
                icon=space.icon,
                currency=space.currency,
                owner_username=space.created_by,
                created_at=space.created_at,
                members=[MemberOut(username=u, name=n, position=p) for u, n, p in members],
                expenses=[
                    ExportExpense(
                        id=e.id,
                        description=e.description,
                        amount_minor=e.amount_minor,
                        split_type=e.split_type,
                        paid_by=person(e.paid_by),
                        created_by=person(e.created_by),
                        date=e.date,
                        created_at=e.created_at,
                        updated_at=e.updated_at,
                        disputed=any(s.status == ShareStatus.REJECTED for s in by_expense.get(e.id, [])),
                        shares=[
                            ShareOut(
                                user=person(s.username),
                                amount_minor=s.amount_minor,
                                status=s.status,
                                responded_at=s.responded_at,
                                input=None if s.input is None else float(s.input),
                            )
                            for s in by_expense.get(e.id, [])
                        ],
                    )
                    for e in expenses
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
            )
        )
    notifications = db.scalars(select(Notification).where(Notification.username == user.username).order_by(Notification.id)).all()
    return DataExport(
        exported_at=utcnow(),
        profile=ExportProfile(
            username=user.username,
            name=user.name,
            phone=user.phone,
            currency=user.currency,
            notifications_on=user.notifications_on,
            created_at=user.created_at,
        ),
        spaces=exported,
        notifications=[NotificationOut.model_validate(n) for n in notifications],
    )
