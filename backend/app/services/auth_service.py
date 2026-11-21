"""Sign up, sign in, logout and the forgot-password flow.

Sign up has two steps, and the person can sign in only after the second (specs § 4.3):
  POST /auth/register          checks the form, emails a code, and saves the sign-up as a `users` row with
                               `status = 'pending'`. A pending person cannot sign in and cannot be found or added.
  POST /auth/otp/resend        a fresh code for the same sign-up (30 s cooldown).
  POST /auth/register/verify   right code -> the row becomes `active` and the person is signed in.
A sign-up that is never verified is forgotten OTP_FLOW_TTL_MINUTES after its newest code was sent: the next sign-up
that needs its username, email or phone removes it, and the daily clean-up job deletes it. Until then the row holds
those three values, so another person cannot take them (the same person trying again with the same email replaces it).

Forgot password has three steps and two timeouts (specs § 4.5). The reset lives in the `reset_*` columns of the person's
row, so a person has one open reset: asking again replaces its code (but not a reset session that is already open):
  POST /auth/forgot       a username -> a code is emailed to ITS address, and the masked email comes back. The reply is
                          the same for a username that does not exist.
  POST /auth/verify-otp   reset id + right code -> reset token, valid RESET_SESSION_TIMEOUT_MINUTES.
  POST /auth/reset        reset token + new password -> password changed, token used up, the session ended.

The rules for the codes themselves (lifetime, wrong guesses, the lock, resend) are in otp_service.py.
"""

import logging
import math
from datetime import timedelta

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import utcnow
from app.models.user import STATUS_ACTIVE, STATUS_PENDING, User
from app.schemas.user import (
    ForgotResponse,
    RegisterRequest,
    ResendOut,
    SignupStarted,
    TokenPair,
    VerifyOTPResponse,
)
from app.services import otp_service, session_service
from app.utils import security
from app.utils.errors import api_error, forbidden
from app.utils.rate_limit import limiter
from app.utils.validators import mask_email

logger = logging.getLogger(__name__)

FORGOT_MESSAGE = "If that username exists, a code has been emailed to its address."


def _code_lifetime() -> int:
    return settings.OTP_TTL_MINUTES * 60


def _signup_over(user: User, now) -> bool:
    """True when a pending sign-up has been forgotten: nobody asked for a code for OTP_FLOW_TTL_MINUTES."""
    return user.signup_expires_at is None or otp_service.flow_end(user.signup_expires_at) <= now


# ---------------------------------------------------------------------------
# Sign up
# ---------------------------------------------------------------------------


def active_user(db: Session, username: str) -> User | None:
    """The person with this username who can sign in. A pending sign-up does not count."""
    return db.scalar(select(User).where(User.username == username, User.status == STATUS_ACTIVE))


def _conflict(db: Session, username: str, email: str, phone: str | None, now, *, replace_email: str | None = None):
    """Raise the 409 for whatever is taken. A live pending sign-up with `replace_email` is removed (the same person trying again)."""
    conditions = [User.username == username, User.email == email]
    if phone is not None:
        conditions.append(User.phone == phone)
    rows = list(db.scalars(select(User).where(or_(*conditions))).all())
    kept = []
    for row in rows:
        if row.status == STATUS_PENDING and (_signup_over(row, now) or (replace_email is not None and row.email == replace_email)):
            db.delete(row)
        else:
            kept.append(row)
    db.flush()
    rows = kept
    if any(row.username == username for row in rows):
        raise api_error(409, "username_taken", "Username already taken")
    if any(row.email == email for row in rows):
        raise api_error(409, "email_taken", "Email already registered")
    if phone is not None and any(row.phone == phone for row in rows):
        raise api_error(409, "phone_taken", "Phone number already registered")


def username_available(db: Session, username: str) -> bool:
    """The live "✓ available / ✗ taken" check on Create Account. A sign-up still waiting for its code holds its username."""
    now = utcnow()
    row = db.scalar(select(User).where(User.username == username))
    return row is None or (row.status == STATUS_PENDING and _signup_over(row, now))


