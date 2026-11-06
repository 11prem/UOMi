"""ExpenseShare: how much of an expense one person owes. It waits for that person's tick or cross.

The file keeps the name `expense_split.py` from the project tree; the table follows the flow map.
Only ACCEPTED shares count towards balances.
"""

import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Enum, ForeignKey, Numeric, String, UniqueConstraint
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
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    status: Mapped[ShareStatus] = mapped_column(
        Enum(ShareStatus, native_enum=False, length=20), default=ShareStatus.PENDING
    )
    responded_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
