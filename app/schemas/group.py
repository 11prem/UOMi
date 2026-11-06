"""Request/response shapes for spaces: Home page list, Add People + create flow, Group page.

Balance convention used everywhere: positive = you are owed, negative = you owe.
The Group page's "You owe ₹100" is therefore a balance of -100.
"""

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

from app.models.expense_split import ShareStatus
from app.schemas.user import UserSummary
from app.utils.validators import clean_name, validate_username

MAX_NEW_MEMBERS = 49  # a space holds at most 50 people, counting the creator


class SpaceCreate(BaseModel):
    """Add People page, tick to create: the name + icon from the pop-up and the numbered members list."""

    name: str = Field(min_length=1, max_length=100)
    icon: str = Field(pattern=r"^[a-z0-9_-]{1,50}$")  # key chosen in the icon picker
    usernames: list[str] = Field(default_factory=list, max_length=MAX_NEW_MEMBERS)

    @field_validator("name")
    @classmethod
    def check_name(cls, v: str) -> str:
        return clean_name(v)

    @field_validator("usernames")
    @classmethod
    def check_usernames(cls, values: list[str]) -> list[str]:
        """Lowercase each one and drop repeats, keeping the order of the numbered list."""
        seen: set[str] = set()
        cleaned: list[str] = []
        for value in values:
            username = validate_username(value)
            if username not in seen:
                seen.add(username)
                cleaned.append(username)
        return cleaned


class SpaceSummary(BaseModel):
    """One card in the Home page's Groups list."""

    id: int
    name: str
    icon: str
    member_count: int
    balance: Decimal


class SpaceListOut(BaseModel):
    """Home page: overall balance and the Groups list."""

    currency: str
    overall_balance: Decimal
    spaces: list[SpaceSummary]


class MemberOut(BaseModel):
    username: str
    name: str
    position: int


class BillOut(BaseModel):
    """One expense card on the Group page."""

    id: int
    title: str
    amount: Decimal
    paid_by: UserSummary
    created_at: datetime
    my_share: Decimal | None  # None if the viewer has no share in this bill
    my_share_status: ShareStatus | None


class DebtOut(BaseModel):
    """One line of "who owes whom"."""

    debtor: UserSummary
    creditor: UserSummary
    amount: Decimal


class SpaceDetailOut(BaseModel):
    """Group page: header (name + members icon), balance, bills, who owes whom."""

    id: int
    name: str
    icon: str
    currency: str
    balance: Decimal
    members: list[MemberOut]
    bills: list[BillOut]
    who_owes_whom: list[DebtOut]
