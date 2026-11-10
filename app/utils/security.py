"""Pure security helpers: passwords, tokens, one-time codes. No database access in here."""

import hashlib
import hmac
import secrets
import string
from datetime import timedelta
from functools import lru_cache

import bcrypt
import jwt

from app.config import settings
from app.database import utcnow

ACCESS_PURPOSE = "access"

# Fixed on purpose, not a setting: a token signed with any other algorithm (including "none") is refused.
JWT_ALGORITHM = "HS256"
_REQUIRED_CLAIMS = ["exp", "sub", "sid", "purpose", "iss", "aud"]


class TokenError(Exception):
    """The access token is missing a claim, has a bad signature, or is the wrong kind."""


class TokenExpired(TokenError):
    """The access token is genuine but past its expiry. The app should refresh it."""


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------


def hash_password(password: str) -> str:
    salt = bcrypt.gensalt(rounds=settings.BCRYPT_ROUNDS)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:  # e.g. a password longer than bcrypt's 72-byte limit
        return False


@lru_cache(maxsize=1)
def dummy_password_hash() -> str:
    """A real bcrypt hash of a throwaway password. Checked when the username does not exist, so a
    wrong username takes as long to reject as a wrong password."""
    return hash_password("not-a-real-password")


# ---------------------------------------------------------------------------
# Opaque tokens (refresh token, password-reset token)
# ---------------------------------------------------------------------------


def new_opaque_token() -> str:
    """A random, unguessable token. Only its hash is stored in the database."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Access token (JWT)
# ---------------------------------------------------------------------------


def create_access_token(username: str, session_id: str) -> str:
    """The username is the identity; `sid` ties the token to a row in refresh_tokens (the session)."""
    now = utcnow()
    payload = {
        "iss": settings.JWT_ISSUER,  # who made the token: this API
        "aud": settings.JWT_AUDIENCE,  # who it is for: the UOMi app
        "sub": username,
        "sid": session_id,
        "purpose": ACCESS_PURPOSE,
        "iat": now,
        "exp": now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> tuple[str, str]:
    """Return (username, session_id). Raises TokenExpired or TokenError."""
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[JWT_ALGORITHM],
            issuer=settings.JWT_ISSUER,
            audience=settings.JWT_AUDIENCE,
            options={"require": _REQUIRED_CLAIMS},
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenExpired("Access token expired") from exc
    except jwt.PyJWTError as exc:
        raise TokenError("Invalid access token") from exc
    if payload.get("purpose") != ACCESS_PURPOSE:
        raise TokenError("Wrong token type")
    return payload["sub"], payload["sid"]


# ---------------------------------------------------------------------------
# One-time codes (forgot password)
# ---------------------------------------------------------------------------


def generate_otp(length: int | None = None) -> str:
    return "".join(secrets.choice(string.digits) for _ in range(length or settings.OTP_LENGTH))


def _otp_hmac_key() -> bytes:
    """The key for the texted codes: OTP_HMAC_KEY, which is separate from the token-signing SECRET_KEY.

    Left empty (development), a key is derived from SECRET_KEY for this one purpose, so the two uses
    still never share a key. Production requires OTP_HMAC_KEY to be set (see config.production_problems).
    """
    if settings.OTP_HMAC_KEY:
        return settings.OTP_HMAC_KEY.encode("utf-8")
    return hmac.new(settings.SECRET_KEY.encode("utf-8"), b"uomi:otp-hmac-key:v1", hashlib.sha256).digest()


def hash_otp(phone: str, code: str) -> str:
    """HMAC of the code, bound to the phone number. The plain code is never stored."""
    message = f"otp:{phone}:{code}".encode("utf-8")
    return hmac.new(_otp_hmac_key(), message, hashlib.sha256).hexdigest()


def safe_equal(a: str, b: str) -> bool:
    """Constant-time string comparison."""
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))
