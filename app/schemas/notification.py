"""Request/response shapes for the notification cards."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.notification import NotificationType


class NotificationOut(BaseModel):
    """A card on the Home page and the Notifications page."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    type: NotificationType
    title: str
    body: str
    space_id: int | None
    ref_id: int | None  # the expense share or settlement the card is about, when there is one
    is_read: bool
    created_at: datetime


class NotificationList(BaseModel):
    items: list[NotificationOut]
    next_before: int | None  # pass as ?before= to get the next page; None on the last page


class NotificationUpdate(BaseModel):
    is_read: bool

class UnreadCount(BaseModel):
    unread_count: int

class MarkAllReadResponse(BaseModel):
    updated_count: int