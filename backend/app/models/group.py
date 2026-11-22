"""Space (what the app calls a group), created from the Group Name pop-up (name + icon picker).

The file keeps the name `group.py` from the project tree; the table and class follow the flow map.
"""

from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, UTCDateTime, utcnow


class Space(Base):
    __tablename__ = "spaces"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    icon: Mapped[str] = mapped_column(String(50))  # key of the icon chosen in the picker
    currency: Mapped[str] = mapped_column(String(3), server_default="INR")  # ISO 4217 code, fixed at creation
    created_by: Mapped[str] = mapped_column(String(30), ForeignKey("users.username"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
