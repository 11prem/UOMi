"""Request/response shapes for settling up (task 1.4). A settlement records a payment made outside the app."""

import datetime as dt
from typing import Annotated

from pydantic import BaseModel, Field, field_validator

from app.models.payment import SettlementStatus
from app.schemas.expense import MAX_AMOUNT_MINOR
from app.schemas.group import SpaceHeader
from app.schemas.user import UserSummary
from app.utils.validators import validate_username


class SettlementCreate(BaseModel):
    """Record a payment: who it went to and how much."""

    to_username: str
    amount_minor: Annotated[int, Field(strict=True, gt=0, le=MAX_AMOUNT_MINOR)]

    @field_validator("to_username")
    @classmethod
    def check_username(cls, v: str) -> str:
        return validate_username(v)


class PayeeOut(BaseModel):
    """Someone the viewer owes in a space."""

    user: UserSummary
    owed_minor: int  # what the viewer owes them
    max_minor: int  # the most that can be recorded now: owed, minus payments already waiting for an answer


class SettlementDetailOut(BaseModel):
    """The payment screen."""

    id: int
    space: SpaceHeader
    from_user: UserSummary  # who handed over the money
    to_user: UserSummary  # who received it
    amount_minor: int
    status: SettlementStatus
    created_at: dt.datetime
    answered_at: dt.datetime | None
