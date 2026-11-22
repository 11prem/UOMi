"""LoginAttempt: one row per failed sign-in, used to answer 429 after too many tries.

The username is not a foreign key on purpose: attempts against usernames that do not exist are
counted too, so the lockout looks the same whether or not the account exists.
"""

from datetime import datetime

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, UTCDateTime, utcnow


class LoginAttempt(Base):
    __tablename__ = "login_attempts"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), index=True)
    attempted_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
