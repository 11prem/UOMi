"""Sign-in sessions: create, refresh, the inactivity timer, and ending a session.

A session is a set of columns on the person's `users` row (`session_id`, `refresh_token_hash`, `session_created_at`,
`last_activity_at`, `session_expires_at`), so a person has ONE signed-in device: signing in somewhere else replaces the
session, and the first device is told `session_expired` on its next request. It ends when:
  * the user is idle for SESSION_IDLE_TIMEOUT_MINUTES (checked on every authenticated request),
  * REFRESH_TOKEN_EXPIRE_DAYS have passed since sign-in (the absolute limit),
  * the user logs out, or resets their password,
  * a refresh token that was already swapped out is presented again (see `refresh_session`).
"""

import logging
import threading
import time
from collections import OrderedDict
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.database import utcnow
from app.models.user import STATUS_ACTIVE, User
from app.schemas.user import TokenPair
from app.utils import security
from app.utils.errors import BEARER_HEADERS, api_error

logger = logging.getLogger(__name__)

# The hash of each refresh token that was just swapped out -> (user id, session id, when to forget it). The `users` row
# keeps only the CURRENT token, so this small in-memory list is what lets a replayed old token be recognised and the
# session ended. It lives in this process only (it is forgotten on a restart, and each worker has its own), which is the
# same limit as the rate limiter: without it a replayed old token is simply refused as unknown.
_ROTATED_MAX = 20_000
_rotated: "OrderedDict[str, tuple[int, str, float]]" = OrderedDict()
_rotated_lock = threading.Lock()


def _remember_rotated(token_hash: str, user_id: int, session_id: str) -> None:
    forget_at = time.monotonic() + settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400
    with _rotated_lock:
        _rotated[token_hash] = (user_id, session_id, forget_at)
        _rotated.move_to_end(token_hash)
        while len(_rotated) > _ROTATED_MAX:
            _rotated.popitem(last=False)


def _was_rotated(token_hash: str) -> tuple[int, str] | None:
    with _rotated_lock:
        found = _rotated.get(token_hash)
        if found is None:
            return None
        if found[2] <= time.monotonic():
            del _rotated[token_hash]
            return None
        return found[0], found[1]


def _idle_limit() -> timedelta:
    return timedelta(minutes=settings.SESSION_IDLE_TIMEOUT_MINUTES)


def _token_pair(session_id: str, username: str, refresh_token: str) -> TokenPair:
    return TokenPair(
        access_token=security.create_access_token(username, session_id),
        refresh_token=refresh_token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        idle_timeout_seconds=settings.SESSION_IDLE_TIMEOUT_MINUTES * 60,
    )


def _end_reason(user: User, now: datetime) -> str | None:
    """Why the session is over: "expired", "idle", or None while it is still alive."""
    if user.session_expires_at is None or user.last_activity_at is None:
        return "ended"
    if user.session_expires_at <= now:
        return "expired"
    if now - user.last_activity_at > _idle_limit():
        return "idle"
    return None


def _session_ended(reason: str | None = None) -> HTTPException:
    """The 401 that tells the app to send the user back to the Login page."""
    if reason == "idle":
        message = f"You were signed out after {settings.SESSION_IDLE_TIMEOUT_MINUTES} minutes of inactivity."
    elif reason == "expired":
        message = "Your session has expired. Please sign in again."
    else:
        message = "Your session has ended. Please sign in again."
    return api_error(401, "session_expired", message, headers=BEARER_HEADERS)


def _clear_session_values() -> dict:
    return {
        "session_id": None,
        "refresh_token_hash": None,
        "session_created_at": None,
        "last_activity_at": None,
        "session_expires_at": None,
    }


def create_session(db: Session, user: User) -> TokenPair:
    """Start a session for a user who just signed up or signed in. Does not commit.

    A session that was already open is replaced: the old access and refresh tokens stop working.
    """
    now = utcnow()
    refresh_token = security.new_opaque_token()
    user.session_id = security.new_session_id()
    user.refresh_token_hash = security.hash_token(refresh_token)
    user.session_created_at = now
    user.last_activity_at = now
    user.session_expires_at = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    db.flush()
    return _token_pair(user.session_id, user.username, refresh_token)


