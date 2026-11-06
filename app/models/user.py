"""User: the sign-in identity. The username is the primary key and never changes."""

from datetime import datetime

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.config import settings
from app.database import Base, UTCDateTime, utcnow


class User(Base):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(String(30), primary_key=True)  # stored lowercase
    name: Mapped[str] = mapped_column(String(100))
    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # E.164, e.g. +919876543210
    password_hash: Mapped[str] = mapped_column(String(255))
    currency: Mapped[str] = mapped_column(String(3), default=settings.DEFAULT_CURRENCY)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
