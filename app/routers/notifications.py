"""Notification endpoints: the Home page card and the Notifications page."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.notification import (
    MarkAllReadResponse,
    NotificationList,
    NotificationOut,
    NotificationUpdate,
    UnreadCount,
)
from app.services import notification_service
from app.services.notification_service import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("/unread-count", response_model=UnreadCount)
def unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UnreadCount:
    """Return the unread notification count for the logged-in user."""
    count = notification_service.get_unread_count(db, current_user.username)
    return UnreadCount(unread_count=count)

@router.patch("/read-all", response_model=MarkAllReadResponse)
def mark_all_notifications_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MarkAllReadResponse:
    """Mark all unread notifications for the logged-in user as read."""
    count = notification_service.mark_all_as_read(db, current_user.username)
    return MarkAllReadResponse(updated_count=count)

@router.get("", response_model=NotificationList)
def list_notifications(
    before: Annotated[int | None, Query(ge=1, description="Id of the last card on the previous page")] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> NotificationList:
    """Newest first. Use `next_before` from the response as `before` to load the next page."""
    return notification_service.list_notifications(db, current_user.username, before, limit)


@router.patch("/{notification_id}", response_model=NotificationOut)
def update_notification(
    notification_id: int,
    data: NotificationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> NotificationOut:
    """Mark a card read (or unread)."""
    return notification_service.set_read(db, current_user.username, notification_id, data.is_read)
