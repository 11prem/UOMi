"""Notification (a "card"): one item on the Home card and the Notifications page."""

import enum
from datetime import datetime

from sqlalchemy import Boolean, Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, UTCDateTime, utcnow


class NotificationType(str, enum.Enum):
    EXPENSE_SHARE = "expense_share"  # an expense share waiting for the tick or cross
    SHARE_REJECTED = "share_rejected"  # the payer is told a share was rejected
    PAYMENT_TO_CONFIRM = "payment_to_confirm"  # someone says they paid you; confirm it
    PAYMENT_ANSWERED = "payment_answered"  # the payer is told the payment was confirmed or rejected
    SPACE_ADDED = "space_added"  # "X added you to <space>"
    SPACE_DELETED = "space_deleted"  # the space is gone, the card stays
    REMINDER = "reminder"  # automatic reminder at day 3, 7 and 10


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(
        String(30), ForeignKey("users.username", ondelete="CASCADE"), index=True
    )  # who the card is for
    type: Mapped[NotificationType] = mapped_column(Enum(NotificationType, native_enum=False, length=30))
    message: Mapped[str] = mapped_column(Text)
    # SET NULL, not CASCADE: a "space deleted" card must outlive its space. space_name keeps the name.
    space_id: Mapped[int | None] = mapped_column(ForeignKey("spaces.id", ondelete="SET NULL"))
    space_name: Mapped[str | None] = mapped_column(String(100))
    ref_id: Mapped[int | None]  # the expense (expense_share, share_rejected) or settlement (payment_*) the card is about
    needs_answer: Mapped[bool] = mapped_column(Boolean, default=False)  # the card still waits for a tick or cross
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