def email_available(db: Session, email: str) -> bool:
    """True when no account uses this address. Tells anyone whether an email is registered: it is limited per address."""
    now = utcnow()
    row = db.scalar(select(User).where(User.email == email))
    return row is None or (row.status == STATUS_PENDING and _signup_over(row, now))


def start_signup(db: Session, data: RegisterRequest, background_tasks: BackgroundTasks) -> SignupStarted:
    """Create Account: check the form, email a code, save the sign-up as a pending person.

    The limits are by email address: OTP_MAX_REQUESTS_PER_HOUR sign-ups an hour and the resend cooldown between them
    (otp_service.check_start_limits), then the daily cap.
    """
    now = utcnow()
    _conflict(db, data.username, data.email, data.phone, now, replace_email=data.email)
    otp_service.check_start_limits(f"signup:{data.email}")  # a cheap refusal, before the (slow) password hash
    otp_service.record_start(f"signup:{data.email}")

    code = security.generate_otp()
    password_hash = security.hash_password(data.password)  # slow: after the cheap refusals above
    pending_id = otp_service.new_pending_id()
    db.add(
        User(
            username=data.username,
            name=data.name,
            email=data.email,
            phone=data.phone,
            password_hash=password_hash,
            status=STATUS_PENDING,
            signup_pending_id=pending_id,
            signup_code_hash=security.hash_otp(data.email, code),
            signup_attempts=0,
            signup_expires_at=now + timedelta(minutes=settings.OTP_TTL_MINUTES),
        )
    )
    try:
        db.commit()
    except IntegrityError:  # someone else took the username, email or phone a moment ago
        db.rollback()
        raise api_error(409, "already_registered", "That username, email or phone is already registered.") from None
    # After the reply has gone out: a real mail server takes hundreds of milliseconds.
    background_tasks.add_task(otp_service.send_code_email, data.email, code)
    return SignupStarted(
        pending_id=pending_id,
        masked_email=mask_email(data.email),
        expires_in_seconds=_code_lifetime(),
        resend_after_seconds=settings.OTP_RESEND_COOLDOWN_SECONDS,
    )


def _pending_user(db: Session, pending_id: str) -> User | None:
    return db.scalar(select(User).where(User.signup_pending_id == pending_id, User.status == STATUS_PENDING))


