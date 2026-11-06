"""Notification cards: creating them, listing them page by page, and marking them read."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.notification import Notification, NotificationType
from app.schemas.notification import NotificationList, NotificationOut
from app.utils.errors import api_error

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 50


def create_notification(
    db: Session,
    username: str,
    notification_type: NotificationType,
    message: str,
    space_id: int | None = None,
    ref_id: int | None = None,
) -> Notification:
    """Add a card for `username` to the session. Does NOT commit.

    The caller commits, so the card is saved or dropped together with whatever caused it
    (for example, creating a space and the "you were added" cards are one transaction).
    """
    notification = Notification(
        username=username,
        type=notification_type,
        message=message,
        space_id=space_id,
        ref_id=ref_id,
    )
    db.add(notification)
    return notification


def _out(notification: Notification) -> NotificationOut:
    """The API shape is unchanged for now: the old title and body are both the message."""
    return NotificationOut(
        id=notification.id,
        type=notification.type,
        title=notification.message,
        body=notification.message,
        space_id=notification.space_id,
        ref_id=notification.ref_id,
        is_read=notification.read,
        created_at=notification.created_at,
    )


def list_notifications(db: Session, username: str, before: int | None, limit: int) -> NotificationList:
    """Newest first. Pass the previous page's `next_before` as `before` to get the next page."""
    stmt = select(Notification).where(Notification.username == username)
    if before is not None:
        stmt = stmt.where(Notification.id < before)
    rows = db.scalars(stmt.order_by(Notification.id.desc()).limit(limit + 1)).all()
    page = rows[:limit]
    has_more = len(rows) > limit
    return NotificationList(
        items=[_out(row) for row in page],
        next_before=page[-1].id if has_more else None,
    )


def set_read(db: Session, username: str, notification_id: int, is_read: bool) -> NotificationOut:
    """Mark a card read or unread. Someone else's card is reported as not found."""
    notification = db.scalar(
        select(Notification).where(Notification.id == notification_id, Notification.username == username)
    )
    if notification is None:
        raise api_error(404, "notification_not_found", "Notification not found.")
    notification.read = is_read
    db.commit()
    db.refresh(notification)
    return _out(notification)
