"""SpaceMember: a person in a space. People are added straight away, with no accept step.

(Accepting or rejecting is for expense shares, not for joining a space.)
"""

from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, UTCDateTime, utcnow


class SpaceMember(Base):
    __tablename__ = "space_members"

    space_id: Mapped[int] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), primary_key=True)
    username: Mapped[str] = mapped_column(
        String(30), ForeignKey("users.username"), primary_key=True, index=True
    )
    position: Mapped[int]  # place in the numbered members list on the Add People page, starting at 1
    joined_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
