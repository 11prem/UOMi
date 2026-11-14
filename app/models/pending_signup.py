"""PendingSignup: a sign-up waiting for its texted code (specs § 4.3). No account exists until the code is accepted.

Life of a row:
  1. POST /auth/register          row created, code stored only as an HMAC, valid until `expires_at`
  2. POST /auth/otp/resend        a fresh code replaces the old one (same row, same `public_id`)
  3. POST /auth/register/verify   right code -> the user is created and signed in; this row is marked used (its
                                  password hash is wiped) and is kept for a day, because the daily text cap counts it

If the person leaves before verifying, the row just expires (`valid_until`): nothing was created, and the
username and phone number stay free for anyone. The password is kept only as its bcrypt hash.
"""

from datetime import datetime

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, UTCDateTime, utcnow


class PendingSignup(Base):
    __tablename__ = "pending_signups"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(String(40), unique=True, index=True)  # the `pending_id` the app holds
    username: Mapped[str] = mapped_column(String(30), index=True)
    name: Mapped[str] = mapped_column(String(100))
    phone: Mapped[str] = mapped_column(String(20), index=True)  # E.164
    password_hash: Mapped[str] = mapped_column(String(255))
    code_hash: Mapped[str] = mapped_column(String(64))  # HMAC-SHA256, never the code itself
    attempts: Mapped[int] = mapped_column(default=0)  # wrong guesses at the current code
    locked_until: Mapped[datetime | None] = mapped_column(UTCDateTime)  # set after too many wrong guesses
    send_count: Mapped[int] = mapped_column(default=1)  # texts sent for this sign-up, the first one included
    last_sent_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)  # the resend cooldown counts from it
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)  # end of the CURRENT code's validity
    valid_until: Mapped[datetime] = mapped_column(UTCDateTime)  # end of the sign-up as a whole
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)  # the daily code cap counts by it
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime)  # set when the code was accepted and the account made
