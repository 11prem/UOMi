"""Request/response shapes for sign up, sign in, sessions, forgot password and people search."""

from pydantic import BaseModel, ConfigDict, Field, StrictBool, ValidationInfo, field_validator

from app.currencies import SUPPORTED_CURRENCIES

from app.utils.validators import (
    MAX_PERSON_NAME,
    clean_name,
    normalize_phone,
    reject_nul,
    passwords_match,
    validate_new_username,
    validate_password_strength,
)

# ---------------------------------------------------------------------------
# Sign up / sign in / session
# ---------------------------------------------------------------------------


class RegisterRequest(BaseModel):
    """Create Account screen (specs § 4.2): username (unique), name, phone, password, confirm.

    Sending it starts the sign-up and texts a code. The account exists only after the code is accepted (§ 4.3).
    """

    username: str = Field(max_length=50)
    name: str = Field(min_length=1, max_length=500)  # a guard against huge bodies; the validator enforces 1-50
    phone: str = Field(max_length=30)
    password: str = Field(max_length=128)
    confirm_password: str = Field(max_length=128)

    @field_validator("username")
    @classmethod
    def check_username(cls, v: str) -> str:
        return validate_new_username(v)

    @field_validator("name")
    @classmethod
    def check_name(cls, v: str) -> str:
        return clean_name(v, MAX_PERSON_NAME)

    @field_validator("phone")
    @classmethod
    def check_phone(cls, v: str) -> str:
        return normalize_phone(v)

    @field_validator("password")
    @classmethod
    def check_password(cls, v: str) -> str:
        return validate_password_strength(v)

    @field_validator("confirm_password")
    @classmethod
    def check_passwords_match(cls, v: str, info: ValidationInfo) -> str:
        # On the confirm field, so the error names `confirm_password`. `password` is missing from
        # info.data when it failed its own check; then there is nothing to compare.
        if "password" in info.data:
            passwords_match(info.data["password"], v)
        return v


class LoginRequest(BaseModel):
    """Sign In screen: username + password."""

    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("username")
    @classmethod
    def lowercase_username(cls, v: str) -> str:
        cleaned = v.strip().lower()
        if len(cleaned) > 50:  # lower() can lengthen a string, and the username column is shorter than that
            raise ValueError("Username is too long")
        return reject_nul(cleaned)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=200)


class TokenPair(BaseModel):
    """What sign up, sign in and refresh return.

    The app should keep its own inactivity timer using `idle_timeout_seconds`, and treat any
    401 with code `session_expired` as "send the user back to the Login page".
    """

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds until the access token expires (then call /auth/refresh)
    idle_timeout_seconds: int  # seconds of inactivity after which the session ends


class MessageOut(BaseModel):
    message: str


# ---------------------------------------------------------------------------
# Verify phone (specs § 4.3) and the shared code screen (§ 3.4)
# ---------------------------------------------------------------------------

# ASCII digits only: in a pattern, `\d` also matches digits of other scripts.
CODE_PATTERN = r"^[0-9]+$"


class SignupStarted(BaseModel):
    """The sign-up is waiting for the code that was just texted. No account exists yet."""

    pending_id: str  # keep it: the code screen sends it back with the code, and "resend" uses it
    masked_phone: str  # "+91 80******31", for "We sent a 6-digit code to ..."
    expires_in_seconds: int  # how long the code is valid
    resend_after_seconds: int  # when "Resend code" may be used


class VerifySignupRequest(BaseModel):
    """Verify phone: the id from the sign-up and the 6-digit code."""

    pending_id: str = Field(min_length=1, max_length=60)
    code: str = Field(pattern=CODE_PATTERN, min_length=4, max_length=10)

    @field_validator("pending_id")
    @classmethod
    def check_pending_id(cls, v: str) -> str:
        return reject_nul(v)


class ResendRequest(BaseModel):
    """"Resend code" on the code screen: a `pending_id` (sign-up) or a `reset_id` (forgot password)."""

    id: str = Field(min_length=1, max_length=60)

    @field_validator("id")
    @classmethod
    def check_id(cls, v: str) -> str:
        return reject_nul(v)


class ResendOut(BaseModel):
    expires_in_seconds: int  # how long the new code is valid
    resend_after_seconds: int  # when "Resend code" may be used again


