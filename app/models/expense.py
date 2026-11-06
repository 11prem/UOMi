"""Expense (a "bill"): one card on the Group page. Round 1 only reads these; creating them is a later module."""

import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Enum, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, UTCDateTime, utcnow


class SplitType(str, enum.Enum):
    EQUAL = "equal"
    EXACT = "exact"
    ITEM = "item"  # split by item


class Expense(Base):
    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(primary_key=True)
    space_id: Mapped[int] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), index=True)
    paid_by: Mapped[str] = mapped_column(String(30), ForeignKey("users.username"))
    title: Mapped[str] = mapped_column(String(200))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    split_type: Mapped[SplitType] = mapped_column(
        Enum(SplitType, native_enum=False, length=20), default=SplitType.EQUAL
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
