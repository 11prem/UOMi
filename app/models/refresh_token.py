"""RefreshToken: one row per signed-in device. This row IS the session.

Why it carries the inactivity timer: the access token is a signed JWT and cannot be changed after it
is issued, so "signed out after 10 idle minutes" has to be checked against something the server
controls. Every authenticated request looks this row up and moves `last_activity_at` forward.
Deleting the row (logout, idle timeout, password reset) ends the session immediately.
"""

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, UTCDateTime, utcnow


def _new_session_id() -> str:
    return uuid.uuid4().hex


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_session_id)  # the `sid` claim
    username: Mapped[str] = mapped_column(
        String(30), ForeignKey("users.username", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)  # SHA-256 of the refresh token
    # SHA-256 of the refresh token this session swapped out last. If that old token is ever presented
    # again, a copy of it exists somewhere it should not, so the whole session is ended (reuse detection).
    previous_token_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_activity_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)  # absolute end of the session
