"""PasswordReset: one row per forgot-password request, from texted code to new password.

Life of a row:
  1. POST /auth/forgot       row created for a username, code stored only as an HMAC, valid until `expires_at`
  2. POST /auth/otp/resend   a fresh code replaces the old one (same row, same `public_id`)
  3. POST /auth/verify-otp   right code -> `verified_at` set, a reset token issued (stored as a hash),
                             valid until `reset_expires_at`
  4. POST /auth/reset        right token -> password changed, `used_at` set (the token works once)

`username` is empty when the typed username does not exist. The row is still written (with `requested_username`
set to what was typed), so that requesting codes behaves identically, and is limited identically, for every name.
"""

from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, UTCDateTime, utcnow


class PasswordReset(Base):
    __tablename__ = "password_resets"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str | None] = mapped_column(String(40), unique=True, index=True)  # the `reset_id` the app holds
    requested_username: Mapped[str | None] = mapped_column(String(50), index=True)  # what was typed, even if unknown
    phone: Mapped[str] = mapped_column(String(20), index=True)  # "" when the username does not exist
    username: Mapped[str | None] = mapped_column(
        String(30), ForeignKey("users.username", ondelete="CASCADE")
    )
    code_hash: Mapped[str] = mapped_column(String(64))  # HMAC-SHA256, never the code itself
    attempts: Mapped[int] = mapped_column(default=0)  # wrong guesses at the current code
    locked_until: Mapped[datetime | None] = mapped_column(UTCDateTime)  # set after too many wrong guesses
    send_count: Mapped[int] = mapped_column(default=1, server_default="1")  # texts sent for this request
    last_sent_at: Mapped[datetime | None] = mapped_column(UTCDateTime)  # the resend cooldown counts from it
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)  # the daily code cap counts by it
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)  # end of the CURRENT code's validity
    valid_until: Mapped[datetime | None] = mapped_column(UTCDateTime)  # end of the request as a whole
    verified_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    reset_token_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    reset_expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime)  # end of the reset session
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
