"""Push notifications (tasks 1.8.2 to 1.8.4): a queue written with every card, and a worker that sends from it.

How it fits together:
  * `enqueue` runs inside `notification_service.create_notification`, so every card (reminders included, task 1.8.4)
    also gets one `push_deliveries` row per phone of its owner, in the same transaction as the card. If the person has
    switched notifications off, is deleted, or has no phone registered, nothing is queued.
  * `deliver_pending` is the worker (run by the scheduler every PUSH_POLL_SECONDS). It sends outside any request, so a
    slow or failing push service never slows or fails the request that made the card (task 1.8.3).
  * A sender (`PushSender`: the console one for development, `fcm_sender.FcmSender` for Firebase) does the actual sending and answers SENT, INVALID_TOKEN (the phone is forgotten) or RETRY
    (tried again after 30 s, 60 s, 2 min and so on, and given up on after PUSH_MAX_ATTEMPTS).
  * The text is the card's own, unless PUSH_SHOW_DETAILS is false and the lock screen shows no names or amounts (B.7).

Only one worker may run at a time (the scheduler allows one run of the job at once). Several API processes would each
run one, so before running more than one, make the worker a separate process or claim rows with FOR UPDATE SKIP LOCKED.
"""

import enum
import logging
from datetime import datetime, timedelta
from typing import Protocol

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal, utcnow
from app.models.device_token import DeviceToken
from app.models.notification import Notification
from app.models.push_delivery import PushDelivery
from app.models.user import User

logger = logging.getLogger(__name__)

BATCH = 100  # pushes handled per run, oldest first
RETRY_BASE_SECONDS = 30  # the first retry waits this long, then twice as long each time


class PushResult(enum.Enum):
    SENT = "sent"
    INVALID_TOKEN = "invalid_token"  # the provider says this phone's token is dead: forget the phone
    RETRY = "retry"  # a temporary failure: try again later


class PushSender(Protocol):
    def send(self, token: str, platform: str, title: str, body: str, data: dict[str, str]) -> PushResult: ...


class ConsoleSender:
    """Development: writes the push to the server log instead of sending it."""

    def send(self, token: str, platform: str, title: str, body: str, data: dict[str, str]) -> PushResult:
        # WARNING level so it shows up in the default server output, as the console SMS backend does. Development only:
        # this puts the card's text in the log, so production refuses this backend.
        logger.warning("[push to %s device …%s] %s: %s %s", platform, token[-6:], title, body, data)
        return PushResult.SENT


_fcm: tuple[tuple[str, str], PushSender] | None = None  # built once: it holds the service-account credentials and their token


def get_sender() -> PushSender:
    """The sender PUSH_BACKEND names: "console" (development) or "fcm" (Firebase). Raises RuntimeError for anything else,
    or for "fcm" without its settings, so the worker logs it and the pushes wait instead of being lost."""
    global _fcm
    backend = settings.PUSH_BACKEND
    if backend == "console":
        return ConsoleSender()
    if backend == "fcm":
        key = (settings.FIREBASE_PROJECT_ID, settings.FIREBASE_CREDENTIALS_FILE)
        if _fcm is None or _fcm[0] != key:
            from app.services.fcm_sender import build_fcm_sender  # imported here: it imports this module too

            _fcm = (key, build_fcm_sender())
        return _fcm[1]
    raise RuntimeError(f"PUSH_BACKEND {backend!r} is not one of 'console' or 'fcm'")


def enqueue(db: Session, card: Notification) -> None:
    """Queue a push for each of the card owner's phones. Does NOT commit: it is saved or dropped with the card."""
    if not settings.PUSH_ENABLED:
        return
    with db.no_autoflush:  # looking is not a reason to write half-built rows the caller is still assembling
        device_ids = db.scalars(
            select(DeviceToken.id)
            .join(User, User.username == DeviceToken.username)
            .where(DeviceToken.username == card.username, User.notifications_on.is_(True), User.deleted_at.is_(None))
        ).all()
    if not device_ids:
        return
    db.flush()  # gives the card its id
    for device_id in device_ids:
        db.add(PushDelivery(notification_id=card.id, device_token_id=device_id))


def payload(card: Notification) -> tuple[str, str, dict[str, str]]:
    """(title, body, data) for one card. `data` tells the app which screen a tap opens."""
    data = {"type": card.type.value, "notification_id": str(card.id)}
    if card.space_id is not None:
        data["space_id"] = str(card.space_id)
    if card.ref_id is not None:
        data["ref_id"] = str(card.ref_id)
    if settings.PUSH_SHOW_DETAILS:
        return card.space_name or "UOMi", card.message, data  # the card's own text
    return "UOMi", "You have a new notification", data  # the lock screen shows no names or amounts


def _send(sender: PushSender, device: DeviceToken, card: Notification) -> PushResult:
    """One push. Anything the sender raises counts as a temporary failure."""
    title, body, data = payload(card)
    try:
        return sender.send(device.token, device.platform, title, body, data)
    except Exception:
        logger.exception("Push sender failed for delivery of card %s", card.id)
        return PushResult.RETRY


def deliver_pending(db: Session, sender: PushSender, now: datetime | None = None) -> dict[str, int]:
    """Send every push that is due (up to BATCH, oldest first). Returns how many were sent, dropped, retried, and how
    many phones were forgotten because the provider said their token is dead. Commits after each push."""
    now = now or utcnow()
    stats = {"sent": 0, "dropped": 0, "retried": 0, "invalid_devices": 0}
    due = db.scalars(
        select(PushDelivery.id).where(PushDelivery.next_attempt_at <= now).order_by(PushDelivery.id).limit(BATCH)
    ).all()

    for delivery_id in due:
        row = db.execute(
            select(PushDelivery, DeviceToken, Notification, User)
            .join(DeviceToken, DeviceToken.id == PushDelivery.device_token_id)
            .join(Notification, Notification.id == PushDelivery.notification_id)
            .join(User, User.username == Notification.username)
            .where(PushDelivery.id == delivery_id)
        ).first()
        if row is None:  # gone meanwhile: signed out, device removed, card deleted
            continue
        delivery, device, card, user = row

        if card.username != device.username or not user.notifications_on or user.deleted_at is not None:
            db.delete(delivery)  # the phone changed hands, or notifications are off, or the account is gone
            stats["dropped"] += 1
        else:
            result = _send(sender, device, card)
            if result is PushResult.SENT:
                db.delete(delivery)
                stats["sent"] += 1
            elif result is PushResult.INVALID_TOKEN:
                db.execute(delete(DeviceToken).where(DeviceToken.id == device.id))  # its queued pushes go with it
                stats["invalid_devices"] += 1
            else:  # RETRY: 30 s, 60 s, 2 min ... then give up
                delivery.attempts += 1
                if delivery.attempts >= settings.PUSH_MAX_ATTEMPTS:
                    db.delete(delivery)
                    stats["dropped"] += 1
                else:
                    delivery.next_attempt_at = now + timedelta(seconds=RETRY_BASE_SECONDS * 2 ** (delivery.attempts - 1))
                    stats["retried"] += 1
        db.commit()
    return stats


def run_push_job() -> None:
    """The scheduled run: a fresh session, and a log line only when something happened."""
    try:
        sender = get_sender()
    except RuntimeError:
        logger.exception("Push worker cannot start")
        return
    with SessionLocal() as db:
        stats = deliver_pending(db, sender)
    if any(stats.values()):
        logger.info("Push worker: %s", ", ".join(f"{count} {what}" for what, count in stats.items() if count))
