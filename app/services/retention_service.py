"""The clean-up job (task 1.7.4): delete what has outlived its use, so these tables stay bounded.

What goes, and when (all times are counted back from now):
  - refresh_tokens   the session ended for good (its absolute end passed) more than a day ago;
  - login_attempts   older than the sign-in lockout window, so they no longer count against anyone;
  - password_resets  made more than a day ago (a code lives 5 minutes, a request 30);
  - pending_signups  ended more than a day ago, verified or not;
  - notifications    older than NOTIFICATION_RETENTION_DAYS and not still asking a question;
  - device_tokens    phones not seen for DEVICE_TOKEN_RETENTION_DAYS (the app registers on every launch).

Rows are kept for a day after they stop mattering, never less: the daily text cap counts sign-up and reset rows made today
(see otp_service.enforce_daily_code_cap), so clearing them sooner would let the cap be dodged.
"""

import logging
from datetime import datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal, utcnow
from app.models.device_token import DeviceToken
from app.models.login_attempt import LoginAttempt
from app.models.notification import Notification
from app.models.password_reset import PasswordReset
from app.models.pending_signup import PendingSignup
from app.models.refresh_token import RefreshToken

logger = logging.getLogger(__name__)
GRACE = timedelta(days=1)


def purge_expired(db: Session, now: datetime | None = None) -> dict[str, int]:
    """Delete every expired row of the tables above and commit. Returns how many went from each table."""
    now = now or utcnow()
    statements = {
        "refresh_tokens": delete(RefreshToken).where(RefreshToken.expires_at <= now - GRACE),
        "login_attempts": delete(LoginAttempt).where(LoginAttempt.attempted_at <= now - timedelta(minutes=settings.LOGIN_LOCKOUT_MINUTES)),
        "password_resets": delete(PasswordReset).where(PasswordReset.created_at <= now - GRACE),
        "pending_signups": delete(PendingSignup).where(PendingSignup.valid_until <= now - GRACE),
        "notifications": delete(Notification).where(
            Notification.created_at <= now - timedelta(days=settings.NOTIFICATION_RETENTION_DAYS),
            Notification.needs_answer.is_(False),
        ),
        "device_tokens": delete(DeviceToken).where(DeviceToken.last_seen_at <= now - timedelta(days=settings.DEVICE_TOKEN_RETENTION_DAYS)),
    }
    removed = {table: db.execute(statement).rowcount for table, statement in statements.items()}
    db.commit()
    return removed


def run_retention_job() -> None:
    """The scheduled run: a fresh session, and a log line only when something was deleted."""
    with SessionLocal() as db:
        removed = purge_expired(db)
    if any(removed.values()):
        logger.info("Clean-up removed %s", ", ".join(f"{count} {table}" for table, count in removed.items() if count))
