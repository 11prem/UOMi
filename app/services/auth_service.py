"""Sign up, sign in, logout and the forgot-password flow.

Forgot password has three steps and two timeouts:
  /auth/forgot      text a code (valid OTP_TTL_MINUTES, resend after OTP_RESEND_COOLDOWN_SECONDS,
                    at most OTP_MAX_REQUESTS_PER_HOUR per phone number, at most SMS_DAILY_CAP a day in
                    total). Asking again does NOT cancel the codes already sent: an earlier code stays
                    valid until it expires, so a stranger repeating the request cannot cancel the
                    code you are typing.
  /auth/verify-otp  right code -> reset token, valid RESET_SESSION_TIMEOUT_MINUTES.
                    OTP_MAX_ATTEMPTS wrong guesses kill a code
  /auth/reset       reset token + new password -> password changed, token used up, all sessions ended,
                    and every other open code and reset session for that number is closed
"""

import logging
import math
from datetime import timedelta

from fastapi import BackgroundTasks
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import utcnow
from app.models.login_attempt import LoginAttempt
from app.models.password_reset import PasswordReset
from app.models.user import User
from app.schemas.user import (
    ForgotResponse,
    RegisterRequest,
    TokenPair,
    VerifyOTPResponse,
)
from app.services import session_service, sms_service
from app.utils import security
from app.utils.errors import api_error

logger = logging.getLogger(__name__)

FORGOT_MESSAGE = "If this number is registered, a code has been texted to it."


# ---------------------------------------------------------------------------
# Sign up
# ---------------------------------------------------------------------------


def register_user(db: Session, data: RegisterRequest) -> TokenPair:
    """Create Account: one transaction inserts the user and starts their first session."""
    if db.get(User, data.username) is not None:
        raise api_error(409, "username_taken", "That username is already taken.")
    if db.scalar(select(User.username).where(User.phone == data.phone)) is not None:
        raise api_error(409, "phone_taken", "That phone number is already registered.")

    db.add(
        User(
            username=data.username,
            name=data.name,
            phone=data.phone,
            password_hash=security.hash_password(data.password),
        )
    )
    try:
        db.flush()
        tokens = session_service.create_session(db, data.username)
        db.commit()
    except IntegrityError:  # someone else took the username or phone a moment ago
        db.rollback()
        raise api_error(
            409, "already_registered", "That username or phone number is already registered."
        ) from None
    return tokens


# ---------------------------------------------------------------------------
# Sign in
# ---------------------------------------------------------------------------


def login(db: Session, username: str, password: str) -> TokenPair:
    """Sign In: a wrong username and a wrong password give the same error; too many tries give 429.

    The attempt is written down and committed BEFORE the (slow) password check. Parallel guesses
    therefore each see every attempt committed before them: with a limit of 5, at most 5 guesses ever
    reach the password check, however many arrive at once. (Counting after the check lets a burst
    of requests all read "0 attempts so far" while the first one is still hashing.)

    An attempt that is refused is taken back out, so hammering a locked account does not keep the
    lockout going. Unknown usernames are counted exactly like real ones, so the reply never tells
    whether an account exists. The per-address limit is a dependency on the route (utils/rate_limit.py).
    """
    now = utcnow()
    window = timedelta(minutes=settings.LOGIN_LOCKOUT_MINUTES)

    db.execute(delete(LoginAttempt).where(LoginAttempt.attempted_at <= now - window))
    attempt = LoginAttempt(username=username)
    db.add(attempt)
    db.flush()
    attempt_id = attempt.id
    db.commit()

    attempts = db.execute(
        select(LoginAttempt.id, LoginAttempt.attempted_at)
        .where(LoginAttempt.username == username)
        .order_by(LoginAttempt.attempted_at, LoginAttempt.id)
    ).all()
    if len(attempts) > settings.LOGIN_MAX_ATTEMPTS:
        # The lockout lifts once enough of the earlier attempts fall out of the window.
        earlier = [attempted_at for id_, attempted_at in attempts if id_ != attempt_id]
        unlock_at = earlier[len(earlier) - settings.LOGIN_MAX_ATTEMPTS] + window
        retry_after = max(1, math.ceil((unlock_at - now).total_seconds()))
        db.execute(delete(LoginAttempt).where(LoginAttempt.id == attempt_id))
        db.commit()
        raise api_error(
            429,
            "too_many_attempts",
            f"Too many failed attempts. Try again in {math.ceil(retry_after / 60)} minute(s).",
            headers={"Retry-After": str(retry_after)},
            retry_after_seconds=retry_after,
        )

    user = db.get(User, username)
    # Always run one bcrypt check, so an unknown username takes as long as a wrong password.
    stored_hash = user.password_hash if user is not None else security.dummy_password_hash()
    password_ok = security.verify_password(password, stored_hash)
    if user is None or not password_ok:
        raise api_error(401, "invalid_credentials", "Incorrect username or password.")  # already counted

    db.execute(delete(LoginAttempt).where(LoginAttempt.username == username))
    tokens = session_service.create_session(db, username)
    db.commit()
    return tokens


