"""Emailed one-time codes, shared by sign-up verification and forgot password.

The codes live in columns of the `users` row (a sign-up is a row with `status = 'pending'`; a password reset uses the
`reset_*` columns), so each person has at most ONE open sign-up code and ONE open reset code. A new request replaces the
old code of its kind.

The rules (specs § 3.4), all enforced here so the two flows cannot drift apart:
  - A code is valid OTP_TTL_MINUTES (5). Expired: `code_expired`.
  - A wrong code is `invalid_code`. The OTP_MAX_ATTEMPTS-th wrong code (5) locks that sign-up or reset for
    OTP_LOCK_MINUTES (10): `otp_locked` with `retry_after_seconds`. While locked every guess is refused, the right
    code included, and so is "resend". The lock is stored in the columns that exist: it is "attempts used up, and the
    expiry moved OTP_LOCK_MINUTES ahead", so there is no column for it.
  - "Resend code" gives the SAME request a fresh code, after OTP_RESEND_COOLDOWN_SECONDS (30): `resend_too_soon`.
    A request gets at most OTP_MAX_SENDS_PER_REQUEST emails (3), the first included.
  - An email address (sign-up) or typed username (forgot) can start at most OTP_MAX_REQUESTS_PER_HOUR requests an
    hour, and the whole API sends at most EMAIL_DAILY_CAP emails in 24 hours.
Each of these has its own error code, so the app can show the spec's own words for each.

What the `users` columns cannot hold (how many emails one request has sent, how many requests an address made this
hour, how many emails went out today) is counted in memory by the rate limiter (utils/rate_limit.py). Those counters
are exact inside one API process and forgotten on a restart, like every other limit there.
"""

import base64
import logging
import math
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.models.user import STATUS_ACTIVE, User
from app.services import email_service
from app.utils import security
from app.utils.errors import api_error
from app.utils.rate_limit import HOUR, limiter
from app.utils.validators import mask_email

logger = logging.getLogger(__name__)

SIGNUP_PREFIX = "su_"  # a `pending_id` starts with this, a `reset_id` with RESET_PREFIX: "resend" tells them apart
RESET_PREFIX = "pw_"
DAY = 86400


@dataclass(frozen=True)
class Channel:
    """The three `users` columns that hold one kind of code."""

    code_hash: str
    attempts: str
    expires_at: str


SIGNUP = Channel("signup_code_hash", "signup_attempts", "signup_expires_at")
RESET = Channel("reset_code_hash", "reset_attempts", "reset_code_expires_at")


def new_pending_id() -> str:
    """The unguessable id the app holds for a sign-up."""
    return SIGNUP_PREFIX + secrets.token_urlsafe(16)


# --- the reset id ---------------------------------------------------------------------------------------
#
# A password reset has no id column, so the `reset_id` the app holds is made so that the server can read it back
# without storing it: a random nonce, the user's id scrambled with a key derived from the nonce, and a signature. It tells
# nothing about whose id it is (a request for a username that does not exist gets one of the same shape, carrying id 0),
# and nobody can forge one.


def make_reset_id(user_id: int) -> str:
    """The `reset_id` for this person, or for nobody (0) when the username does not exist."""
    nonce = secrets.token_bytes(8)
    pad = security.keyed_digest("reset-id-pad", nonce.hex())[:4]
    scrambled = (user_id ^ int.from_bytes(pad, "big")).to_bytes(4, "big")
    body = nonce + scrambled
    signature = security.keyed_digest("reset-id-signature", body.hex())[:8]
    return RESET_PREFIX + base64.urlsafe_b64encode(body + signature).decode("ascii").rstrip("=")


def read_reset_id(reset_id: str) -> int | None:
    """The user id inside a `reset_id` (0 for a made-up one), or None when it is not one this server made."""
    if not reset_id.startswith(RESET_PREFIX):
        return None
    text = reset_id[len(RESET_PREFIX):]
    try:
        raw = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except (ValueError, TypeError):
        return None
    if len(raw) != 20:
        return None
    body, signature = raw[:12], raw[12:]
    if not security.safe_equal(signature.hex(), security.keyed_digest("reset-id-signature", body.hex())[:8].hex()):
        return None
    pad = security.keyed_digest("reset-id-pad", body[:8].hex())[:4]
    return int.from_bytes(body[8:], "big") ^ int.from_bytes(pad, "big")


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


def too_many_requests_error(seconds: float):
    return _wait(429, "too_many_requests", "Too many codes requested. Try again later.", math.ceil(seconds))


# --- sending ------------------------------------------------------------------------------------------


def send_code_email(email: str, code: str) -> None:
    """Runs after the reply has gone out. A failure is logged, never raised: it cannot change the reply."""
    try:
        email_service.send_email(
            email,
            "Your UOMi code",
            f"Your UOMi code is {code}. It expires in {settings.OTP_TTL_MINUTES} minutes. Do not share it with anyone.",
        )
    except Exception:
        logger.exception("Could not send the one-time code email")


FAKE_LOCAL_LENGTHS = range(5, 11)  # a made-up local part is this many characters, like the names real people use
_FAKE_LOCAL_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"


