"""Input validators shared by the schemas. They raise ValueError, which Pydantic reports as a 422."""

import re
from functools import lru_cache

import phonenumbers

from app.config import settings

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_BYTES = 72  # bcrypt cannot handle more than this
MIN_FULL_PHONE_DIGITS = 10  # fewer digits than this is treated as a half-typed number in search
MAX_ID = 2**31 - 1  # the largest id a path/query parameter may carry; anything bigger overflows the database
MAX_NEW_USERNAME = 20  # specs § 4.2: a NEW account's username is 3-20 characters
MAX_KNOWN_USERNAME = 30  # older accounts may have up to 30: people with one must stay findable and able to sign in
MAX_PERSON_NAME = 50  # specs § 4.2

# Explicit ASCII digits everywhere: a bare `\d` also matches digits of other scripts (Arabic-Indic, fullwidth ...).
_NEW_USERNAME_RE = re.compile(r"^[a-z0-9_.]{3,20}$")
_KNOWN_USERNAME_RE = re.compile(r"^[a-z0-9_.]{3,30}$")
_PHONE_CHARS_RE = re.compile(r"^\+?[0-9\s\-().]+$")  # what a search box may hold for a phone number
_PHONE_PUNCTUATION_RE = re.compile(r"[\s\-().]")  # dropped before a number is read
_PHONE_DIGITS_RE = re.compile(r"\+?[0-9]+")

PASSWORD_RULE = "Use at least 8 characters with a letter and a number"


def validate_username(username: str) -> str:
    """For finding a person who already exists (members, search, payments): trim, lowercase, 3-30 characters.

    Older accounts may be up to 30 characters, so this stays wider than the sign-up rule (validate_new_username).
    """
    username = username.strip().lower()
    if not _KNOWN_USERNAME_RE.fullmatch(username):
        raise ValueError("Username must be 3-30 characters: letters, digits, '_' or '.'")
    return username


def validate_new_username(username: str) -> str:
    """For creating an account (specs § 4.2): trim, lowercase, then 3-20 letters, digits, '_' or '.'."""
    username = username.strip().lower()
    if not _NEW_USERNAME_RE.fullmatch(username):
        raise ValueError("Username must be 3-20 characters: lowercase letters, digits, '_' or '.'")
    return username


def reject_nul(value: str) -> str:
    """A NUL character is refused: PostgreSQL text columns cannot hold one, so it would be a 500 there."""
    if chr(0) in value:
        raise ValueError("Contains a character that is not allowed")
    return value


def clean_name(name: str, max_length: int | None = None) -> str:
    """Trim and collapse inner whitespace. Must not end up empty, nor longer than `max_length` if one is given."""
    cleaned = reject_nul(" ".join(name.split()))
    if not cleaned:
        raise ValueError("Name must not be empty")
    if max_length is not None and len(cleaned) > max_length:
        raise ValueError(f"Keep it to {max_length} characters or fewer")
    return cleaned


@lru_cache
def _default_region() -> str:
    """The country a number typed without a country code belongs to (DEFAULT_COUNTRY_CODE, +91 means IN)."""
    region = phonenumbers.region_code_for_country_code(int(settings.DEFAULT_COUNTRY_CODE.lstrip("+")))
    if region in (None, "ZZ"):
        raise RuntimeError(f"DEFAULT_COUNTRY_CODE {settings.DEFAULT_COUNTRY_CODE!r} is not a real calling code")
    return region


def normalize_phone(phone: str) -> str:
    """Return the number in E.164 form (+919876543210), or raise if it is not a real mobile number.

    Only ASCII digits, spaces, dashes, dots and brackets are accepted, with an optional leading '+' (or '00').
    A number without a country code is read as a national number of DEFAULT_COUNTRY_CODE's country. It is then
    checked with libphonenumber (the same library family as the app): it must be a valid number for its country
    and a MOBILE line, because it receives the texted codes. A landline is refused where libphonenumber can tell it
    from a mobile; in the US and Canada it cannot (they share ranges), so a landline there is accepted.
    """
    cleaned = _PHONE_PUNCTUATION_RE.sub("", phone)
    if not _PHONE_DIGITS_RE.fullmatch(cleaned):  # ASCII digits only, a '+' only first: no look-alike digits, no letters
        raise ValueError("Enter a valid phone number")
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
    try:
        number = phonenumbers.parse(cleaned, _default_region())
    except phonenumbers.NumberParseException:
        raise ValueError("Enter a valid phone number") from None
    mobile = (phonenumbers.PhoneNumberType.MOBILE, phonenumbers.PhoneNumberType.FIXED_LINE_OR_MOBILE)
    if not phonenumbers.is_valid_number(number) or phonenumbers.number_type(number) not in mobile:
        raise ValueError("Enter a valid mobile phone number")
    return phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164)


def mask_phone(e164: str) -> str:
    """`+918012345631` -> `+91 80******31`: the first 2 and last 2 digits of the national number (specs § 1)."""
    try:
        number = phonenumbers.parse(e164, None)
    except phonenumbers.NumberParseException:
        return "*" * 6
    national = str(number.national_number)
    hidden = "*" * max(0, len(national) - 4)
    return f"+{number.country_code} {national[:2]}{hidden}{national[-2:]}"


def parse_full_phone(text: str) -> str | None:
    """For people search: return the E.164 number if `text` is a complete phone number, else None.

    "Complete" means it only holds phone characters and at least MIN_FULL_PHONE_DIGITS digits,
    so a half-typed number never matches anyone.
    """
    text = text.strip()
    if not _PHONE_CHARS_RE.fullmatch(text):
        return None
    if len(re.sub(r"[^0-9]", "", text)) < MIN_FULL_PHONE_DIGITS:
        return None
    try:
        return normalize_phone(text)
    except ValueError:
        return None


def validate_password_strength(password: str) -> str:
    """Specs § 4.2: at least 8 characters with at least one letter and one number (ASCII, as in the app)."""
    if (
        len(password) < MIN_PASSWORD_LENGTH
        or not re.search(r"[A-Za-z]", password)
        or not re.search(r"[0-9]", password)
    ):
        raise ValueError(PASSWORD_RULE)
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise ValueError("Password is too long")
    return password


def passwords_match(password: str, confirm_password: str) -> None:
    """Used for the 'confirm' field on Create Account and Set new password."""
    if password != confirm_password:
        raise ValueError("Passwords do not match")