def logout(db: Session, session_id: str) -> None:
    """Profile > Logout: end this device's session."""
    session_service.end_session(db, session_id)


# ---------------------------------------------------------------------------
# Forgot password
# ---------------------------------------------------------------------------


def _enforce_daily_code_cap(db: Session, now) -> None:
    """The last-resort brake on the SMS bill: at most SMS_DAILY_CAP codes a (UTC) day, for all numbers together.

    Every request writes a `password_resets` row, for unknown numbers too, so counting the rows counts
    requests, and the answer is the same whether or not the number is registered.
    """
    cap = settings.SMS_DAILY_CAP
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    created_today = db.scalar(select(func.count()).select_from(PasswordReset).where(PasswordReset.created_at >= day_start)) or 0
    if created_today >= cap:
        retry_after = max(1, math.ceil((day_start + timedelta(days=1) - now).total_seconds()))
        logger.error("Daily code cap of %s reached: refusing code requests until UTC midnight", cap)
        raise api_error(
            429,
            "too_many_requests",
            "We can't send more codes right now. Please try again later.",
            headers={"Retry-After": str(retry_after)},
            retry_after_seconds=retry_after,
        )
    if created_today + 1 == math.ceil(cap * 0.8):
        logger.warning("Daily code cap: %s of %s used", created_today + 1, cap)


def _send_code_text(phone: str, code: str) -> None:
    """Runs after the reply has gone out. A failure is logged, never raised: it cannot change the reply."""
    try:
        sms_service.send_sms(
            phone,
            f"Your UOMi code is {code}. It expires in {settings.OTP_TTL_MINUTES} minutes. "
            "Do not share it with anyone.",
        )
    except Exception:
        logger.exception("Could not send the password-reset text")


def request_password_reset(db: Session, phone: str, background_tasks: BackgroundTasks) -> ForgotResponse:
    """Forgot Password: text a code. The reply is identical for registered and unknown numbers.

    The limits (3 per hour, one per minute, the daily cap) are tracked in `password_resets`, for
    unknown numbers too, so the 429 answers cannot be used to find out who has an account.
    An earlier code is left valid: see the module docstring.
    """
    now = utcnow()
    recent = db.scalars(
        select(PasswordReset)
        .where(PasswordReset.phone == phone, PasswordReset.created_at > now - timedelta(hours=1))
        .order_by(PasswordReset.created_at.desc())
    ).all()  # newest first

    max_per_hour = settings.OTP_MAX_REQUESTS_PER_HOUR
    if len(recent) >= max_per_hour:
        retry_after = max(1, math.ceil((recent[max_per_hour - 1].created_at + timedelta(hours=1) - now).total_seconds()))
        raise api_error(
            429,
            "too_many_requests",
            "Too many codes requested. Try again later.",
            headers={"Retry-After": str(retry_after)},
            retry_after_seconds=retry_after,
        )
    if recent:
        elapsed = (now - recent[0].created_at).total_seconds()
        if elapsed < settings.OTP_RESEND_COOLDOWN_SECONDS:
            retry_after = max(1, math.ceil(settings.OTP_RESEND_COOLDOWN_SECONDS - elapsed))
            raise api_error(
                429,
                "resend_too_soon",
                f"Please wait {retry_after} seconds before asking for another code.",
                headers={"Retry-After": str(retry_after)},
                retry_after_seconds=retry_after,
            )
    _enforce_daily_code_cap(db, now)

    user = db.scalar(select(User).where(User.phone == phone))
    code = security.generate_otp()
    db.add(
        PasswordReset(
            phone=phone,
            username=user.username if user is not None else None,
            code_hash=security.hash_otp(phone, code),
            created_at=now,
            expires_at=now + timedelta(minutes=settings.OTP_TTL_MINUTES),
        )
    )
    db.commit()

    if user is not None:
        # Sent AFTER the reply, never inline: a real SMS provider takes hundreds of milliseconds, and an inline
        # send would make the reply slower for registered numbers, which tells an attacker who has an account.
        background_tasks.add_task(_send_code_text, phone, code)

    return ForgotResponse(
        message=FORGOT_MESSAGE,
        expires_in_seconds=settings.OTP_TTL_MINUTES * 60,
        resend_after_seconds=settings.OTP_RESEND_COOLDOWN_SECONDS,
    )


