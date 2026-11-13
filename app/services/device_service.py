"""Registering and removing the phones that get push notifications (task 1.8.1).

The app calls `register_device` on every launch (it also refreshes `last_seen_at`) and `remove_device` on sign-out.
A phone belongs to the sign-in it was registered with, so the database removes it when that sign-in ends.
"""

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import utcnow
from app.models.device_token import DeviceToken
from app.models.push_delivery import PushDelivery
from app.models.user import User

MAX_DEVICES = 10  # per person: the ones seen longest ago are dropped


def register_device(db: Session, user: User, session_id: str, token: str, platform: str) -> None:
    """Save this phone as one of the person's. Calling it again for the same phone only refreshes it."""
    try:
        _register(db, user.username, session_id, token, platform)
    except IntegrityError:  # two requests registered the same new token at once: the other won, so update its row
        db.rollback()
        _register(db, user.username, session_id, token, platform)


def _register(db: Session, username: str, session_id: str, token: str, platform: str) -> None:
    now = utcnow()
    device = db.scalar(select(DeviceToken).where(DeviceToken.token == token))
    if device is None:
        db.add(DeviceToken(username=username, session_id=session_id, token=token, platform=platform, created_at=now, last_seen_at=now))
    else:
        if device.username != username:  # the phone changed hands: nothing queued for the old owner may reach it
            db.execute(delete(PushDelivery).where(PushDelivery.device_token_id == device.id))
        device.username = username
        device.session_id = session_id
        device.platform = platform
        device.last_seen_at = now
    db.flush()
    mine = db.scalars(select(DeviceToken).where(DeviceToken.username == username).order_by(DeviceToken.last_seen_at.desc(), DeviceToken.id.desc())).all()
    for extra in mine[MAX_DEVICES:]:  # keep at most MAX_DEVICES phones per person: drop the ones seen longest ago
        db.delete(extra)
    db.commit()


def remove_device(db: Session, user: User, token: str) -> None:
    """Forget this phone (sign-out). Never an error: an unknown token, or one that is somebody else's, changes nothing."""
    db.execute(delete(DeviceToken).where(DeviceToken.token == token, DeviceToken.username == user.username))
    db.commit()
