"""ExpenseShare: how much of an expense one person owes. It waits for that person's tick or cross.

The file keeps the name `expense_split.py` from the project tree; the table follows the flow map.
Pending and accepted shares count towards balances; once any share on an expense is rejected, the
whole expense is disputed and none of its shares count.
"""

import enum
from datetime import datetime

from sqlalchemy import Enum, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, UTCDateTime


class ShareStatus(str, enum.Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class ExpenseShare(Base):
    __tablename__ = "expense_shares"
    __table_args__ = (UniqueConstraint("expense_id", "username", name="uq_expense_shares_expense_user"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    expense_id: Mapped[int] = mapped_column(ForeignKey("expenses.id", ondelete="CASCADE"), index=True)
    username: Mapped[str] = mapped_column(String(30), ForeignKey("users.username"), index=True)
    amount_minor: Mapped[int]  # integer minor units (paise, cents)
    input: Mapped[str | None] = mapped_column(String(20))  # what was typed: an amount, a percentage or a share count
    status: Mapped[ShareStatus] = mapped_column(
        Enum(ShareStatus, native_enum=False, length=20), default=ShareStatus.PENDING
    )
    responded_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
