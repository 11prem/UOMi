"""Sign-in sessions: create, refresh, the inactivity timer, and ending a session.

A session is one row in `refresh_tokens`. It ends when:
  * the user is idle for SESSION_IDLE_TIMEOUT_MINUTES (checked on every authenticated request),
  * REFRESH_TOKEN_EXPIRE_DAYS have passed since sign-in (the absolute limit),
  * the user logs out, or resets their password.
"""

from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import utcnow
from app.models.refresh_token import RefreshToken
from app.schemas.user import TokenPair
from app.utils import security
from app.utils.errors import BEARER_HEADERS, api_error


def _idle_limit() -> timedelta:
    return timedelta(minutes=settings.SESSION_IDLE_TIMEOUT_MINUTES)


def _token_pair(session: RefreshToken, refresh_token: str) -> TokenPair:
    return TokenPair(
        access_token=security.create_access_token(session.username, session.id),
        refresh_token=refresh_token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        idle_timeout_seconds=settings.SESSION_IDLE_TIMEOUT_MINUTES * 60,
    )


def _end_reason(session: RefreshToken, now) -> str | None:
    """Why the session is over: "expired", "idle", or None while it is still alive."""
    if session.expires_at <= now:
        return "expired"
    if now - session.last_activity_at > _idle_limit():
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


def create_session(db: Session, username: str) -> TokenPair:
    """Start a session for a user who just signed up or signed in. Does not commit."""
    now = utcnow()
    # Housekeeping: drop this user's sessions that are already dead.
    db.execute(
        delete(RefreshToken).where(
            RefreshToken.username == username,
            or_(RefreshToken.expires_at <= now, RefreshToken.last_activity_at <= now - _idle_limit()),
        )
    )
    refresh_token = security.new_opaque_token()
    session = RefreshToken(
        username=username,
        token_hash=security.hash_token(refresh_token),
        created_at=now,
        last_activity_at=now,
        expires_at=now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(session)
    db.flush()  # fills in session.id, which goes into the access token
    return _token_pair(session, refresh_token)


def touch_session(db: Session, session_id: str, username: str) -> None:
    """Called on every authenticated request: the inactivity timer.

    Raises 401 `session_expired` if the session is gone, idle for too long, or past its absolute
    limit (and deletes it). Otherwise moves `last_activity_at` forward, writing to the database
    at most once per SESSION_TOUCH_INTERVAL_SECONDS.
    """
    now = utcnow()
    session = db.get(RefreshToken, session_id)
    if session is None or session.username != username:
        raise _session_ended()
    reason = _end_reason(session, now)
    if reason is not None:
        db.delete(session)
        db.commit()
        raise _session_ended(reason)
    if (now - session.last_activity_at).total_seconds() >= settings.SESSION_TOUCH_INTERVAL_SECONDS:
        session.last_activity_at = now
        db.commit()


def refresh_session(db: Session, refresh_token: str) -> TokenPair:
    """Swap a refresh token for a new access token and a new refresh token (the old one stops working).

    Refreshing counts as activity, but only for a session that is still alive: an idle session
    cannot be revived by refreshing.
    """
    now = utcnow()
    session = db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == security.hash_token(refresh_token))
    )
    if session is None:
        raise api_error(
            401, "invalid_refresh_token", "Invalid refresh token. Please sign in again.", headers=BEARER_HEADERS
        )
    reason = _end_reason(session, now)
    if reason is not None:
        db.delete(session)
        db.commit()
        raise _session_ended(reason)
    new_refresh_token = security.new_opaque_token()
    session.token_hash = security.hash_token(new_refresh_token)
    session.last_activity_at = now
    db.commit()
    return _token_pair(session, new_refresh_token)


def end_session(db: Session, session_id: str) -> None:
    """Logout: delete the session. The access token stops working at once."""
    db.execute(delete(RefreshToken).where(RefreshToken.id == session_id))
    db.commit()


def end_all_sessions(db: Session, username: str, *, commit: bool = True) -> None:
    """Sign a user out everywhere (used after a password reset)."""
    db.execute(delete(RefreshToken).where(RefreshToken.username == username))
    if commit:
        db.commit()
