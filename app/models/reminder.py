"""Tracks payment reminders sent for accepted expense shares."""

from datetime import datetime

from sqlalchemy import ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, UTCDateTime, utcnow


class Reminder(Base):
    __tablename__ = "reminders"
    __table_args__ = (
        UniqueConstraint(
            "expense_share_id",
            "reminder_day",
            name="uq_reminders_share_day",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    expense_share_id: Mapped[int] = mapped_column(
        ForeignKey("expense_shares.id", ondelete="CASCADE"),
        index=True,
    )

    reminder_day: Mapped[int] = mapped_column(Integer, nullable=False)

    sent_at: Mapped[datetime] = mapped_column(
        UTCDateTime,
        default=utcnow,
        nullable=False,
    )
