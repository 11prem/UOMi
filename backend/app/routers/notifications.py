"""Notification endpoints: the Home page card and the Notifications page."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query
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
from app.utils.validators import MAX_ID

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationList)
def list_notifications(
    before: Annotated[int | None, Query(ge=1, le=MAX_ID, description="Id of the last card on the previous page")] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> NotificationList:
    """Newest first. Use `next_before` from the response as `before` to load the next page."""
    return notification_service.list_notifications(db, current_user.username, before, limit)


# `/unread-count` and `/read-all` sit above `/{notification_id}` so the path parameter never swallows them.
@router.get("/unread-count", response_model=UnreadCount)
def unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UnreadCount:
    """How many cards the signed-in user has not read yet."""
    return UnreadCount(unread_count=notification_service.get_unread_count(db, current_user.username))


@router.patch("/read-all", response_model=MarkAllReadResponse)
def read_all_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MarkAllReadResponse:
    """Mark every card of the signed-in user read; `updated_count` is how many were unread."""
    return MarkAllReadResponse(updated_count=notification_service.mark_all_as_read(db, current_user.username))


@router.patch("/{notification_id}", response_model=NotificationOut)
def update_notification(
    notification_id: Annotated[int, Path(ge=1, le=MAX_ID)],
    data: NotificationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> NotificationOut:
    """Mark a card read (or unread)."""
    return notification_service.set_read(db, current_user.username, notification_id, data.read)
