"""Texted one-time codes, shared by sign-up verification (`PendingSignup`) and forgot password (`PasswordReset`).

The rules (specs § 3.4), all enforced here so the two flows cannot drift apart:
  - A code is valid OTP_TTL_MINUTES (5). Expired: `code_expired`.
  - A wrong code is `invalid_code`. The OTP_MAX_ATTEMPTS-th wrong code (5) locks that sign-up or reset for
    OTP_LOCK_MINUTES (10): `otp_locked` with `retry_after_seconds`. While locked every guess is refused, the right
    code included, and so is "resend".
  - "Resend code" gives the SAME request a fresh code, after OTP_RESEND_COOLDOWN_SECONDS (30): `resend_too_soon`.
    A request gets at most OTP_MAX_SENDS_PER_REQUEST texts (3), the first included.
  - A phone number (sign-up) or typed username (forgot) can start at most OTP_MAX_REQUESTS_PER_HOUR requests an
    hour, and the whole API sends at most SMS_DAILY_CAP texts a UTC day. These limits hold under a parallel burst.
Each of these has its own error code, so the app can show the spec's own words for each.

Both tables hold the same columns for this (`code_hash`, `attempts`, `locked_until`, `send_count`, `last_sent_at`,
`expires_at`, `valid_until`, `phone`), so every function here takes the model class.
"""

import logging
import math
import secrets
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.models.password_reset import PasswordReset
from app.models.pending_signup import PendingSignup
from app.services import sms_service
from app.utils import security
from app.utils.errors import api_error
from app.utils.validators import mask_phone

logger = logging.getLogger(__name__)

SIGNUP_PREFIX = "su_"  # a `pending_id` starts with this, a `reset_id` with RESET_PREFIX: "resend" tells them apart
RESET_PREFIX = "pw_"
NEVER_MATCHES = "x" * 64  # the stored hash of a code nobody was sent: not valid hex, so no guess can equal it


def new_public_id(prefix: str) -> str:
    """The unguessable id the app holds for a sign-up or reset request."""
    return prefix + secrets.token_urlsafe(16)


# --- errors -------------------------------------------------------------------------------------------


def _wait(status: int, code: str, message: str, seconds: int):
    seconds = max(1, seconds)
    return api_error(status, code, message, headers={"Retry-After": str(seconds)}, retry_after_seconds=seconds)


def locked_error(seconds: float):
    seconds = math.ceil(seconds)
    minutes = max(1, math.ceil(seconds / 60))
    return _wait(
        429, "otp_locked", f"Too many attempts — try again in {minutes} minute{'s' if minutes != 1 else ''}", seconds
    )


def invalid_code_error():
    return api_error(400, "invalid_code", "That code is incorrect")


def code_expired_error():
    return api_error(400, "code_expired", "Code expired — resend")


def not_found_error():
    return api_error(404, "verification_not_found", "We couldn't find that verification. Please start again.")


def request_expired_error():
    return api_error(400, "verification_expired", "This verification has expired. Please start again.")


def resend_too_soon_error(seconds: float):
    seconds = math.ceil(seconds)
    return _wait(429, "resend_too_soon", f"Please wait {max(1, seconds)} seconds before asking for another code.", seconds)


# --- sending ------------------------------------------------------------------------------------------


def send_code_text(phone: str, code: str) -> None:
    """Runs after the reply has gone out. A failure is logged, never raised: it cannot change the reply."""
    try:
        sms_service.send_sms(
            phone,
            f"Your UOMi code is {code}. It expires in {settings.OTP_TTL_MINUTES} minutes. Do not share it with anyone.",
        )
    except Exception:
        logger.exception("Could not send the one-time code text")


def fake_masked_phone(username: str) -> str:
    """The masked number shown for a username that does not exist, so the reply looks like any other.

    It is derived from the username under the OTP key: asking again for the same name gives the same number, as it
    would for a real account, and nobody can tell a made-up number from a real +91 one.
    """
    digest = security.keyed_digest("made-up-phone", username)
    digits = [str(byte % 10) for byte in digest[:10]]
    digits[0] = str(6 + digest[10] % 4)  # an Indian mobile number starts with 6, 7, 8 or 9
    return mask_phone(f"{settings.DEFAULT_COUNTRY_CODE}{''.join(digits)}")