def fake_masked_email(db: Session, username: str) -> str:
    """The masked email shown for a username that does not exist, so the reply looks like any other.

    It is derived from the username under the OTP key: asking again for the same name gives the same address, as it
    would for a real account. Its domain is copied from a real user's email (chosen by the same key), so the mix of
    domains matches the real accounts. A made-up address that was always at one fixed domain would give away every
    real account whose email is anywhere else. With no users at all it falls back to example.com.
    """
    digest = security.keyed_digest("made-up-email", username)
    domain = "example.com"
    live = (User.status == STATUS_ACTIVE, User.email.is_not(None))
    count = db.scalar(select(func.count()).select_from(User).where(*live)) or 0
    if count:
        pick = int.from_bytes(digest[16:20], "big") % count
        real_email = db.scalar(select(User.email).where(*live).order_by(User.username).offset(pick).limit(1))
        domain = real_email.partition("@")[2] or domain
    length = FAKE_LOCAL_LENGTHS[digest[20] % len(FAKE_LOCAL_LENGTHS)]
    local = "".join(_FAKE_LOCAL_ALPHABET[byte % len(_FAKE_LOCAL_ALPHABET)] for byte in digest[:length])
    return mask_email(f"{local}@{domain}")


# --- limits -------------------------------------------------------------------------------------------


def enforce_daily_code_cap(*, record: bool = True) -> None:
    """The last-resort brake on the email bill: at most EMAIL_DAILY_CAP emails in any 24 hours, for everyone together."""
    cap = settings.EMAIL_DAILY_CAP
    retry_after = limiter.hit("otp:daily-cap", cap, DAY) if record else limiter.peek("otp:daily-cap", cap, DAY)
    if retry_after:
        logger.error("Daily code cap of %s reached: refusing code requests for a while", cap)
        raise _wait(429, "too_many_requests", "We can't send more codes right now. Please try again later.", retry_after)


def _start_keys(key: str) -> tuple[str, str]:
    return f"otp:start:{key}", f"otp:cooldown:{key}"


def check_start_limits(key: str) -> None:
    """Refuse (429) a new sign-up or reset request when `key` (the email, or the typed username) asked too often.

    At most OTP_MAX_REQUESTS_PER_HOUR requests an hour, and the resend cooldown between them. Nothing is recorded here:
    `record_start` does that once the request is going ahead. Requests for a name that does not exist are counted exactly
    like real ones, so these refusals reveal nothing.
    """
    hourly, cooldown = _start_keys(key)
    wait = limiter.peek(hourly, settings.OTP_MAX_REQUESTS_PER_HOUR, HOUR)
    if wait:
        raise too_many_requests_error(wait)
    wait = limiter.peek(cooldown, 1, settings.OTP_RESEND_COOLDOWN_SECONDS)
    if wait:
        raise resend_too_soon_error(wait)
    enforce_daily_code_cap(record=False)


def record_start(key: str) -> None:
    """Count one new request against `key` and against the daily cap. Raises 429 if a parallel one got in first."""
    hourly, cooldown = _start_keys(key)
    wait = limiter.hit(hourly, settings.OTP_MAX_REQUESTS_PER_HOUR, HOUR)
    if wait:
        raise too_many_requests_error(wait)
    wait = limiter.hit(cooldown, 1, settings.OTP_RESEND_COOLDOWN_SECONDS)
    if wait:
        raise resend_too_soon_error(wait)
    enforce_daily_code_cap()


def flow_end(expires_at: datetime) -> datetime:
    """When a sign-up or reset request is forgotten: OTP_FLOW_TTL_MINUTES after its newest code was sent."""
    return expires_at - timedelta(minutes=settings.OTP_TTL_MINUTES) + timedelta(minutes=settings.OTP_FLOW_TTL_MINUTES)


def is_locked(attempts: int, expires_at: datetime | None, now: datetime) -> bool:
    return attempts >= settings.OTP_MAX_ATTEMPTS and expires_at is not None and expires_at > now


# --- checking a code ----------------------------------------------------------------------------------


