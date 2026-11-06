"""Application settings, loaded from environment variables and the `.env` file.

Every timeout in the app lives here, so changing one is a one-line edit in `.env`.
"""

from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- App ---
    APP_NAME: str = "UOMi"
    DEBUG: bool = False
    DATABASE_URL: str = "sqlite:///./uomi.db"  # PostgreSQL: postgresql+psycopg://USER:PASSWORD@HOST/DBNAME

    # Browser origins allowed to call the API (the Expo web build). The env value is comma separated.
    CORS_ORIGINS: Annotated[list[str], NoDecode] = ["http://localhost:8081", "http://127.0.0.1:8081"]

    # --- Secrets ---
    SECRET_KEY: str = Field(min_length=32)  # required, no default on purpose
    JWT_ALGORITHM: str = "HS256"
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
    LOGIN_MAX_ATTEMPTS: int = 5
    LOGIN_LOCKOUT_MINUTES: int = 15

    # --- Forgot password (phone code) ---
    OTP_LENGTH: int = 6
    OTP_TTL_MINUTES: int = 5  # how long a texted code stays valid
    OTP_MAX_ATTEMPTS: int = 5  # wrong guesses before the code is dead
    OTP_MAX_REQUESTS_PER_HOUR: int = 3  # codes per phone number per hour
    OTP_RESEND_COOLDOWN_SECONDS: int = 60  # wait before asking for another code
    RESET_SESSION_TIMEOUT_MINUTES: int = 10  # time to set a new password after the code is accepted

    # --- Defaults ---
    DEFAULT_COUNTRY_CODE: str = "+91"
    DEFAULT_CURRENCY: str = "INR"

    # --- SMS ---
    # "console" writes the message to the server log (development). Real providers plug in later.
    SMS_BACKEND: str = "console"

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def split_origins(cls, value):
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


settings = Settings()