def verify_reset_otp(db: Session, phone: str, code: str) -> VerifyOTPResponse:
    """Enter the code: right code -> a one-time reset token that is valid for a short time.

    Several codes can be open at once (asking again does not cancel the earlier one), so the guess is
    checked against every open code of this number. Each code counts its own wrong guesses.
    """
    now = utcnow()
    wrong_or_expired = api_error(400, "invalid_code", "That code is wrong or has expired.")

    rows = db.scalars(
        select(PasswordReset)
        .where(
            PasswordReset.phone == phone,
            PasswordReset.used_at.is_(None),
            PasswordReset.verified_at.is_(None),
            PasswordReset.expires_at > now,
        )
        .order_by(PasswordReset.id.desc())
    ).all()
    if not rows:
        raise wrong_or_expired

    guess_hash = security.hash_otp(phone, code)  # the same for every open code, so computed once
    matched_id: int | None = None
    for row in rows:
        # Count this guess before looking at it, in one UPDATE, so parallel guesses cannot share an
        # attempt number. No row updated: this code is dead (used up, expired or out of guesses).
        counted = db.execute(
            update(PasswordReset)
            .where(
                PasswordReset.id == row.id,
                PasswordReset.attempts < settings.OTP_MAX_ATTEMPTS,
                PasswordReset.used_at.is_(None),
                PasswordReset.verified_at.is_(None),
                PasswordReset.expires_at > now,
            )
            .values(attempts=PasswordReset.attempts + 1)
            .execution_options(synchronize_session=False)
        )
        if counted.rowcount == 0:
            continue
        code_matches = security.safe_equal(row.code_hash, guess_hash)
        if code_matches and row.username is not None and matched_id is None:
            matched_id = row.id
    db.commit()
    if matched_id is None:
        raise wrong_or_expired

    reset_token = security.new_opaque_token()
    claimed = db.execute(
        update(PasswordReset)
        .where(
            PasswordReset.id == matched_id,
            PasswordReset.used_at.is_(None),
            PasswordReset.verified_at.is_(None),
        )
        .values(
            verified_at=now,
            reset_token_hash=security.hash_token(reset_token),
            reset_expires_at=now + timedelta(minutes=settings.RESET_SESSION_TIMEOUT_MINUTES),
        )
        .execution_options(synchronize_session=False)
    )
    db.commit()
    if claimed.rowcount != 1:  # a parallel request verified this same code first
        raise wrong_or_expired
    return VerifyOTPResponse(
        reset_token=reset_token,
        expires_in_seconds=settings.RESET_SESSION_TIMEOUT_MINUTES * 60,
    )


def reset_password(db: Session, reset_token: str, new_password: str) -> None:
    """Set new password: the reset token works once, within the reset session timeout.

    The token is used up with one conditional UPDATE (`... WHERE used_at IS NULL`), not a read
    followed by a write: of two parallel requests with the same token, exactly one updates a row.
    """
    now = utcnow()
    expired = api_error(400, "reset_session_expired", "This reset session has expired. Please start again.")

    row = db.scalar(
        select(PasswordReset).where(PasswordReset.reset_token_hash == security.hash_token(reset_token))
    )
    if (
        row is None
        or row.used_at is not None
        or row.reset_expires_at is None
        or row.reset_expires_at <= now
        or row.username is None
    ):
        raise expired
    user = db.get(User, row.username)
    if user is None:
        raise expired

    claimed = db.execute(
        update(PasswordReset)
        .where(
            PasswordReset.id == row.id,
            PasswordReset.used_at.is_(None),
            PasswordReset.reset_expires_at > now,
        )
        .values(used_at=now)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:  # a parallel request used this token first
        db.rollback()
        raise expired

    user.password_hash = security.hash_password(new_password)
    # The password is changed, so no other code or reset session for this number may change it again.
    still_open = (PasswordReset.phone == row.phone, PasswordReset.used_at.is_(None))
    db.execute(
        update(PasswordReset)
        .where(*still_open, PasswordReset.expires_at > now)
        .values(expires_at=now)
        .execution_options(synchronize_session=False)
    )
    db.execute(
        update(PasswordReset)
        .where(*still_open, PasswordReset.reset_expires_at > now)
        .values(reset_expires_at=now)
        .execution_options(synchronize_session=False)
    )
    session_service.end_all_sessions(db, user.username, commit=False)  # sign out everywhere
    db.execute(delete(LoginAttempt).where(LoginAttempt.username == user.username))  # lift any lockout
    db.commit()
