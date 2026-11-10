"""The "export my data" file (task 1.7.3): everything the signed-in person can see, as plain JSON.

It holds the profile, the spaces they are in (members by name only, with every expense, its shares and every payment) and
their notifications. It never holds another person's phone number, a password hash or a token. A space they have left is
not in it: they can no longer see it.
"""

import datetime as dt

from pydantic import BaseModel

from app.models.expense import SplitType
from app.schemas.expense import ShareOut
from app.schemas.group import MemberOut, SettlementRow
from app.schemas.notification import NotificationOut
from app.schemas.user import UserSummary


class ExportProfile(BaseModel):
    username: str
    name: str
    phone: str
    currency: str
    notifications_on: bool
    created_at: dt.datetime


class ExportExpense(BaseModel):
    id: int
    description: str
    amount_minor: int
    split_type: SplitType
    paid_by: UserSummary
    created_by: UserSummary
    date: dt.date
    created_at: dt.datetime
    updated_at: dt.datetime
    disputed: bool
    shares: list[ShareOut]


class ExportSpace(BaseModel):
    id: int
    name: str
    icon: str
    currency: str
    owner_username: str
    created_at: dt.datetime
    members: list[MemberOut]
    expenses: list[ExportExpense]
    settlements: list[SettlementRow]


class DataExport(BaseModel):
    exported_at: dt.datetime
    profile: ExportProfile
    spaces: list[ExportSpace]
    notifications: list[NotificationOut]
