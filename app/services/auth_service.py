"""Sign up, sign in, logout and the forgot-password flow.

Forgot password has three steps and two timeouts:
  /auth/forgot      text a code (valid OTP_TTL_MINUTES, resend after OTP_RESEND_COOLDOWN_SECONDS,
                    at most OTP_MAX_REQUESTS_PER_HOUR per phone number)
  /auth/verify-otp  right code -> reset token, valid RESET_SESSION_TIMEOUT_MINUTES.
                    OTP_MAX_ATTEMPTS wrong guesses kill the code
  /auth/reset       reset token + new password -> password changed, token used up, all sessions ended
"""

import logging
import math
from datetime import timedelta

from sqlalchemy import delete, select
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
    """Sign In: a wrong username and a wrong password give the same error; too many tries give 429."""
    now = utcnow()
    window = timedelta(minutes=settings.LOGIN_LOCKOUT_MINUTES)

    db.execute(delete(LoginAttempt).where(LoginAttempt.attempted_at <= now - window))
    attempts = db.scalars(
        select(LoginAttempt.attempted_at)
        .where(LoginAttempt.username == username)
        .order_by(LoginAttempt.attempted_at)
    ).all()
    if len(attempts) >= settings.LOGIN_MAX_ATTEMPTS:
        # The lockout lifts once enough old attempts fall out of the window.
        unlock_at = attempts[len(attempts) - settings.LOGIN_MAX_ATTEMPTS] + window
        retry_after = max(1, math.ceil((unlock_at - now).total_seconds()))
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
        db.add(LoginAttempt(username=username))
        db.commit()
        raise api_error(401, "invalid_credentials", "Incorrect username or password.")

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


def request_password_reset(db: Session, phone: str) -> ForgotResponse:
    """Forgot Password: text a code. The reply is identical for registered and unknown numbers.

    The limits (3 per hour, one per minute) are tracked per phone number in `password_resets`,
    for unknown numbers too, so the 429 answers cannot be used to find out who has an account.
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

    # A new code replaces any earlier one: end the old codes and any reset session still open.
    for row in recent:
        if row.used_at is None:
            if row.expires_at > now:
                row.expires_at = now
            if row.reset_expires_at is not None and row.reset_expires_at > now:
                row.reset_expires_at = now

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
        try:
            sms_service.send_sms(
                phone,
                f"Your UOMi code is {code}. It expires in {settings.OTP_TTL_MINUTES} minutes. "
                "Do not share it with anyone.",
            )
        except Exception:  # the reply must not depend on whether the text went out
            logger.exception("Could not send the password-reset text")

    return ForgotResponse(
        message=FORGOT_MESSAGE,
        expires_in_seconds=settings.OTP_TTL_MINUTES * 60,
        resend_after_seconds=settings.OTP_RESEND_COOLDOWN_SECONDS,
    )


def verify_reset_otp(db: Session, phone: str, code: str) -> VerifyOTPResponse:
    """Enter the code: right code -> a one-time reset token that is valid for a short time."""
    now = utcnow()
    wrong_or_expired = api_error(400, "invalid_code", "That code is wrong or has expired.")

    row = db.scalar(
        select(PasswordReset)
        .where(
            PasswordReset.phone == phone,
            PasswordReset.used_at.is_(None),
            PasswordReset.verified_at.is_(None),
        )
        .order_by(PasswordReset.id.desc())
        .limit(1)
    )
    if row is None or row.expires_at <= now or row.attempts >= settings.OTP_MAX_ATTEMPTS:
        raise wrong_or_expired

    code_matches = security.safe_equal(row.code_hash, security.hash_otp(phone, code))
    if not code_matches or row.username is None:
        row.attempts += 1
        if row.attempts >= settings.OTP_MAX_ATTEMPTS:
            row.expires_at = now  # too many wrong guesses: the code is dead
        db.commit()
        raise wrong_or_expired

    reset_token = security.new_opaque_token()
    row.verified_at = now
    row.reset_token_hash = security.hash_token(reset_token)
    row.reset_expires_at = now + timedelta(minutes=settings.RESET_SESSION_TIMEOUT_MINUTES)
    db.commit()
    return VerifyOTPResponse(
        reset_token=reset_token,
        expires_in_seconds=settings.RESET_SESSION_TIMEOUT_MINUTES * 60,
    )


def reset_password(db: Session, reset_token: str, new_password: str) -> None:
    """Set new password: the reset token works once, within the reset session timeout."""
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

    user.password_hash = security.hash_password(new_password)
    row.used_at = now
    session_service.end_all_sessions(db, user.username, commit=False)  # sign out everywhere
    db.execute(delete(LoginAttempt).where(LoginAttempt.username == user.username))  # lift any lockout
    db.commit()
