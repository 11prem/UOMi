"""Request/response shapes for sign up, sign in, sessions, forgot password and people search."""

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.utils.validators import (
    clean_name,
    normalize_phone,
    passwords_match,
    validate_password_strength,
    validate_username,
)

# ---------------------------------------------------------------------------
# Sign up / sign in / session
# ---------------------------------------------------------------------------


class RegisterRequest(BaseModel):
    """Create Account screen: username (unique), name, phone, password, confirm."""

    username: str = Field(max_length=50)
    name: str = Field(min_length=1, max_length=100)
    phone: str = Field(max_length=30)
    password: str = Field(max_length=128)
    confirm_password: str = Field(max_length=128)

    @field_validator("username")
    @classmethod
    def check_username(cls, v: str) -> str:
        return validate_username(v)

    @field_validator("name")
    @classmethod
    def check_name(cls, v: str) -> str:
        return clean_name(v)

    @field_validator("phone")
    @classmethod
    def check_phone(cls, v: str) -> str:
        return normalize_phone(v)

    @field_validator("password")
    @classmethod
    def check_password(cls, v: str) -> str:
        return validate_password_strength(v)

    @model_validator(mode="after")
    def check_passwords_match(self) -> "RegisterRequest":
        passwords_match(self.password, self.confirm_password)
        return self


class LoginRequest(BaseModel):
    """Sign In screen: username + password."""

    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("username")
    @classmethod
    def lowercase_username(cls, v: str) -> str:
        return v.strip().lower()


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
# Forgot password
# ---------------------------------------------------------------------------


class ForgotRequest(BaseModel):
    """Forgot Password screen: the registered phone number a code is texted to."""

    phone: str = Field(max_length=30)

    @field_validator("phone")
    @classmethod
    def check_phone(cls, v: str) -> str:
        return normalize_phone(v)


class ForgotResponse(BaseModel):
    """Always the same, whether or not the number is registered."""

    message: str
    expires_in_seconds: int  # how long the code is valid
    resend_after_seconds: int  # when the "resend" button may be used again


class VerifyOTPRequest(BaseModel):
    """Enter the code screen: the 6-digit code from the text message."""

    phone: str = Field(max_length=30)
    code: str = Field(pattern=r"^\d+$", min_length=4, max_length=10)

    @field_validator("phone")
    @classmethod
    def check_phone(cls, v: str) -> str:
        return normalize_phone(v)


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

    @model_validator(mode="after")
    def check_passwords_match(self) -> "ResetRequest":
        passwords_match(self.new_password, self.confirm_password)
        return self


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------


class UserSummary(BaseModel):
    """Public view of a person. Never includes the phone number."""

    model_config = ConfigDict(from_attributes=True)

    username: str
    name: str


class UserSearchResult(UserSummary):
    """A row on the Add People page."""

    is_friend: bool  # shares at least one space with the person searching
