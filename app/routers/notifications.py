"""Notification endpoints: the Home page card and the Notifications page."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.notification import NotificationList, NotificationOut, NotificationUpdate
from app.services import notification_service
from app.services.notification_service import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationList)
def list_notifications(
    before: Annotated[int | None, Query(ge=1, description="Id of the last card on the previous page")] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> NotificationList:
    """Newest first. Use `next_before` from the response as `before` to load the next page."""
    return notification_service.list_notifications(db, current_user.username, before, limit)


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
def read_all_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Mark every card of the signed-in user read."""
    notification_service.mark_all_read(db, current_user.username)


@router.patch("/{notification_id}", response_model=NotificationOut)
def update_notification(
    notification_id: int,
    data: NotificationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> NotificationOut:
    """Mark a card read (or unread)."""
    return notification_service.set_read(db, current_user.username, notification_id, data.read)
