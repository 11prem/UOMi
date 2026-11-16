"""User: the sign-in identity. The username is the primary key and never changes, not even after the account is deleted."""

from datetime import datetime

from sqlalchemy import Boolean, String, true
from sqlalchemy.orm import Mapped, mapped_column

from app.config import settings
from app.database import Base, UTCDateTime, utcnow


class User(Base):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(String(30), primary_key=True)  # stored lowercase
    name: Mapped[str] = mapped_column(String(100))
    # Lowercase, so unique means unique whatever the capitals. A deleted account gets a unique placeholder
    # (`deleted:<username>@example.invalid`, which no one can sign up with): the address is let go so it can be used again (task 1.7.2).
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    # E.164 (+919876543210), collected at sign-up and used to find a person when adding people to a space. It is never used
    # to send a code (codes go to the email). Empty (NULL) for an account made before phone numbers came back, and for a
    # deleted account: the number is let go so it can be used again.
    phone: Mapped[str | None] = mapped_column(String(20), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    currency: Mapped[str] = mapped_column(String(3), default=settings.DEFAULT_CURRENCY)  # the default for a new space
    # The notifications switch on the Profile page. The cards are always kept; this says whether OS pushes may be sent (task 1.8).
    notifications_on: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    # Set when the person deleted their account. The row stays, anonymised, because the username is the key that other
    # people's expenses, shares and payments point at; the username is never given out again (decision 1.7.1).
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
