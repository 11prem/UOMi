"""The clean-up job (task 1.7.4): delete what has outlived its use, so the data stays bounded.

What goes, and when (all times are counted back from now):
  - sign-ups          a `users` row still `pending` whose code request was forgotten more than a day ago (a person who
                      never verified): the row is deleted, which frees the username, email and phone it held;
  - sessions          the columns of a session that ended for good (its absolute end passed) more than a day ago are cleared;
  - lockouts          the failed sign-in count of a person whose window has run out is cleared;
  - password resets   the code and token columns of a reset that ran out more than a day ago are cleared;
  - notifications     older than NOTIFICATION_RETENTION_DAYS and not still asking a question.

Nothing is cleaned sooner than a day after it stops mattering.
"""

import logging
from datetime import datetime, timedelta

from sqlalchemy import delete, or_, update
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal, utcnow
from app.models.notification import Notification
from app.models.user import STATUS_PENDING, User

logger = logging.getLogger(__name__)
GRACE = timedelta(days=1)


def purge_expired(db: Session, now: datetime | None = None) -> dict[str, int]:
    """Clean every kind of expired data listed above and commit. Returns how many rows were cleaned of each kind."""
    now = now or utcnow()
    ttl, flow = timedelta(minutes=settings.OTP_TTL_MINUTES), timedelta(minutes=settings.OTP_FLOW_TTL_MINUTES)
    quiet = {"synchronize_session": False}
    statements = {
        # A sign-up's request is forgotten at `signup_expires_at - ttl + flow`.
        "signups": delete(User).where(
            User.status == STATUS_PENDING,
            or_(User.signup_expires_at.is_(None), User.signup_expires_at <= now - GRACE + ttl - flow),
        ),
        "sessions": update(User)
        .where(User.session_expires_at.is_not(None), User.session_expires_at <= now - GRACE)
        .values(session_id=None, refresh_token_hash=None, session_created_at=None, last_activity_at=None, session_expires_at=None),
        "lockouts": update(User)
        .where(
            User.first_failed_login_at.is_not(None),
            User.first_failed_login_at <= now - timedelta(minutes=settings.LOGIN_LOCKOUT_MINUTES),
        )
        .values(failed_login_count=0, first_failed_login_at=None, locked_until=None),
        "password_resets": update(User)
        .where(
            or_(User.reset_code_expires_at.is_not(None), User.reset_token_expires_at.is_not(None), User.reset_used_at.is_not(None)),
            or_(User.reset_code_expires_at.is_(None), User.reset_code_expires_at <= now - GRACE + ttl - flow),
            or_(User.reset_token_expires_at.is_(None), User.reset_token_expires_at <= now - GRACE),
            or_(User.reset_used_at.is_(None), User.reset_used_at <= now - GRACE),
        )
        .values(
            reset_code_hash=None,
            reset_attempts=0,
            reset_code_expires_at=None,
            reset_verified_at=None,
            reset_token_hash=None,
            reset_token_expires_at=None,
            reset_used_at=None,
        ),
        "notifications": delete(Notification).where(
            Notification.created_at <= now - timedelta(days=settings.NOTIFICATION_RETENTION_DAYS),
            Notification.needs_answer.is_(False),
        ),
    }
    removed = {}
    for table, statement in statements.items():
        removed[table] = db.execute(statement.execution_options(**quiet)).rowcount
    db.commit()
    return removed


def run_retention_job() -> None:
    """The scheduled run: a fresh session, and a log line only when something was cleaned."""
    with SessionLocal() as db:
        removed = purge_expired(db)
    if any(removed.values()):
        logger.info("Clean-up removed %s", ", ".join(f"{count} {table}" for table, count in removed.items() if count))