def check_code(db: Session, channel: Channel, user: User, code: str, now: datetime) -> None:
    """Return quietly if `code` is the right, unexpired code and the request is not locked. Otherwise raise.

    The guess is counted in one UPDATE ... RETURNING, so parallel guesses each get their own attempt number and a
    burst cannot get more than OTP_MAX_ATTEMPTS guesses in before the lock. The code is compared only after it has
    been counted.
    """
    # Everything needed is copied out first: a commit marks the row's attributes as stale.
    user_id, email = user.id, user.email
    stored_hash = getattr(user, channel.code_hash)
    expires_at = getattr(user, channel.expires_at)
    used = getattr(user, channel.attempts)
    hash_col, attempts_col, expires_col = (getattr(User, name) for name in (channel.code_hash, channel.attempts, channel.expires_at))

    if stored_hash is None or expires_at is None:
        raise request_expired_error()
    if is_locked(used, expires_at, now):
        raise locked_error((expires_at - now).total_seconds())
    if used >= settings.OTP_MAX_ATTEMPTS or expires_at <= now:  # the lock has run out, or the code has
        raise code_expired_error()

    attempts = db.execute(
        update(User)
        .where(User.id == user_id, attempts_col < settings.OTP_MAX_ATTEMPTS, expires_col > now, hash_col == stored_hash)
        .values({channel.attempts: attempts_col + 1})
        .returning(attempts_col)
        .execution_options(synchronize_session=False)
    ).scalar_one_or_none()
    db.commit()
    if attempts is None:  # out of guesses, locked a moment ago, just expired, replaced, or used up
        current = db.execute(select(attempts_col, expires_col, hash_col).where(User.id == user_id)).one_or_none()
        if current is None or current[2] is None:  # a parallel request used this sign-up up or removed it
            raise not_found_error()
        if is_locked(current[0], current[1], now):
            raise locked_error((current[1] - now).total_seconds())
        if current[2] != stored_hash:  # a fresh code replaced this one a moment ago
            raise invalid_code_error()
        raise code_expired_error()

    if email is not None and security.safe_equal(stored_hash, security.hash_otp(email, code)):
        return
    if attempts >= settings.OTP_MAX_ATTEMPTS:
        db.execute(
            update(User)
            .where(User.id == user_id, attempts_col >= settings.OTP_MAX_ATTEMPTS, hash_col == stored_hash)
            .values({channel.expires_at: now + timedelta(minutes=settings.OTP_LOCK_MINUTES)})
            .execution_options(synchronize_session=False)
        )
        db.commit()
        raise locked_error(settings.OTP_LOCK_MINUTES * 60)
    raise invalid_code_error()


def check_made_up_code(ref: str) -> None:
    """A guess at the code of a request for a username that does not exist. It can never be right.

    It behaves as a real request would: `invalid_code` for the first guesses, then the lock after the OTP_MAX_ATTEMPTS-th
    wrong one. The count is kept in memory under the request's id.
    """
    window = settings.OTP_LOCK_MINUTES * 60
    key = f"otp:made-up:{ref}"
    wait = limiter.hit(key, settings.OTP_MAX_ATTEMPTS, window)
    if wait:
        raise locked_error(wait)
    if limiter.count(key, window) >= settings.OTP_MAX_ATTEMPTS:
        raise locked_error(window)
    raise invalid_code_error()


# --- resending ----------------------------------------------------------------------------------------


def renew_code(db: Session, channel: Channel, user: User, now: datetime, ref: str) -> str:
    """The "Resend code" link: a fresh code for the same request. Returns it; the caller emails it.

    Refused while locked (so the lock cannot be skipped by asking again), inside the cooldown, and after
    OTP_MAX_SENDS_PER_REQUEST emails. The new code starts from zero wrong guesses.
    """
    user_id, email = user.id, user.email
    old_expires = getattr(user, channel.expires_at)
    used = getattr(user, channel.attempts)
    if is_locked(used, old_expires, now):
        raise locked_error((old_expires - now).total_seconds())
    elapsed = (now - (old_expires - timedelta(minutes=settings.OTP_TTL_MINUTES))).total_seconds()
    if elapsed < settings.OTP_RESEND_COOLDOWN_SECONDS:
        raise resend_too_soon_error(settings.OTP_RESEND_COOLDOWN_SECONDS - elapsed)
    # The first email was sent when the request was made: a request gets OTP_MAX_SENDS_PER_REQUEST - 1 more.
    wait = limiter.hit(f"otp:sends:{ref}", max(1, settings.OTP_MAX_SENDS_PER_REQUEST - 1), settings.OTP_FLOW_TTL_MINUTES * 60)
    if wait:
        raise too_many_requests_error(max(wait, 60))
    enforce_daily_code_cap()

    code = security.generate_otp()
    claimed = db.execute(
        update(User)
        .where(User.id == user_id, getattr(User, channel.expires_at) == old_expires)  # a parallel resend that won leaves 0 rows
        .values(
            {
                channel.code_hash: security.hash_otp(email, code),
                channel.attempts: 0,
                channel.expires_at: now + timedelta(minutes=settings.OTP_TTL_MINUTES),
            }
        )
        .execution_options(synchronize_session=False)
    )
    db.commit()
    if claimed.rowcount != 1:
        raise resend_too_soon_error(settings.OTP_RESEND_COOLDOWN_SECONDS)
    return code


def check_made_up_resend(ref: str) -> None:
    """"Resend" for a request that was made up: the same cooldown and the same cap on emails as a real one, no email."""
    wait = limiter.hit(f"otp:made-up-resend:{ref}", 1, settings.OTP_RESEND_COOLDOWN_SECONDS)
    if wait:
        raise resend_too_soon_error(wait)
    wait = limiter.hit(f"otp:sends:{ref}", max(1, settings.OTP_MAX_SENDS_PER_REQUEST - 1), settings.OTP_FLOW_TTL_MINUTES * 60)
    if wait:
        raise too_many_requests_error(max(wait, 60))
    enforce_daily_code_cap()
