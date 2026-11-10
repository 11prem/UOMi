"""Importing this package registers every model on `Base.metadata` (needed for Alembic and create_all)."""

from app.models.expense import Expense, SplitType
from app.models.expense_split import ExpenseShare, ShareStatus
from app.models.group import Space
from app.models.group_member import SpaceMember
from app.models.login_attempt import LoginAttempt
from app.models.notification import Notification, NotificationType
from app.models.password_reset import PasswordReset
from app.models.payment import Settlement, SettlementStatus
from app.models.pending_signup import PendingSignup
from app.models.refresh_token import RefreshToken
from app.models.reminder import Reminder
from app.models.user import User

__all__ = [
    "Expense",
    "ExpenseShare",
    "LoginAttempt",
    "Notification",
    "NotificationType",
    "PasswordReset",
    "PendingSignup",
    "RefreshToken",
    "Reminder",
    "Settlement",
    "SettlementStatus",
    "ShareStatus",
    "Space",
    "SpaceMember",
    "SplitType",
    "User",
]
