"""Request/response shapes for expenses (task 1.3).

Money fields end in `_minor` and are integers. What a person typed in the split (`input`) is in major units for
an exact split (700 is ₹700.00), a percentage for a percent split and a whole count for a shares split.
"""

import datetime as dt
from decimal import Decimal, InvalidOperation
from typing import Annotated

from pydantic import BaseModel, Field, field_validator

from app.database import utcnow
from app.models.expense import SplitType
from app.models.expense_split import ShareStatus
from app.schemas.group import ExpenseRow, MemberOut, SpaceHeader
from app.schemas.user import UserSummary
from app.utils.validators import reject_nul, validate_username

MAX_AMOUNT_MINOR = 999_999_999  # 99,99,999.99 in rupees, 9,999,999.99 in the other currencies (specs § 8)
MAX_DESCRIPTION = 50
MAX_PEOPLE = 50  # a space holds at most 50 people
MAX_TYPED = Decimal(10_000_000)


class ShareIn(BaseModel):
    """One person in the split and what was typed for them (nothing for an equal split)."""

    username: str
    input: Decimal | None = None

    @field_validator("username")
    @classmethod
    def check_username(cls, v: str) -> str:
        return validate_username(v)

    @field_validator("input", mode="before")
    @classmethod
    def check_input(cls, v):
        if v is None:
            return None
        if isinstance(v, bool) or not isinstance(v, (int, float, str)):
            raise ValueError("Enter a number")
        try:
            number = Decimal(str(v).strip())
        except InvalidOperation:
            raise ValueError("Enter a number") from None
        if not number.is_finite():
            raise ValueError("Enter a number")
        if number < 0:
            raise ValueError("Can’t be negative")
        if number > MAX_TYPED:
            raise ValueError("That number is too big")
        if number.normalize().as_tuple().exponent < -2:
            raise ValueError("Use at most 2 decimal places")
        return number


class ExpenseWrite(BaseModel):
    """Add expense, and the edit screen (which sends the whole expense again)."""

    description: str = Field(max_length=500)
    amount_minor: Annotated[int, Field(strict=True, gt=0, le=MAX_AMOUNT_MINOR)]
    paid_by: str
    split_type: SplitType
    shares: list[ShareIn] = Field(min_length=1, max_length=MAX_PEOPLE)
    date: dt.date

    @field_validator("description")
    @classmethod
    def check_description(cls, v: str) -> str:
        cleaned = reject_nul(" ".join(v.split()))
        if not cleaned:
            raise ValueError("Enter a description")
        if len(cleaned) > MAX_DESCRIPTION:
            raise ValueError(f"Keep the description to {MAX_DESCRIPTION} characters")
        return cleaned

    @field_validator("paid_by")
    @classmethod
    def check_paid_by(cls, v: str) -> str:
        return validate_username(v)

    @field_validator("shares")
    @classmethod
    def check_shares(cls, shares: list[ShareIn]) -> list[ShareIn]:
        usernames = [share.username for share in shares]
        if len(set(usernames)) != len(usernames):
            raise ValueError("Each person can be in the split only once")
        return shares

    @field_validator("date")
    @classmethod
    def check_date(cls, v: dt.date) -> dt.date:
        # A day ahead of UTC is allowed: it is already tomorrow in the time zones east of Greenwich.
        if v > utcnow().date() + dt.timedelta(days=1):
            raise ValueError("The date can’t be in the future")
        return v


class ShareOut(BaseModel):
    """One person's share of an expense and their answer to it."""

    user: UserSummary
    amount_minor: int
    status: ShareStatus
    responded_at: dt.datetime | None
    input: float | None  # what was typed, for the edit screen


class ExpenseDetailOut(BaseModel):
    """The expense screen: who paid, the split, and each person's answer."""

    id: int
    description: str
    amount_minor: int
    split_type: SplitType
    paid_by: UserSummary
    created_by: UserSummary
    date: dt.date
    created_at: dt.datetime
    updated_at: dt.datetime
    disputed: bool  # someone rejected their share, so the expense is left out of every balance
    space: SpaceHeader
    members: list[MemberOut]
    shares: list[ShareOut]


class ExpenseListOut(BaseModel):
    """One page of a space's expenses, newest first. Pass `next_before` as `before` to get the next page."""

    items: list[ExpenseRow]
    next_before: int | None