class AvailabilityOut(BaseModel):
    """The live checks on Create Account: `available` is true when nobody has it yet."""

    available: bool


# ---------------------------------------------------------------------------
# Forgot password (specs § 4.5): username, then the masked phone and code, then the new password
# ---------------------------------------------------------------------------


class ForgotRequest(BaseModel):
    """Forgot Password, step a: the username. Its phone number gets the code."""

    username: str = Field(min_length=1, max_length=50)

    @field_validator("username")
    @classmethod
    def lowercase_username(cls, v: str) -> str:
        # Not checked against the sign-up rules: an unknown or odd name must get the same reply as a real one.
        cleaned = v.strip().lower()
        if len(cleaned) > 50:  # lower() can make a string longer ("İ" becomes two characters): the column holds 50
            raise ValueError("Username is too long")
        return reject_nul(cleaned)


class ForgotResponse(BaseModel):
    """Always the same shape, whether or not the username exists (so it cannot be used to find out who has one)."""

    reset_id: str  # keep it: the code screen sends it back with the code, and "resend" uses it
    masked_phone: str  # "+91 80******31", for "We sent a 6-digit code to ..."
    message: str
    expires_in_seconds: int  # how long the code is valid
    resend_after_seconds: int  # when "Resend code" may be used again


class VerifyOTPRequest(BaseModel):
    """Forgot Password, step b: the id from the request and the 6-digit code."""

    reset_id: str = Field(min_length=1, max_length=60)
    code: str = Field(pattern=CODE_PATTERN, min_length=4, max_length=10)

    @field_validator("reset_id")
    @classmethod
    def check_reset_id(cls, v: str) -> str:
        return reject_nul(v)


class VerifyOTPResponse(BaseModel):
    reset_token: str  # one-time token that allows setting a new password
    expires_in_seconds: int  # how long the user has to set the new password


class ResetRequest(BaseModel):
    """Set new password screen: new + confirm."""

    reset_token: str = Field(min_length=1, max_length=200)
    new_password: str = Field(max_length=128)
    confirm_password: str = Field(max_length=128)

    @field_validator("new_password")
    @classmethod
    def check_password(cls, v: str) -> str:
        return validate_password_strength(v)

    @field_validator("confirm_password")
    @classmethod
    def check_passwords_match(cls, v: str, info: ValidationInfo) -> str:
        if "new_password" in info.data:
            passwords_match(info.data["new_password"], v)
        return v


class ResetOut(BaseModel):
    """The password is changed. `username` fills the Sign In screen, which comes next (specs § 4.5)."""

    message: str
    username: str


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------


class UserSummary(BaseModel):
    """Public view of a person. Never includes the phone number."""

    model_config = ConfigDict(from_attributes=True)

    username: str
    name: str


class UserMe(BaseModel):
    """GET /users/me: the signed-in person's own profile, so the phone is theirs to see."""

    model_config = ConfigDict(from_attributes=True)

    username: str
    name: str
    phone: str  # E.164
    currency: str  # their default currency, used for a new space when none is picked
    notifications_on: bool  # the Profile page's switch; whether pushes may be sent


class DeleteAccountRequest(BaseModel):
    """Profile, Delete my account: the password is asked for again, because this cannot be undone."""

    model_config = ConfigDict(extra="forbid")

    password: str = Field(max_length=128)  # not checked for strength: it is compared with the one on file


class UserUpdate(BaseModel):
    """Profile, Edit and the preferences (specs § 13): any of these. A field left out, or null, stays as it is.

    The username and the phone number cannot be changed, so sending them is an error rather than being ignored.
    The theme is not here: it stays on the phone.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=500)  # the validator enforces 1-50
    currency: str | None = None  # the default currency
    notifications_on: StrictBool | None = None

    @field_validator("name")
    @classmethod
    def check_name(cls, v: str | None) -> str | None:
        return None if v is None else clean_name(v, MAX_PERSON_NAME)

    @field_validator("currency")
    @classmethod
    def check_currency(cls, v: str | None) -> str | None:
        if v is not None and v not in SUPPORTED_CURRENCIES:
            raise ValueError(f"Currency must be one of: {', '.join(SUPPORTED_CURRENCIES)}")
        return v


class UserSearchResult(UserSummary):
    """A row on the Add People page."""

    is_friend: bool  # shares at least one space with the person searching
