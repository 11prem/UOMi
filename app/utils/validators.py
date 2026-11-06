"""Input validators shared by the schemas. They raise ValueError, which Pydantic reports as a 422."""

import re

from app.config import settings

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_BYTES = 72  # bcrypt cannot handle more than this
MIN_FULL_PHONE_DIGITS = 10  # fewer digits than this is treated as a half-typed number in search

_USERNAME_RE = re.compile(r"^[a-z0-9_.]{3,30}$")
_E164_RE = re.compile(r"^\+[1-9]\d{7,14}$")
_PHONE_CHARS_RE = re.compile(r"^\+?[\d\s\-().]+$")


def validate_username(username: str) -> str:
    """Trim and lowercase, then require 3-30 letters, digits, '_' or '.'."""
    username = username.strip().lower()
    if not _USERNAME_RE.fullmatch(username):
        raise ValueError("Username must be 3-30 characters: letters, digits, '_' or '.'")
    return username


def clean_name(name: str) -> str:
    """Trim and collapse inner whitespace. Must not end up empty."""
    cleaned = " ".join(name.split())
    if not cleaned:
        raise ValueError("Name must not be empty")
    return cleaned


def normalize_phone(phone: str) -> str:
    """Return the number in E.164 form (+919876543210).

    Spaces, dashes and brackets are dropped. A number without a '+' is treated as a national
    number and gets DEFAULT_COUNTRY_CODE.
    """
    cleaned = re.sub(r"[\s\-().]", "", phone)
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
    if not cleaned.startswith("+"):
        cleaned = settings.DEFAULT_COUNTRY_CODE + cleaned.lstrip("0")
    if not _E164_RE.fullmatch(cleaned):
        raise ValueError("Enter a valid phone number")
    return cleaned


def parse_full_phone(text: str) -> str | None:
    """For people search: return the E.164 number if `text` is a complete phone number, else None.

    "Complete" means it only holds phone characters and at least MIN_FULL_PHONE_DIGITS digits,
    so a half-typed number never matches anyone.
    """
    text = text.strip()
    if not _PHONE_CHARS_RE.fullmatch(text):
        return None
    if len(re.sub(r"\D", "", text)) < MIN_FULL_PHONE_DIGITS:
        return None
    try:
        return normalize_phone(text)
    except ValueError:
        return None


def validate_password_strength(password: str) -> str:
    """The spec gives no password rules, so this only enforces a minimum length. Tighten as needed."""
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise ValueError("Password is too long")
    return password


def passwords_match(password: str, confirm_password: str) -> None:
    """Used for the 'confirm' field on Create Account and Set new password."""
    if password != confirm_password:
        raise ValueError("Passwords do not match")
