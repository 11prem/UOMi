"""Notification (a "card"): one item on the Home card and the Notifications page."""

import enum
from datetime import datetime

from sqlalchemy import Boolean, Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, UTCDateTime, utcnow


class NotificationType(str, enum.Enum):
    SPACE_ADDED = "space_added"  # "X added you to <space>"
    SHARE_REQUEST = "share_request"  # an expense share waiting for the tick or cross
    SHARE_RESPONSE = "share_response"  # the payer is told a share was accepted or rejected
    SETTLEMENT_REQUEST = "settlement_request"  # someone says they paid you; confirm it
    PAYMENT_REMINDER = "payment_reminder"  # automatic reminder at day 3, 7 and 10


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(
        String(30), ForeignKey("users.username", ondelete="CASCADE"), index=True
    )  # who the card is for
    type: Mapped[NotificationType] = mapped_column(Enum(NotificationType, native_enum=False, length=30))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    space_id: Mapped[int | None] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"))
    ref_id: Mapped[int | None]  # id of the expense share or settlement the card is about
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
