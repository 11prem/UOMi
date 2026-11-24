"""Input validators shared by the schemas. They raise ValueError, which Pydantic reports as a 422."""

import re

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_BYTES = 72  # bcrypt cannot handle more than this
MAX_EMAIL = 254  # RFC 5321
MAX_EMAIL_LOCAL = 64
MAX_ID = 2**31 - 1  # the largest id a path/query parameter may carry; anything bigger overflows the database
MAX_NEW_USERNAME = 20  # specs § 4.2: a NEW account's username is 3-20 characters
MAX_KNOWN_USERNAME = 30  # older accounts may have up to 30: people with one must stay findable and able to sign in
MAX_PERSON_NAME = 50  # specs § 4.2

# Explicit ASCII digits everywhere: a bare `\d` also matches digits of other scripts (Arabic-Indic, fullwidth ...).
_NEW_USERNAME_RE = re.compile(r"^[a-z0-9_.]{3,20}$")
_KNOWN_USERNAME_RE = re.compile(r"^[a-z0-9_.]{3,30}$")
_EMAIL_LOCAL_RE = re.compile(r"^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$")  # printable ASCII, no spaces, no '@'
_EMAIL_LABEL_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")  # one part of the domain

_PHONE_CHARS_RE = re.compile(r"^\+?[0-9]+$")
MIN_PHONE_DIGITS = 8
MAX_PHONE_DIGITS = 15  # E.164
DEFAULT_COUNTRY_CODE = "91"  # a 10-digit national number is read as an Indian one (INR first, specs § 1)

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


def normalize_email(email: str) -> str:
    """Trim and lowercase an email address, or raise if it cannot be one.

    ASCII only, at most 254 characters (64 before the '@'), exactly one '@', no spaces, and a domain of at least two
    valid labels (letters, digits, hyphens; none starts or ends with a hyphen). It is a format check, not a
    guarantee that the mailbox exists: the emailed code proves that.
    """
    email = email.strip().lower()
    local, at, domain = email.partition("@")
    labels = domain.split(".")
    if (
        not at
        or not email.isascii()
        or len(email) > MAX_EMAIL
        or not local
        or len(local) > MAX_EMAIL_LOCAL
        or not _EMAIL_LOCAL_RE.fullmatch(local)
        or len(labels) < 2
        or not all(_EMAIL_LABEL_RE.fullmatch(label) for label in labels)
    ):
        raise ValueError("Enter a valid email address")
    return email


def normalize_phone(phone: str) -> str:
    """The phone number as E.164 (`+919876543210`), or raise if it cannot be one.

    Spaces, dashes, dots and brackets are ignored. ASCII digits only (look-alike digits of other scripts are refused),
    8 to 15 digits. A number with no leading '+' and exactly 10 digits is taken as an Indian number (+91). It is a
    format check, not a guarantee that the number exists.
    """
    cleaned = re.sub(r"[ \-.()]", "", phone.strip())
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
    if not phone.isascii() or not _PHONE_CHARS_RE.fullmatch(cleaned):
        raise ValueError("Enter a valid phone number")
    digits = cleaned.lstrip("+")
    if not cleaned.startswith("+") and len(digits) == 10:
        digits = DEFAULT_COUNTRY_CODE + digits
    if not MIN_PHONE_DIGITS <= len(digits) <= MAX_PHONE_DIGITS or digits.startswith("0"):
        raise ValueError("Enter a valid phone number")
    return "+" + digits


def mask_email(email: str) -> str:
    """`kabir.r@example.com` -> `ka*****@example.com`: the first two letters of the part before '@' stay visible.

    One letter is always hidden, so `a@x.io` -> `*@x.io` and `ab@x.io` -> `a*@x.io`. The app uses the same rule.
    """
    local, _, domain = email.partition("@")
    kept = min(2, len(local) - 1)
    return f"{local[:kept]}{'*' * (len(local) - kept)}@{domain}"


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
