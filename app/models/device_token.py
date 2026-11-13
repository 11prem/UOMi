"""DeviceToken: one phone that can be sent push notifications (task 1.8.1). One person can have several.

A device belongs to the sign-in (session) it was registered with, so it goes when that sign-in does: logout, the idle
timeout, a password reset and account deletion all remove the session row, and the database removes the devices with it.
The token is unique: a phone that changes hands moves to its new owner (see services/device_service.py).
"""

from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, UTCDateTime, utcnow


class DeviceToken(Base):
    __tablename__ = "device_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(30), ForeignKey("users.username", ondelete="CASCADE"), index=True)
    session_id: Mapped[str] = mapped_column(String(32), ForeignKey("refresh_tokens.id", ondelete="CASCADE"), index=True)
    token: Mapped[str] = mapped_column(String(255), unique=True)  # what the push provider (FCM) gave the app
    platform: Mapped[str] = mapped_column(String(10))  # "android", "ios" or "web"
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)  # moves on every launch
