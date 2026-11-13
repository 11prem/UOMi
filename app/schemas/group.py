"""Request/response shapes for spaces: Home page list, Add People + create flow, Group page.

Balance convention used everywhere: positive = you are owed, negative = you owe.
The Group page's "You owe ₹100" is therefore a `balance_minor` of -10000.
Money fields end in `_minor` and are integers (paise, cents).
"""

import datetime as dt

from pydantic import BaseModel, Field, field_validator

from app.currencies import SUPPORTED_CURRENCIES
from app.models.expense import SplitType
from app.models.expense_split import ShareStatus
from app.models.payment import SettlementStatus
from app.schemas.user import UserSummary
from app.utils.validators import clean_name, validate_username

MAX_SPACE_PEOPLE = 50  # a space holds at most 50 people, counting the creator
MAX_NEW_MEMBERS = MAX_SPACE_PEOPLE - 1
MAX_SPACE_NAME = 30  # specs § 6.1
SPACE_ICONS: tuple[str, ...] = ("home", "trip", "food", "office", "friends", "car", "party", "other")  # specs § 6.1


class SpaceCreate(BaseModel):
    """Add People page, tick to create: the name + icon from the pop-up and the numbered members list."""

    name: str = Field(min_length=1, max_length=500)  # a guard against huge bodies; the validator enforces 1-30
    icon: str  # one of SPACE_ICONS
    currency: str | None = None  # a supported code; left out means the creator's default currency
    usernames: list[str] = Field(default_factory=list, max_length=MAX_NEW_MEMBERS)

    @field_validator("name")
    @classmethod
    def check_name(cls, v: str) -> str:
        return clean_name(v, MAX_SPACE_NAME)

    @field_validator("icon")
    @classmethod
    def check_icon(cls, v: str) -> str:
        if v not in SPACE_ICONS:
            raise ValueError(f"Choose one of the icons: {', '.join(SPACE_ICONS)}")
        return v

    @field_validator("currency")
    @classmethod
    def check_currency(cls, v: str | None) -> str | None:
        if v is not None and v not in SUPPORTED_CURRENCIES:
            raise ValueError(f"Currency must be one of: {', '.join(SUPPORTED_CURRENCIES)}")
        return v

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


class SpaceUpdate(BaseModel):
    """Edit the space (specs § 10): any of the name and icon (any member), and the currency (the owner, before any expense).

    A field that is left out, or null, is left as it is. The name and icon follow the same rules as when creating.
    """

    name: str | None = Field(default=None, min_length=1, max_length=500)  # the validator enforces 1-30
    icon: str | None = None
    currency: str | None = None

    @field_validator("name")
    @classmethod
    def check_name(cls, v: str | None) -> str | None:
        return None if v is None else clean_name(v, MAX_SPACE_NAME)

    @field_validator("icon")
    @classmethod
    def check_icon(cls, v: str | None) -> str | None:
        if v is not None and v not in SPACE_ICONS:
            raise ValueError(f"Choose one of the icons: {', '.join(SPACE_ICONS)}")
        return v

    @field_validator("currency")
    @classmethod
    def check_currency(cls, v: str | None) -> str | None:
        if v is not None and v not in SUPPORTED_CURRENCIES:
            raise ValueError(f"Currency must be one of: {', '.join(SUPPORTED_CURRENCIES)}")
        return v


class AddMembersRequest(BaseModel):
    """Add people (specs § 10): by username, any member may. They are members at once, with no accept step."""

    usernames: list[str] = Field(min_length=1, max_length=MAX_NEW_MEMBERS)

    @field_validator("usernames")
    @classmethod
    def check_usernames(cls, values: list[str]) -> list[str]:
        """Lowercase each one and drop repeats, keeping the order."""
        seen: set[str] = set()
        cleaned: list[str] = []
        for value in values:
            username = validate_username(value)
            if username not in seen:
                seen.add(username)
                cleaned.append(username)
        return cleaned


class SpaceCard(BaseModel):
    """One card in the Home page's list of spaces."""

    id: int
    name: str
    icon: str
    currency: str
    member_count: int
    balance_minor: int
    open_balances: int  # how many people the viewer has a non-zero balance with
    counterparty_name: str | None  # full name of the one person on the side of the net, else None
    counterparty_count: int  # how many people are on the side of the net
    last_activity_at: dt.datetime


class OverallLine(BaseModel):
    """The Home page's overall balance in one currency. Currencies are never added together."""

    currency: str
    net_minor: int
    owe_minor: int
    owed_minor: int


class SpaceListOut(BaseModel):
    """Home page: overall balance per currency and the spaces, newest activity first."""

    overall: list[OverallLine]
    spaces: list[SpaceCard]


class MemberOut(BaseModel):
    username: str
    name: str
    position: int


class SpaceHeader(BaseModel):
    """A space as the expense and payment screens need it: no members, no balances."""

    id: int
    name: str
    icon: str
    currency: str
    owner_username: str
    created_at: dt.datetime


class ExpenseRow(BaseModel):
    """One expense card on the Group page."""

    id: int
    description: str
    amount_minor: int
    split_type: SplitType
    paid_by: UserSummary
    created_by: UserSummary
    date: dt.date
    created_at: dt.datetime
    updated_at: dt.datetime
    my_share_minor: int | None  # None if the viewer has no share in this expense
    my_share_status: ShareStatus | None
    disputed: bool  # someone rejected their share, so the expense is left out of every balance


class SettlementRow(BaseModel):
    """One payment between two people."""

    id: int
    from_user: UserSummary  # who handed over the money
    to_user: UserSummary  # who received it
    amount_minor: int
    status: SettlementStatus
    created_at: dt.datetime
    answered_at: dt.datetime | None


class PairOut(BaseModel):
    """One line of "who owes whom"."""

    debtor: UserSummary
    creditor: UserSummary
    amount_minor: int


class SpaceDetailOut(BaseModel):
    """Group page: header, the viewer's balance, members, expenses, payments and who owes whom."""

    id: int
    name: str
    icon: str
    currency: str
    owner_username: str
    created_at: dt.datetime
    balance_minor: int
    members: list[MemberOut]
    expenses: list[ExpenseRow]
    settlements: list[SettlementRow]
    pairwise: list[PairOut]
