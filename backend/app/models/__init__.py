"""Importing this package registers every model on `Base.metadata` (needed for Alembic and create_all)."""

from app.models.expense import Expense, SplitType
from app.models.expense_split import ExpenseShare, ShareStatus
from app.models.group import Space
from app.models.group_member import SpaceMember
from app.models.notification import Notification, NotificationType
from app.models.payment import Settlement, SettlementStatus
from app.models.reminder import Reminder
from app.models.user import User

__all__ = [
    "Expense",
    "ExpenseShare",
    "Notification",
    "NotificationType",
    "Reminder",
    "Settlement",
    "SettlementStatus",
    "ShareStatus",
    "Space",
    "SpaceMember",
    "SplitType",
    "User",
]
