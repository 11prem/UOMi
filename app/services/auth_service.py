"""Sign up, sign in, logout and the forgot-password flow.

Sign up has two steps, and the account exists only after the second (specs § 4.3):
  POST /auth/register          checks the form, texts a code, keeps a `PendingSignup`. No account yet.
  POST /auth/otp/resend        a fresh code for the same sign-up (30 s cooldown).
  POST /auth/register/verify   right code -> the account is created and signed in.
A sign-up that is never verified just expires: the username and phone number stay free.

Forgot password has three steps and two timeouts (specs § 4.5):
  POST /auth/forgot       a username -> a code is texted to ITS phone, and the masked number comes back. The reply is
                          the same for a username that does not exist.
  POST /auth/verify-otp   reset id + right code -> reset token, valid RESET_SESSION_TIMEOUT_MINUTES.
  POST /auth/reset        reset token + new password -> password changed, token used up, all sessions ended, and every
                          other open request for that user is closed.
Asking again for the same username starts a SEPARATE request and does not cancel the earlier ones, so a stranger
repeating the request cannot cancel the code you are typing. Only the holder of a request's id can resend its code.

The rules for the codes themselves (lifetime, wrong guesses, the lock, resend) are in otp_service.py.
"""

import logging
import math
from datetime import timedelta

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import utcnow
from app.models.login_attempt import LoginAttempt
from app.models.password_reset import PasswordReset
from app.models.pending_signup import PendingSignup
from app.models.user import User
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
from app.utils.validators import mask_phone

logger = logging.getLogger(__name__)

FORGOT_MESSAGE = "If that username exists, a code has been texted to its phone."


def _code_lifetime() -> int:
    return settings.OTP_TTL_MINUTES * 60


# ---------------------------------------------------------------------------
# Sign up
# ---------------------------------------------------------------------------


def _check_free(db: Session, username: str, phone: str) -> None:
    if db.get(User, username) is not None:
        raise api_error(409, "username_taken", "Username already taken")
    if db.scalar(select(User.username).where(User.phone == phone)) is not None:
        raise api_error(409, "phone_taken", "Phone number already registered")


def active_user(db: Session, username: str) -> User | None:
    """The account with this username, unless it was deleted: a deleted account is treated as one that does not exist."""
    user = db.get(User, username)
    return None if user is None or user.deleted_at is not None else user


def username_available(db: Session, username: str) -> bool:
    """The live "✓ available / ✗ taken" check on Create Account. A deleted account's username stays taken for good."""
    return db.get(User, username) is None


def phone_available(db: Session, phone: str) -> bool:
    """True when no account uses this number. Tells anyone whether a number is registered: it is limited per address."""
    return db.scalar(select(User.username).where(User.phone == phone)) is None


def start_signup(db: Session, data: RegisterRequest, background_tasks: BackgroundTasks) -> SignupStarted:
    """Create Account: check the form, text a code, remember the sign-up. The account is NOT created yet.

    The limits are by phone number: OTP_MAX_REQUESTS_PER_HOUR sign-ups an hour and the resend cooldown between them
    (otp_service.enforce_start_limits), then the daily cap. An unverified sign-up reserves nothing, so someone
    else can still register the same username or number: whoever verifies first gets it.
    """
    now = utcnow()
    _check_free(db, data.username, data.phone)
    otp_service.check_limits(db, PendingSignup, PendingSignup.phone, data.phone, now)  # a cheap refusal, before the hash

    # Finished and abandoned sign-ups are forgotten a day after they end, never sooner: the daily cap counts these rows.
    db.execute(delete(PendingSignup).where(PendingSignup.valid_until <= now - timedelta(days=1)))

    code = security.generate_otp()
    pending = PendingSignup(
        public_id=otp_service.new_public_id(otp_service.SIGNUP_PREFIX),
        username=data.username,
        name=data.name,
        phone=data.phone,
        password_hash=security.hash_password(data.password),
        code_hash=security.hash_otp(data.phone, code),
        created_at=now,
        last_sent_at=now,
        expires_at=now + timedelta(minutes=settings.OTP_TTL_MINUTES),
        valid_until=now + timedelta(minutes=settings.OTP_FLOW_TTL_MINUTES),
    )
    db.add(pending)
    db.flush()
    row_id, public_id = pending.id, pending.public_id
    db.commit()
    # Recorded and committed BEFORE the limits are counted again: ten parallel requests would otherwise all read "0 so
    # far" and all pass. A request that is over a limit takes its own row back out (otp_service.check_limits).
    otp_service.check_limits(db, PendingSignup, PendingSignup.phone, data.phone, now, mine_id=row_id)
    # After the reply has gone out: a real SMS provider takes hundreds of milliseconds.
    background_tasks.add_task(otp_service.send_code_text, data.phone, code)
    return SignupStarted(
        pending_id=public_id,
        masked_phone=mask_phone(data.phone),
        expires_in_seconds=_code_lifetime(),
        resend_after_seconds=settings.OTP_RESEND_COOLDOWN_SECONDS,
    )