# --- limits -------------------------------------------------------------------------------------------


def enforce_daily_code_cap(db: Session, now: datetime, *, mine: bool = False, warn: bool = True) -> None:
    """The last-resort brake on the SMS bill: at most SMS_DAILY_CAP texts a (UTC) day, for everyone together.

    Counted from `send_count` of the rows created today (the first text and every resend), in both tables. A
    sign-up's row is kept after it is verified (marked used), and rows are never deleted on the day they are made,
    so the count cannot be reset by finishing or abandoning sign-ups. A resend of a request made before midnight is
    counted on the day the request began.

    `mine` says the request being checked is already recorded (and committed) and is the newest text counted: it is
    refused when everyone else's texts already fill the cap. Either way the rule is the same: refused when the OTHER
    texts of the day are `cap` or more.
    """
    cap = settings.SMS_DAILY_CAP
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    total = sum(
        db.scalar(select(func.coalesce(func.sum(model.send_count), 0)).where(model.created_at >= day_start)) or 0
        for model in (PasswordReset, PendingSignup)
    )
    others = total - 1 if mine else total
    if others >= cap:
        retry_after = max(1, math.ceil((day_start + timedelta(days=1) - now).total_seconds()))
        logger.error("Daily code cap of %s reached: refusing code requests until UTC midnight", cap)
        raise _wait(429, "too_many_requests", "We can't send more codes right now. Please try again later.", retry_after)
    if warn and others + 1 == math.ceil(cap * 0.8):
        logger.warning("Daily code cap: %s of %s used", others + 1, cap)


def _enforce_start_limits(db: Session, model, key_column, key_value: str, now: datetime, mine_id: int | None) -> None:
    """At most OTP_MAX_REQUESTS_PER_HOUR requests per key in an hour, and the resend cooldown between them.

    The key is the phone number for sign-ups and the typed username for forgot password. Requests for a name that
    does not exist are written and counted exactly like real ones, so these refusals reveal nothing.
    """
    recent = db.scalars(
        select(model).where(key_column == key_value, model.created_at > now - timedelta(hours=1)).order_by(model.created_at.desc())
    ).all()  # newest first
    others = [row for row in recent if row.id != mine_id]  # `mine_id` is the request being checked, if it is recorded
    per_hour = settings.OTP_MAX_REQUESTS_PER_HOUR
    if len(others) >= per_hour:
        wait = (others[per_hour - 1].created_at + timedelta(hours=1) - now).total_seconds()
        raise _wait(429, "too_many_requests", "Too many codes requested. Try again later.", math.ceil(wait))
    if others:
        last_text = max(others[0].last_sent_at or others[0].created_at, others[0].created_at)
        elapsed = (now - last_text).total_seconds()
        if elapsed < settings.OTP_RESEND_COOLDOWN_SECONDS:
            raise resend_too_soon_error(settings.OTP_RESEND_COOLDOWN_SECONDS - elapsed)


def check_limits(db: Session, model, key_column, key_value: str, now: datetime, *, mine_id: int | None = None) -> None:
    """The limits on starting a sign-up or a forgot-password request: per key (hourly and cooldown), then the daily cap.

    Called twice for each new request. First before anything is written, a cheap refusal that saves the password
    hash. Then again right after the request has been recorded AND committed (`mine_id`), which is what stops a
    parallel burst: a check that reads and a row that is written much later let ten simultaneous requests all pass.
    Recording first closes that (the same way the sign-in lockout does): the k-th request to be committed sees at least
    k rows, so only the first few get through, and a request that is refused takes its own row back out.
    """
    try:
        _enforce_start_limits(db, model, key_column, key_value, now, mine_id)
        enforce_daily_code_cap(db, now, mine=mine_id is not None, warn=mine_id is not None)
    except HTTPException:
        if mine_id is not None:
            db.execute(delete(model).where(model.id == mine_id))
            db.commit()
        raise


# --- checking a code ----------------------------------------------------------------------------------