def authenticate_session(db: Session, username: str, session_id: str) -> User:
    """Called on every authenticated request: finds the person and runs the inactivity timer.

    Raises 401 `session_expired` if the person or the session is gone, was replaced by a sign-in elsewhere, was idle for
    too long, or is past its absolute limit (and ends it). Otherwise moves `last_activity_at` forward, writing to the
    database at most once per SESSION_TOUCH_INTERVAL_SECONDS.
    """
    now = utcnow()
    user = db.scalar(select(User).where(User.username == username))
    if user is None or user.status != STATUS_ACTIVE or user.session_id is None or user.session_id != session_id:
        raise _session_ended()
    reason = _end_reason(user, now)
    if reason is not None:
        end_session(db, session_id)
        raise _session_ended(reason)
    if (now - user.last_activity_at).total_seconds() >= settings.SESSION_TOUCH_INTERVAL_SECONDS:
        user.last_activity_at = now
        db.commit()
    return user


def _invalid_refresh_token() -> HTTPException:
    return api_error(
        401, "invalid_refresh_token", "Invalid refresh token. Please sign in again.", headers=BEARER_HEADERS
    )


def _end_for_reuse(db: Session, user_id: int, session_id: str) -> None:
    """A refresh token was used twice: end the session, so neither copy of the token works any more."""
    logger.warning("Refresh token reused: ending session %s of user %s", session_id, user_id)
    db.execute(
        update(User)
        .where(User.id == user_id, User.session_id == session_id)
        .values(**_clear_session_values())
        .execution_options(synchronize_session=False)
    )
    db.commit()


def refresh_session(db: Session, refresh_token: str) -> TokenPair:
    """Swap a refresh token for a new access token and a new refresh token (the old one stops working).

    Refreshing counts as activity, but only for a session that is still alive: an idle session
    cannot be revived by refreshing.

    Reuse detection: the hash of the token just swapped out is remembered (in memory, see `_rotated`). If that old token
    is presented again, someone holds a copy that the rightful owner has already replaced, so the whole session is ended
    (the owner has to sign in again). The reply is the same `invalid_refresh_token` as for any unknown token, so it does
    not tell an attacker they were caught.

    The swap is one conditional UPDATE (`... WHERE refresh_token_hash = <the token presented>`), not a read
    followed by a write, so two parallel requests with the same token cannot both succeed: one of
    them updates no row, and that counts as reuse.
    """
    now = utcnow()
    presented = security.hash_token(refresh_token)
    user = db.scalar(select(User).where(User.refresh_token_hash == presented, User.status == STATUS_ACTIVE))
    if user is None:
        reused = _was_rotated(presented)
        if reused is not None:
            _end_for_reuse(db, *reused)
        raise _invalid_refresh_token()
    reason = _end_reason(user, now)
    if reason is not None:
        session_id = user.session_id
        end_session(db, session_id)
        raise _session_ended(reason)

    user_id, session_id, username = user.id, user.session_id, user.username
    new_refresh_token = security.new_opaque_token()
    swapped = db.execute(
        update(User)
        .where(User.id == user_id, User.refresh_token_hash == presented)
        .values(refresh_token_hash=security.hash_token(new_refresh_token), last_activity_at=now)
        .execution_options(synchronize_session=False)
    )
    if swapped.rowcount != 1:  # another request swapped this same token first
        _end_for_reuse(db, user_id, session_id)
        raise _invalid_refresh_token()
    db.commit()
    _remember_rotated(presented, user_id, session_id)
    return _token_pair(session_id, username, new_refresh_token)


def end_session(db: Session, session_id: str) -> None:
    """Logout: clear the session. The access token stops working at once."""
    db.execute(
        update(User).where(User.session_id == session_id).values(**_clear_session_values()).execution_options(synchronize_session=False)
    )
    db.commit()


def end_all_sessions(db: Session, user_id: int, *, commit: bool = True) -> None:
    """Sign a user out everywhere (used after a password reset)."""
    db.execute(
        update(User).where(User.id == user_id).values(**_clear_session_values()).execution_options(synchronize_session=False)
    )
    if commit:
        db.commit()
