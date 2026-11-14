"""The "export my data" file (task 1.7.3): everything the signed-in person can see, as plain JSON.

It holds the profile (with their own phone), the spaces they are in (members by name, with when they joined), every
expense in those spaces with all its shares and answers, every payment, and their own notification cards. It never holds
another person's phone number, a password hash or a token. A space they have left is not in it: they can no longer see it.
Expenses and payments are flat lists, each carrying its `space_id`.
"""

import datetime as dt

from pydantic import BaseModel

from app.models.expense import SplitType
from app.models.payment import SettlementStatus
from app.schemas.expense import ShareOut
from app.schemas.notification import NotificationOut
from app.schemas.user import UserSummary


class ExportProfile(BaseModel):
    username: str
    name: str
    phone: str  # the person's own number
    currency: str
    notifications_on: bool
    created_at: dt.datetime


class ExportMember(BaseModel):
    username: str
    name: str
    position: int
    joined_at: dt.datetime


class ExportSpace(BaseModel):
    id: int
    name: str
    icon: str
    currency: str
    owner_username: str
    created_at: dt.datetime
    members: list[ExportMember]


class ExportExpense(BaseModel):
    id: int
    space_id: int
    description: str
    amount_minor: int
    split_type: SplitType
    paid_by: UserSummary
    created_by: UserSummary
    date: dt.date
    created_at: dt.datetime
    updated_at: dt.datetime
    disputed: bool
    shares: list[ShareOut]  # every share, with its status and when it was answered


class ExportSettlement(BaseModel):
    id: int
    space_id: int
    from_user: UserSummary
    to_user: UserSummary
    amount_minor: int
    status: SettlementStatus
    created_at: dt.datetime
    answered_at: dt.datetime | None


class AccountExport(BaseModel):
    exported_at: dt.datetime
    profile: ExportProfile  # includes the person's own phone
    spaces: list[ExportSpace]  # with members and joined_at
    expenses: list[ExportExpense]  # with every share and answer
    settlements: list[ExportSettlement]
    notifications: list[NotificationOut]  # their own cards only