def check_code(db: Session, model, row, code: str, now: datetime) -> None:
    """Return quietly if `code` is the right, unexpired code and the request is not locked. Otherwise raise.

    The guess is counted in one UPDATE ... RETURNING, so parallel guesses each get their own attempt number and a
    burst cannot get more than OTP_MAX_ATTEMPTS guesses in before the lock. The code is compared only after it has
    been counted. The lock that follows the last wrong guess is set here, and a lock that has run out is lifted
    here: the next guesses start from zero again.
    """
    # Everything needed is copied out first. A commit marks the row's attributes as stale, and reading a stale one
    # re-queries the row, which a parallel request may have deleted (a sign-up that was just used up).
    row_id, stored_hash, phone = row.id, row.code_hash, row.phone
    locked_until, expires_at = row.locked_until, row.expires_at

    if locked_until is not None:
        if locked_until > now:
            raise locked_error((locked_until - now).total_seconds())
        db.execute(
            update(model)
            .where(model.id == row_id, model.locked_until <= now)
            .values(locked_until=None, attempts=0)
            .execution_options(synchronize_session=False)
        )
        db.commit()
    if expires_at <= now:
        raise code_expired_error()

    attempts = db.execute(
        update(model)
        .where(
            model.id == row_id,
            model.attempts < settings.OTP_MAX_ATTEMPTS,
            model.locked_until.is_(None),
            model.expires_at > now,
        )
        .values(attempts=model.attempts + 1)
        .returning(model.attempts)
        .execution_options(synchronize_session=False)
    ).scalar_one_or_none()
    db.commit()
    if attempts is None:  # out of guesses (the lock may not be written yet), locked a moment ago, just expired, or used up
        current = db.execute(
            select(model.locked_until, model.attempts).where(model.id == row_id)
        ).one_or_none()
        if current is None:  # a parallel request used this sign-up up (the account was created) a moment ago
            raise not_found_error()
        if current.locked_until is not None and current.locked_until > now:
            raise locked_error((current.locked_until - now).total_seconds())
        if current.attempts >= settings.OTP_MAX_ATTEMPTS:
            raise locked_error(settings.OTP_LOCK_MINUTES * 60)
        raise code_expired_error()

    if security.safe_equal(stored_hash, security.hash_otp(phone, code)):
        return
    if attempts >= settings.OTP_MAX_ATTEMPTS:
        lock_until = now + timedelta(minutes=settings.OTP_LOCK_MINUTES)
        db.execute(
            update(model)
            .where(model.id == row_id, model.locked_until.is_(None))
            .values(locked_until=lock_until)
            .execution_options(synchronize_session=False)
        )
        db.commit()
        raise locked_error(settings.OTP_LOCK_MINUTES * 60)
    raise invalid_code_error()


# --- resending ----------------------------------------------------------------------------------------


def renew_code(db: Session, model, row, now: datetime) -> str:
    """The "Resend code" link: a fresh code for the same request. Returns it; the caller texts it.

    Refused while locked (so the lock cannot be skipped by asking again), inside the cooldown, and after
    OTP_MAX_SENDS_PER_REQUEST texts. The new code starts from zero wrong guesses.
    """
    if row.locked_until is not None and row.locked_until > now:
        raise locked_error((row.locked_until - now).total_seconds())
    last_text = row.last_sent_at or row.created_at
    elapsed = (now - last_text).total_seconds()
    if elapsed < settings.OTP_RESEND_COOLDOWN_SECONDS:
        raise resend_too_soon_error(settings.OTP_RESEND_COOLDOWN_SECONDS - elapsed)
    if row.send_count >= settings.OTP_MAX_SENDS_PER_REQUEST:
        wait = (row.created_at + timedelta(hours=1) - now).total_seconds()
        raise _wait(429, "too_many_requests", "Too many codes requested. Try again later.", math.ceil(max(wait, 60)))
    enforce_daily_code_cap(db, now)

    code = security.generate_otp()
    claimed = db.execute(
        update(model)
        .where(model.id == row.id, model.send_count == row.send_count)  # a parallel resend that won leaves 0 rows here
        .values(
            code_hash=security.hash_otp(row.phone, code),
            attempts=0,
            locked_until=None,
            send_count=row.send_count + 1,
            last_sent_at=now,
            expires_at=now + timedelta(minutes=settings.OTP_TTL_MINUTES),
            valid_until=now + timedelta(minutes=settings.OTP_FLOW_TTL_MINUTES),
        )
        .execution_options(synchronize_session=False)
    )
    db.commit()
    if claimed.rowcount != 1:
        raise resend_too_soon_error(settings.OTP_RESEND_COOLDOWN_SECONDS)
    return code