def verify_signup(db: Session, pending_id: str, code: str) -> TokenPair:
    """Verify email: the right code activates the person and signs them in, in one transaction."""
    now = utcnow()
    user = _pending_user(db, pending_id)
    if user is None:
        raise otp_service.not_found_error()
    if _signup_over(user, now):
        db.delete(user)
        db.commit()
        raise otp_service.request_expired_error()
    user_id = user.id
    otp_service.check_code(db, otp_service.SIGNUP, user, code, now)
    # Activated with one conditional UPDATE, BEFORE anything else: of two parallel requests with the same right code,
    # exactly one updates the row, and the other is told the sign-up is gone.
    claimed = db.execute(
        update(User)
        .where(User.id == user_id, User.status == STATUS_PENDING, User.signup_pending_id == pending_id)
        .values(
            status=STATUS_ACTIVE,
            signup_pending_id=None,
            signup_code_hash=None,
            signup_attempts=0,
            signup_expires_at=None,
        )
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        db.rollback()
        raise otp_service.not_found_error()
    db.expire_all()
    tokens = session_service.create_session(db, db.get(User, user_id))
    db.commit()
    return tokens


def resend_code(db: Session, ref: str, background_tasks: BackgroundTasks) -> ResendOut:
    """"Resend code" for a sign-up (`pending_id`) or a forgot-password request (`reset_id`)."""
    now = utcnow()
    out = ResendOut(expires_in_seconds=_code_lifetime(), resend_after_seconds=settings.OTP_RESEND_COOLDOWN_SECONDS)

    if ref.startswith(otp_service.SIGNUP_PREFIX):
        user = _pending_user(db, ref)
        if user is None:
            raise otp_service.not_found_error()
        if _signup_over(user, now):
            raise otp_service.request_expired_error()
        code = otp_service.renew_code(db, otp_service.SIGNUP, user, now, ref)
        background_tasks.add_task(otp_service.send_code_email, user.email, code)
        return out

    user_id = otp_service.read_reset_id(ref)
    if user_id is None:
        raise otp_service.not_found_error()
    if user_id == 0:  # a request for a username that does not exist: nothing is emailed, the limits are the same
        otp_service.check_made_up_resend(ref)
        return out
    user = db.get(User, user_id)
    if user is None or user.status != STATUS_ACTIVE or user.email is None:
        otp_service.check_made_up_resend(ref)
        return out
    if user.reset_code_hash is None or user.reset_code_expires_at is None or user.reset_verified_at is not None:
        raise otp_service.request_expired_error()
    if otp_service.flow_end(user.reset_code_expires_at) <= now:
        raise otp_service.request_expired_error()
    code = otp_service.renew_code(db, otp_service.RESET, user, now, ref)
    background_tasks.add_task(otp_service.send_code_email, user.email, code)
    return out


# ---------------------------------------------------------------------------
# Sign in
# ---------------------------------------------------------------------------


def _too_many_attempts(retry_after: int) -> HTTPException:
    return api_error(
        429,
        "too_many_attempts",
        f"Too many failed attempts. Try again in {math.ceil(retry_after / 60)} minute(s).",
        headers={"Retry-After": str(retry_after)},
        retry_after_seconds=retry_after,
    )


def _count_attempt(db: Session, user: User | None, username: str) -> None:
    """Write down one password attempt and refuse (429) when there are LOGIN_MAX_ATTEMPTS of them in the window.

    The window starts at the first attempt and lasts LOGIN_LOCKOUT_MINUTES, then the count starts again. For a real
    person the count is kept on their `users` row (`failed_login_count`, `first_failed_login_at`, `locked_until`); for a
    username that does not exist (or whose sign-up is not verified) the same count is kept in memory, so the reply
    never tells whether an account exists. An attempt that is refused is not counted, so hammering a locked account does
    not keep the lockout going.
    """
    now = utcnow()
    window = timedelta(minutes=settings.LOGIN_LOCKOUT_MINUTES)

    if user is None:
        retry_after = limiter.hit(f"login:user:{username}", settings.LOGIN_MAX_ATTEMPTS, window.total_seconds())
        if retry_after:
            raise _too_many_attempts(retry_after)
        return

    user_id = user.id
    # Start a new window when the old one has run out.
    db.execute(
        update(User)
        .where(User.id == user_id, User.first_failed_login_at.is_not(None), User.first_failed_login_at <= now - window)
        .values(failed_login_count=0, first_failed_login_at=None, locked_until=None)
        .execution_options(synchronize_session=False)
    )
    # Counted and committed BEFORE the (slow) password check, in one conditional UPDATE: of a burst of parallel guesses,
    # at most LOGIN_MAX_ATTEMPTS ever reach the password check.
    counted = db.execute(
        update(User)
        .where(User.id == user_id, User.failed_login_count < settings.LOGIN_MAX_ATTEMPTS)
        .values(
            failed_login_count=User.failed_login_count + 1,
            first_failed_login_at=func.coalesce(User.first_failed_login_at, now),
        )
        .execution_options(synchronize_session=False)
    )
    db.commit()
    if counted.rowcount == 1:
        return
    first = db.scalar(select(User.first_failed_login_at).where(User.id == user_id))
    unlock_at = (first or now) + window
    retry_after = max(1, math.ceil((unlock_at - now).total_seconds()))
    db.execute(
        update(User).where(User.id == user_id).values(locked_until=unlock_at).execution_options(synchronize_session=False)
    )
    db.commit()
    raise _too_many_attempts(retry_after)


def _clear_lockout(db: Session, user_id: int) -> None:
    db.execute(
        update(User)
        .where(User.id == user_id)
        .values(failed_login_count=0, first_failed_login_at=None, locked_until=None)
        .execution_options(synchronize_session=False)
    )


def login(db: Session, username: str, password: str) -> TokenPair:
    """Sign In: a wrong username and a wrong password give the same error; too many tries give 429.

    The attempt is written down and committed BEFORE the (slow) password check. Parallel guesses
    therefore each see every attempt committed before them: with a limit of 5, at most 5 guesses ever
    reach the password check, however many arrive at once. (Counting after the check lets a burst
    of requests all read "0 attempts so far" while the first one is still hashing.)

    Unknown usernames are counted exactly like real ones, so the reply never tells
    whether an account exists. The per-address limit is a dependency on the route (utils/rate_limit.py).
    """
    user = active_user(db, username)
    _count_attempt(db, user, username)

    # Always run one bcrypt check, so an unknown username takes as long as a wrong password.
    stored_hash = user.password_hash if user is not None else security.dummy_password_hash()
    password_ok = security.verify_password(password, stored_hash)
    if user is None or not password_ok:
        raise api_error(401, "invalid_credentials", "Incorrect username or password.")  # already counted

    user_id = user.id
    _clear_lockout(db, user_id)
    tokens = session_service.create_session(db, db.get(User, user_id))
    db.commit()
    return tokens


def confirm_password(db: Session, user: User, password: str) -> None:
    """Ask a signed-in person for their password again, before something that cannot be undone.

    A wrong one counts like a failed sign-in and locks the same way (same columns, same limit): a stolen session must not
    be a way to guess the password without limit. A right one clears the count, as signing in does.
    """
    user_id, password_hash = user.id, user.password_hash
    _count_attempt(db, user, user.username)
    if not security.verify_password(password, password_hash):
        raise forbidden("wrong_password", "Incorrect password.")
    _clear_lockout(db, user_id)


def logout(db: Session, session_id: str) -> None:
    """Profile > Logout: end this device's session."""
    session_service.end_session(db, session_id)


# ---------------------------------------------------------------------------
# Forgot password
# ---------------------------------------------------------------------------


def request_password_reset(db: Session, username: str, background_tasks: BackgroundTasks) -> ForgotResponse:
    """Forgot Password, step a: email a code to the username's address and say which one (masked).

    The reply is identical, in content and in how limits apply, for a username that does not exist: the request is
    counted either way, nothing is emailed for a made-up one, and the masked email shown for it is a stable made-up
    address (otp_service.fake_masked_email). The limits are by the typed username.
    """
    now = utcnow()
    otp_service.check_start_limits(f"reset:{username}")  # a cheap refusal first
    otp_service.record_start(f"reset:{username}")

    user = active_user(db, username)
    if user is not None and user.email is None:
        user = None  # nowhere to send a code: it looks like any other username that has no account

    if user is None:
        reset_id = otp_service.make_reset_id(0)
        masked = otp_service.fake_masked_email(db, username)
    else:
        code = security.generate_otp()
        email = user.email
        # Only the code is replaced: a reset session that is already open (its token) is left alone, so a stranger asking
        # again cannot end the one you are typing the new password into.
        db.execute(
            update(User)
            .where(User.id == user.id)
            .values(
                reset_code_hash=security.hash_otp(email, code),
                reset_attempts=0,
                reset_code_expires_at=now + timedelta(minutes=settings.OTP_TTL_MINUTES),
                reset_verified_at=None,
                reset_used_at=None,
            )
            .execution_options(synchronize_session=False)
        )
        db.commit()
        reset_id = otp_service.make_reset_id(user.id)
        masked = mask_email(email)
        # Sent AFTER the reply, never inline: an inline send would make the reply slower for real usernames, which
        # tells an attacker who has an account.
        background_tasks.add_task(otp_service.send_code_email, email, code)

    return ForgotResponse(
        reset_id=reset_id,
        masked_email=masked,
        message=FORGOT_MESSAGE,
        expires_in_seconds=_code_lifetime(),
        resend_after_seconds=settings.OTP_RESEND_COOLDOWN_SECONDS,
    )


def verify_reset_otp(db: Session, reset_id: str, code: str) -> VerifyOTPResponse:
    """Forgot Password, step b: right code -> a one-time reset token that is valid for a short time.

    Only this person's own code is checked, and it counts its own wrong guesses (otp_service.check_code).
    """
    now = utcnow()
    user_id = otp_service.read_reset_id(reset_id)
    if user_id is None:
        raise otp_service.not_found_error()
    if user_id == 0:
        otp_service.check_made_up_code(reset_id)  # never right
    user = db.get(User, user_id)
    if user is None or user.status != STATUS_ACTIVE:
        otp_service.check_made_up_code(reset_id)
    if (
        user.reset_code_hash is None
        or user.reset_code_expires_at is None
        or user.reset_verified_at is not None
        or otp_service.flow_end(user.reset_code_expires_at) <= now
    ):
        raise otp_service.request_expired_error()
    otp_service.check_code(db, otp_service.RESET, user, code, now)

    reset_token = security.new_opaque_token()
    claimed = db.execute(
        update(User)
        .where(User.id == user_id, User.reset_verified_at.is_(None), User.reset_code_hash.is_not(None))
        .values(
            reset_verified_at=now,
            reset_code_hash=None,
            reset_attempts=0,
            reset_token_hash=security.hash_token(reset_token),
            reset_token_expires_at=now + timedelta(minutes=settings.RESET_SESSION_TIMEOUT_MINUTES),
            reset_used_at=None,
        )
        .execution_options(synchronize_session=False)
    )
    db.commit()
    if claimed.rowcount != 1:  # a parallel request verified this same code first
        raise otp_service.request_expired_error()
    return VerifyOTPResponse(
        reset_token=reset_token,
        expires_in_seconds=settings.RESET_SESSION_TIMEOUT_MINUTES * 60,
    )


def reset_password(db: Session, reset_token: str, new_password: str) -> str:
    """Forgot Password, step c: the reset token works once, within the reset session timeout. Returns the username.

    The token is used up with one conditional UPDATE (`... WHERE reset_used_at IS NULL`), not a read
    followed by a write: of two parallel requests with the same token, exactly one updates a row.
    """
    now = utcnow()
    expired = api_error(400, "reset_session_expired", "This reset session has expired. Please start again.")

    token_hash = security.hash_token(reset_token)
    user = db.scalar(select(User).where(User.reset_token_hash == token_hash, User.status == STATUS_ACTIVE))
    if (
        user is None
        or user.reset_used_at is not None
        or user.reset_token_expires_at is None
        or user.reset_token_expires_at <= now
    ):
        raise expired
    user_id, username = user.id, user.username
    new_hash = security.hash_password(new_password)  # slow: before the token is used up

    claimed = db.execute(
        update(User)
        .where(
            User.id == user_id,
            User.reset_token_hash == token_hash,
            User.reset_used_at.is_(None),
            User.reset_token_expires_at > now,
        )
        .values(
            password_hash=new_hash,
            reset_used_at=now,
            reset_token_hash=None,
            reset_token_expires_at=None,
            # The password is changed, so no other code may change it again.
            reset_code_hash=None,
            reset_attempts=0,
            reset_code_expires_at=None,
        )
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:  # a parallel request used this token first
        db.rollback()
        raise expired
    session_service.end_all_sessions(db, user_id, commit=False)  # sign out everywhere
    _clear_lockout(db, user_id)  # lift any lockout
    db.commit()
    return username
