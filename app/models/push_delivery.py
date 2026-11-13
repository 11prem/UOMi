"""PushDelivery: one push still to be sent, for one card and one device (tasks 1.8.2 and 1.8.3).

A row is written in the same transaction as the card, so a card never exists without its pushes, and the worker
(services/push_service.py `deliver_pending`) sends them outside any request. The row is removed when the push was sent,
was given up on, or no longer makes sense; it is kept, with a later `next_attempt_at`, while sending is being retried.
"""

from datetime import datetime

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, UTCDateTime, utcnow


class PushDelivery(Base):
    __tablename__ = "push_deliveries"
    __table_args__ = (UniqueConstraint("notification_id", "device_token_id", name="uq_push_deliveries_card_device"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    notification_id: Mapped[int] = mapped_column(ForeignKey("notifications.id", ondelete="CASCADE"), index=True)
    device_token_id: Mapped[int] = mapped_column(ForeignKey("device_tokens.id", ondelete="CASCADE"), index=True)
    attempts: Mapped[int] = mapped_column(default=0)  # failed tries so far
    next_attempt_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
