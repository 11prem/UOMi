"""User: the one table for an account and everything about signing in to it.

The integer `id` is the primary key; every other table points at it. The `username` is the unique,
lowercase name used to sign in and to be found in search. Besides the profile, a row also holds:

  * sign-up state       a row is created as `pending` and becomes `active` once the email code is verified
  * forgot-password     one code, then one reset token (each stored only as a hash)
  * failed-login count  to answer 429 after too many wrong passwords
  * the session         ONE signed-in device; this is what the 10-minute inactivity sign-out checks.
                        The access token is a signed JWT and cannot be changed after it is issued, so
                        "signed out after 10 idle minutes" is checked against `last_activity_at` here.
                        Clearing the session columns (logout, idle timeout, password reset) ends the
                        session immediately. Signing in on a second device replaces the first.

Every column in a group other than the profile is NULL (or 0 for a counter) when it is not in use.
"""

from datetime import datetime

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, UTCDateTime, utcnow

STATUS_PENDING = "pending"  # signed up, email code not verified yet: cannot sign in, not searchable
STATUS_ACTIVE = "active"


class User(Base):
    __tablename__ = "users"

    # --- profile ---
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(30), unique=True, index=True)  # stored lowercase
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str | None] = mapped_column(String(254), unique=True, index=True)
    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # E.164, e.g. +919876543210
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    # --- sign-up verification (was `pending_signups`) ---
    status: Mapped[str] = mapped_column(String(10), default=STATUS_ACTIVE, index=True)
    signup_pending_id: Mapped[str | None] = mapped_column(String(80), unique=True)  # the id the app holds
    signup_code_hash: Mapped[str | None] = mapped_column(String(64))  # HMAC-SHA256, never the code itself
    signup_attempts: Mapped[int] = mapped_column(default=0)  # wrong guesses so far
    signup_expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime)  # end of the code's validity

    # --- forgot password (was `password_resets`) ---
    # /auth/forgot sets the code; /auth/verify-otp sets `reset_verified_at` and a reset token;
    # /auth/reset changes the password and sets `reset_used_at` (the token works once).
    reset_code_hash: Mapped[str | None] = mapped_column(String(64))  # HMAC-SHA256, never the code itself
    reset_attempts: Mapped[int] = mapped_column(default=0)  # wrong guesses so far
    reset_code_expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime)  # end of the code's validity
    reset_verified_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    reset_token_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    reset_token_expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime)  # end of the reset session
    reset_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    # --- failed sign-ins (was `login_attempts`) ---
    failed_login_count: Mapped[int] = mapped_column(default=0)
    first_failed_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime)  # start of the counting window
    locked_until: Mapped[datetime | None] = mapped_column(UTCDateTime)

    # --- the signed-in session (was `refresh_tokens`) ---
    session_id: Mapped[str | None] = mapped_column(String(32), unique=True)  # the `sid` claim
    refresh_token_hash: Mapped[str | None] = mapped_column(String(64), unique=True)  # SHA-256 of the token
    session_created_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_activity_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    session_expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime)  # absolute end of the session
