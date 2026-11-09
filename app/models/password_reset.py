"""PasswordReset: one row per forgot-password request, from texted code to new password.

Life of a row:
  1. /auth/forgot       row created, code stored only as an HMAC, valid until `expires_at`
  2. /auth/verify-otp   right code -> `verified_at` set, a reset token issued (stored as a hash),
                        valid until `reset_expires_at`
  3. /auth/reset        right token -> password changed, `used_at` set (the token works once)

`username` is empty when the phone number is not registered. The row is still written, so that
requesting codes behaves identically (and is rate limited identically) for every number.
"""

from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, UTCDateTime, utcnow


class PasswordReset(Base):
    __tablename__ = "password_resets"

    id: Mapped[int] = mapped_column(primary_key=True)
    phone: Mapped[str] = mapped_column(String(20), index=True)
    username: Mapped[str | None] = mapped_column(
        String(30), ForeignKey("users.username", ondelete="CASCADE")
    )
    code_hash: Mapped[str] = mapped_column(String(64))  # HMAC-SHA256, never the code itself
    attempts: Mapped[int] = mapped_column(default=0)  # wrong guesses so far
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)  # the daily code cap counts by it
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)  # end of the code's validity
    verified_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    reset_token_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    reset_expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime)  # end of the reset session
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