def verify_signup(db: Session, pending_id: str, code: str) -> TokenPair:
    """Verify phone: the right code creates the account and signs the user in, in one transaction."""
    now = utcnow()
    pending = db.scalar(select(PendingSignup).where(PendingSignup.public_id == pending_id))
    if pending is None or pending.used_at is not None:
        raise otp_service.not_found_error()
    if pending.valid_until <= now:
        raise otp_service.request_expired_error()
    # Copied out before checking the code, which commits: a parallel request may delete this row in between.
    pending_row_id, username, name, phone, password_hash = (
        pending.id, pending.username, pending.name, pending.phone, pending.password_hash,
    )
    otp_service.check_code(db, PendingSignup, pending, code, now)
    # Used up with one conditional UPDATE, BEFORE anything else: of two parallel requests with the same right code,
    # exactly one updates the row, and the other is told the sign-up is gone. The row is kept (the daily text cap
    # counts it) but its password hash is wiped, and it ends now.
    claimed = db.execute(
        update(PendingSignup)
        .where(PendingSignup.id == pending_row_id, PendingSignup.used_at.is_(None))
        .values(used_at=now, password_hash="", valid_until=now)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        db.rollback()
        raise otp_service.not_found_error()
    try:
        _check_free(db, username, phone)  # someone ELSE may have verified the same username or number first
    except HTTPException:
        db.rollback()  # the claim is undone: this sign-up stays open (it can never succeed, but it is not "used")
        raise
    db.add(User(username=username, name=name, phone=phone, password_hash=password_hash))
    try:
        db.flush()
        tokens = session_service.create_session(db, username)
        db.commit()
    except IntegrityError:  # someone else took the username or phone a moment ago
        db.rollback()
        raise api_error(409, "already_registered", "That username or phone number is already registered.") from None
    return tokens


def resend_code(db: Session, ref: str, background_tasks: BackgroundTasks) -> ResendOut:
    """"Resend code" for a sign-up (`pending_id`) or a forgot-password request (`reset_id`)."""
    now = utcnow()
    if ref.startswith(otp_service.SIGNUP_PREFIX):
        model = PendingSignup
    elif ref.startswith(otp_service.RESET_PREFIX):
        model = PasswordReset
    else:
        raise otp_service.not_found_error()
    row = db.scalar(select(model).where(model.public_id == ref))
    if row is None:
        raise otp_service.not_found_error()
    over = row.valid_until is None or row.valid_until <= now
    if over or (model is PasswordReset and (row.verified_at is not None or row.used_at is not None)):
        raise otp_service.request_expired_error()

    code = otp_service.renew_code(db, model, row, now)
    if model is PendingSignup or row.username is not None:  # nothing is texted for a username that does not exist
        background_tasks.add_task(otp_service.send_code_text, row.phone, code)
    return ResendOut(expires_in_seconds=_code_lifetime(), resend_after_seconds=settings.OTP_RESEND_COOLDOWN_SECONDS)


# ---------------------------------------------------------------------------
# Sign in
# ---------------------------------------------------------------------------


def _count_attempt(db: Session, username: str) -> None:
    """Write down one password attempt for this username and refuse (429) when there are too many in the window."""
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
    _count_attempt(db, username)

    user = active_user(db, username)
    # Always run one bcrypt check, so an unknown username takes as long as a wrong password.
    stored_hash = user.password_hash if user is not None else security.dummy_password_hash()
    password_ok = security.verify_password(password, stored_hash)
    if user is None or not password_ok:
        raise api_error(401, "invalid_credentials", "Incorrect username or password.")  # already counted

    db.execute(delete(LoginAttempt).where(LoginAttempt.username == username))
    tokens = session_service.create_session(db, username)
    db.commit()
    return tokens


def confirm_password(db: Session, user: User, password: str) -> None:
    """Ask a signed-in person for their password again, before something that cannot be undone.

    A wrong one counts like a failed sign-in and locks the same way (same table, same limit): a stolen session must not
    be a way to guess the password without limit. A right one clears the count, as signing in does.
    """
    _count_attempt(db, user.username)
    if not security.verify_password(password, user.password_hash):
        raise forbidden("wrong_password", "Incorrect password.")
    db.execute(delete(LoginAttempt).where(LoginAttempt.username == user.username))


def logout(db: Session, session_id: str) -> None:
    """Profile > Logout: end this device's session."""
    session_service.end_session(db, session_id)


# ---------------------------------------------------------------------------
# Forgot password
# ---------------------------------------------------------------------------


def request_password_reset(db: Session, username: str, background_tasks: BackgroundTasks) -> ForgotResponse:
    """Forgot Password, step a: text a code to the username's phone and say which number (masked).

    The reply is identical, in content and in how limits apply, for a username that does not exist: a request row is
    written and counted either way, nothing is texted for a made-up one, and the masked number shown for it is a
    stable made-up number (otp_service.fake_masked_phone). The limits are by the typed username.
    """
    now = utcnow()
    otp_service.check_limits(db, PasswordReset, PasswordReset.requested_username, username, now)  # a cheap refusal first
    # Requests, real or made-up, are forgotten a day after they were made, never sooner: the daily cap counts them.
    db.execute(delete(PasswordReset).where(PasswordReset.created_at <= now - timedelta(days=1)))

    user = active_user(db, username)
    code = security.generate_otp()
    reset = PasswordReset(
        public_id=otp_service.new_public_id(otp_service.RESET_PREFIX),
        requested_username=username,
        phone=user.phone if user is not None else "",
        username=user.username if user is not None else None,
        # A made-up request has no real code: nothing was sent, and no guess can ever match this value.
        code_hash=security.hash_otp(user.phone, code) if user is not None else otp_service.NEVER_MATCHES,
        created_at=now,
        last_sent_at=now,
        expires_at=now + timedelta(minutes=settings.OTP_TTL_MINUTES),
        valid_until=now + timedelta(minutes=settings.OTP_FLOW_TTL_MINUTES),
    )
    db.add(reset)
    db.flush()
    row_id, public_id = reset.id, reset.public_id
    db.commit()
    # Recorded and committed BEFORE the limits are counted again, so a parallel burst cannot all pass (see start_signup).
    otp_service.check_limits(db, PasswordReset, PasswordReset.requested_username, username, now, mine_id=row_id)

    if user is not None:
        # Sent AFTER the reply, never inline: an inline send would make the reply slower for real usernames, which
        # tells an attacker who has an account.
        background_tasks.add_task(otp_service.send_code_text, user.phone, code)

    return ForgotResponse(
        reset_id=public_id,
        masked_phone=mask_phone(user.phone) if user is not None else otp_service.fake_masked_phone(username),
        message=FORGOT_MESSAGE,
        expires_in_seconds=_code_lifetime(),
        resend_after_seconds=settings.OTP_RESEND_COOLDOWN_SECONDS,
    )


def verify_reset_otp(db: Session, reset_id: str, code: str) -> VerifyOTPResponse:
    """Forgot Password, step b: right code -> a one-time reset token that is valid for a short time.

    Only this request's own code is checked, and it counts its own wrong guesses (otp_service.check_code).
    """
    now = utcnow()
    reset = db.scalar(select(PasswordReset).where(PasswordReset.public_id == reset_id))
    if reset is None:
        raise otp_service.not_found_error()
    if reset.valid_until is None or reset.valid_until <= now or reset.verified_at is not None or reset.used_at is not None:
        raise otp_service.request_expired_error()
    otp_service.check_code(db, PasswordReset, reset, code, now)
    if reset.username is None:  # a made-up request can never get here (its stored code matches nothing)
        raise otp_service.invalid_code_error()

    reset_token = security.new_opaque_token()
    claimed = db.execute(
        update(PasswordReset)
        .where(
            PasswordReset.id == reset.id,
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
        raise otp_service.request_expired_error()
    return VerifyOTPResponse(
        reset_token=reset_token,
        expires_in_seconds=settings.RESET_SESSION_TIMEOUT_MINUTES * 60,
    )


def reset_password(db: Session, reset_token: str, new_password: str) -> str:
    """Forgot Password, step c: the reset token works once, within the reset session timeout. Returns the username.

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
    user = active_user(db, row.username)
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
    username = user.username
    # The password is changed, so no other code or reset session for this user may change it again.
    still_open = (PasswordReset.username == username, PasswordReset.used_at.is_(None))
    db.execute(
        update(PasswordReset)
        .where(*still_open, PasswordReset.expires_at > now)
        .values(expires_at=now, valid_until=now)
        .execution_options(synchronize_session=False)
    )
    db.execute(
        update(PasswordReset)
        .where(*still_open, PasswordReset.reset_expires_at > now)
        .values(reset_expires_at=now)
        .execution_options(synchronize_session=False)
    )
    session_service.end_all_sessions(db, username, commit=False)  # sign out everywhere
    db.execute(delete(LoginAttempt).where(LoginAttempt.username == username))  # lift any lockout
    db.commit()
    return username
