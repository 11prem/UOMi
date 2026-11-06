"""Notification cards: creating them, listing them page by page, and marking them read."""

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models.notification import Notification, NotificationType
from app.schemas.notification import NotificationList, NotificationOut
from app.utils.errors import api_error

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 50


def create_notification(
    db: Session,
    *,
    username: str,
    type: NotificationType,
    message: str,
    space_id: int | None = None,
    space_name: str | None = None,
    ref_id: int | None = None,
    needs_answer: bool = False,
) -> Notification:
    """Add a card for `username` to the session. Does NOT commit.

    The caller commits, so the card is saved or dropped together with whatever caused it
    (for example, creating a space and the "you were added" cards are one transaction).
    """
    notification = Notification(
        username=username,
        type=type,
        message=message,
        space_id=space_id,
        space_name=space_name,
        ref_id=ref_id,
        needs_answer=needs_answer,
    )
    db.add(notification)
    return notification


def list_notifications(db: Session, username: str, before: int | None, limit: int) -> NotificationList:
    """Newest first. Pass the previous page's `next_before` as `before` to get the next page."""
    stmt = select(Notification).where(Notification.username == username)
    if before is not None:
        stmt = stmt.where(Notification.id < before)
    rows = db.scalars(stmt.order_by(Notification.id.desc()).limit(limit + 1)).all()
    page = rows[:limit]
    has_more = len(rows) > limit
    return NotificationList(
        items=[NotificationOut.model_validate(row) for row in page],
        next_before=page[-1].id if has_more else None,
        unread_count=get_unread_count(db, username),
    )


def get_unread_count(db: Session, username: str) -> int:
    """Every unread card of the caller (the badge on the bell)."""
    return db.scalar(select(func.count()).where(Notification.username == username, Notification.read.is_(False))) or 0


def set_read(db: Session, username: str, notification_id: int, read: bool) -> NotificationOut:
    """Mark a card read or unread. Someone else's card is reported as not found."""
    notification = db.scalar(
        select(Notification).where(Notification.id == notification_id, Notification.username == username)
    )
    if notification is None:
        raise api_error(404, "notification_not_found", "Notification not found.")
    notification.read = read
    db.commit()
    db.refresh(notification)
    return NotificationOut.model_validate(notification)


def mark_all_as_read(db: Session, username: str) -> int:
    """Notifications page, "mark all read": every unread card of the caller. Returns how many were unread."""
    result = db.execute(
        update(Notification).where(Notification.username == username, Notification.read.is_(False)).values(read=True)
    )
    db.commit()
    return result.rowcount or 0
