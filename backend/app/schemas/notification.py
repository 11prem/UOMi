"""Request/response shapes for the notification cards."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.notification import NotificationType


class NotificationOut(BaseModel):
    """A card on the Home page and the Notifications page."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    type: NotificationType
    message: str
    space_id: int | None  # None once the space is deleted: the card stays, space_name keeps the name
    space_name: str | None
    ref_id: int | None  # the expense (expense_share, share_rejected) or settlement (payment_*) the card is about
    needs_answer: bool  # the card still waits for a tick or cross
    read: bool
    created_at: datetime


class NotificationList(BaseModel):
    items: list[NotificationOut]
    next_before: int | None  # pass as ?before= to get the next page; None on the last page
    unread_count: int  # every unread card of the caller, not just the ones on this page


class NotificationUpdate(BaseModel):
    read: bool


class UnreadCount(BaseModel):
    unread_count: int


class MarkAllReadResponse(BaseModel):
    updated_count: int  # how many cards flipped from unread to read
