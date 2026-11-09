"""Application settings, loaded from environment variables and the `.env` file.

Every timeout and every limit in the app lives here, so changing one is a one-line edit in `.env`.

`ENVIRONMENT` decides how strict the app is:
  development  the default: the console SMS backend and the public /docs page are fine
  test         the test suite: the only environment that may use fewer than 12 bcrypt rounds
  staging      like development, except that it also needs the 12-bcrypt-round floor. The key, SMS, DEBUG and CORS
               checks run in production only: run a staging copy with ENVIRONMENT=production to rehearse them
  production   `check_production_settings` refuses to start the API with unsafe settings, /docs is off,
               and CORS_ORIGINS defaults to nothing instead of the Expo web dev server
"""

from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

MIN_BCRYPT_ROUNDS = 12  # every environment except "test"
MIN_KEY_LENGTH = 32

# A key that contains one of these was copied from an example, not generated.
_PLACEHOLDER_WORDS = ("changeme", "change-me", "change_me", "secret", "password", "example", "your-", "test-")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- App ---
    APP_NAME: str = "UOMi"
    ENVIRONMENT: Literal["development", "test", "staging", "production"] = "development"
    DEBUG: bool = False
    DATABASE_URL: str = "sqlite:///./uomi.db"  # PostgreSQL: postgresql+psycopg://USER:PASSWORD@HOST/DBNAME

    # Browser origins allowed to call the API (the Expo web build). The env value is comma separated.
    # In production this defaults to [] (the native app does not use CORS); set exact https:// origins to allow a web build.
    CORS_ORIGINS: Annotated[list[str], NoDecode] = ["http://localhost:8081", "http://127.0.0.1:8081"]

    # --- Secrets ---
    SECRET_KEY: str = Field(min_length=MIN_KEY_LENGTH)  # required, no default on purpose; signs the access tokens
    # Its own key for the texted codes, so leaking one key does not break the other. Empty: derived from
    # SECRET_KEY (fine for development). Production requires it.
    OTP_HMAC_KEY: str = ""
    # The access tokens carry these claims and are refused without them. The algorithm is fixed to HS256 in code.
    JWT_ISSUER: str = "uomi-api"
    JWT_AUDIENCE: str = "uomi-app"
    BCRYPT_ROUNDS: int = Field(default=12, ge=4, le=15)

    # --- Sign-in session ---
    # Access token: short-lived, refreshed with the refresh token.
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    # Refresh token: the longest a session can live, even for a user who never goes idle.
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    # Inactivity limit: no authenticated request for this long -> signed out.
    SESSION_IDLE_TIMEOUT_MINUTES: int = 10
    # Activity is written to the database at most this often per session (saves a write per request).
    SESSION_TOUCH_INTERVAL_SECONDS: int = 30

    # --- Sign-in lockout ---
    LOGIN_MAX_ATTEMPTS: int = 5  # per username: the 6th attempt in the window is refused
    LOGIN_LOCKOUT_MINUTES: int = 15
    LOGIN_MAX_PER_IP: int = Field(default=30, ge=1)  # sign-in attempts from one address per lockout window

    # --- Forgot password (phone code) ---
    OTP_LENGTH: int = 6
    OTP_TTL_MINUTES: int = 5  # how long a texted code stays valid
    OTP_MAX_ATTEMPTS: int = 5  # wrong guesses before the code is dead
    OTP_MAX_REQUESTS_PER_HOUR: int = 3  # codes per phone number per hour
    OTP_RESEND_COOLDOWN_SECONDS: int = 60  # wait before asking for another code
    RESET_SESSION_TIMEOUT_MINUTES: int = 10  # time to set a new password after the code is accepted

    # --- Rate limits (see app/utils/rate_limit.py) ---
    REGISTER_MAX_PER_IP_PER_HOUR: int = Field(default=20, ge=1)
    FORGOT_MAX_PER_IP_PER_HOUR: int = Field(default=10, ge=1)  # code requests from one address, for any phone numbers
    VERIFY_OTP_MAX_PER_IP_PER_HOUR: int = Field(default=30, ge=1)
    SEARCH_MAX_PER_USER_PER_MINUTE: int = Field(default=120, ge=1)
    SEARCH_MAX_PER_IP_PER_MINUTE: int = Field(default=240, ge=1)
    PHONE_LOOKUPS_PER_USER_PER_HOUR: int = Field(default=20, ge=1)  # searches by a complete phone number
    # Most codes (texts) the whole API will create per UTC day, for every phone number together. A last-resort
    # brake on the SMS bill: also set a spend limit at the SMS provider. Trade-off: whoever uses the whole cap
    # up blocks password resets for everyone until UTC midnight, so size it well above real daily use.
    SMS_DAILY_CAP: int = Field(default=1000, ge=1)
    # How many proxies (load balancers) sit in front of the API. 0 = none: the socket address is the client.
    # Only set this when the API can be reached ONLY through those proxies: if clients can also connect directly,
    # they can send their own X-Forwarded-For and pick any address for the per-address limits.
    TRUSTED_PROXY_COUNT: int = Field(default=0, ge=0)

    # --- Defaults ---
    DEFAULT_COUNTRY_CODE: str = "+91"
    DEFAULT_CURRENCY: str = "INR"

    # --- SMS ---
    # "console" writes the message to the server log (development). Real providers plug in later.
    SMS_BACKEND: str = "console"

    # --- Payment reminders ---
    # Runs the daily reminder job (days 3, 5, 7 and 10 after a share is accepted) inside the API process.
    REMINDERS_ENABLED: bool = True

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def split_origins(cls, value):
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("OTP_HMAC_KEY")
    @classmethod
    def check_otp_key_length(cls, value: str) -> str:
        if value and len(value) < MIN_KEY_LENGTH:
            raise ValueError(f"OTP_HMAC_KEY must be at least {MIN_KEY_LENGTH} characters, or empty")
        return value

    @model_validator(mode="after")
    def apply_environment_rules(self) -> "Settings":
        if self.ENVIRONMENT != "test" and self.BCRYPT_ROUNDS < MIN_BCRYPT_ROUNDS:
            raise ValueError(
                f"BCRYPT_ROUNDS must be at least {MIN_BCRYPT_ROUNDS}: fewer rounds make stolen password "
                "hashes cheap to crack (only ENVIRONMENT=test may use fewer)"
            )
        if self.ENVIRONMENT == "production" and "CORS_ORIGINS" not in self.model_fields_set:
            self.CORS_ORIGINS = []  # the Expo web dev server must not be allowed by accident
        return self

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    def production_problems(self) -> list[str]:
        """Everything that makes these settings unsafe for a public API, as sentences for a person."""
        problems: list[str] = []
        if self.DEBUG:
            problems.append("DEBUG is true: set DEBUG=false (it can expose internal details).")
        if self.SMS_BACKEND == "console":
            problems.append(
                "SMS_BACKEND is 'console', which writes every one-time code to the server log. "
                "Set a real SMS provider."
            )
        weakness = _key_weakness(self.SECRET_KEY)
        if weakness:
            problems.append(f"SECRET_KEY {weakness}. Generate one: python -c \"import secrets; print(secrets.token_hex(32))\"")
        if not self.OTP_HMAC_KEY:
            problems.append("OTP_HMAC_KEY is not set: give the texted codes their own random key of 32 or more characters.")
        elif self.OTP_HMAC_KEY == self.SECRET_KEY:
            problems.append("OTP_HMAC_KEY must differ from SECRET_KEY.")
        else:
            weakness = _key_weakness(self.OTP_HMAC_KEY)
            if weakness:
                problems.append(f"OTP_HMAC_KEY {weakness}.")
        for origin in self.CORS_ORIGINS:
            if origin == "*" or not origin.startswith("https://"):
                problems.append(f"CORS_ORIGINS has {origin!r}: list exact https:// origins, or leave it empty.")
        return problems


def _key_weakness(key: str) -> str | None:
    lowered = key.lower()
    if any(word in lowered for word in _PLACEHOLDER_WORDS):
        return "looks like a placeholder"
    if len(set(key)) < 10:
        return "uses too few different characters"
    return None


def check_production_settings(current: Settings | None = None) -> None:
    """Refuse to start the API with unsafe settings in production. Does nothing in any other environment."""
    target = current if current is not None else settings
    if not target.is_production:
        return
    problems = target.production_problems()
    if problems:
        raise RuntimeError(
            "Refusing to start with ENVIRONMENT=production:\n" + "\n".join(f"  - {problem}" for problem in problems)
        )


settings = Settings()
