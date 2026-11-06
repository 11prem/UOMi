"""Settlement: a payment between two people in a space (Settle up).

The file keeps the name `payment.py` from the project tree; the table follows the flow map.
Only CONFIRMED settlements count towards balances.
"""

import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Enum, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, UTCDateTime, utcnow


class SettlementStatus(str, enum.Enum):
    PENDING = "pending"  # the payer recorded it, the other person has not confirmed
    CONFIRMED = "confirmed"


class Settlement(Base):
    __tablename__ = "settlements"

    id: Mapped[int] = mapped_column(primary_key=True)
    space_id: Mapped[int] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), index=True)
    payer: Mapped[str] = mapped_column(String(30), ForeignKey("users.username"))  # who handed over money
    payee: Mapped[str] = mapped_column(String(30), ForeignKey("users.username"))  # who received it
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    status: Mapped[SettlementStatus] = mapped_column(
        Enum(SettlementStatus, native_enum=False, length=20), default=SettlementStatus.PENDING
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    confirmed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
