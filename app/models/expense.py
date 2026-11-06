"""Expense (a "bill"): one card on the Group page. Round 1 only reads these; creating them is a later module."""

import datetime as dt
import enum

from sqlalchemy import Date, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, UTCDateTime, utcnow


class SplitType(str, enum.Enum):
    EQUAL = "equal"
    EXACT = "exact"
    PERCENT = "percent"
    SHARES = "shares"


class Expense(Base):
    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(primary_key=True)
    space_id: Mapped[int] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), index=True)
    paid_by: Mapped[str] = mapped_column(String(30), ForeignKey("users.username"))
    created_by: Mapped[str] = mapped_column(String(30), ForeignKey("users.username"))  # may differ from paid_by
    description: Mapped[str] = mapped_column(String(50))
    amount_minor: Mapped[int]  # integer minor units (paise, cents)
    split_type: Mapped[SplitType] = mapped_column(
        Enum(SplitType, native_enum=False, length=20), default=SplitType.EQUAL
    )
    date: Mapped[dt.date] = mapped_column(Date)  # the day the user says the expense happened
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
