"""SQLAlchemy engine, session factory, declarative Base, `get_db`, and the UTC datetime type."""

from collections.abc import Generator
from datetime import datetime, timezone

from sqlalchemy import DateTime, create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.types import TypeDecorator

from app.config import settings


def utcnow() -> datetime:
    """The current time as a timezone-aware UTC datetime. Use this everywhere instead of datetime.now()."""
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    """A DateTime that always comes back timezone-aware and in UTC.

    SQLite drops timezone info when it stores a datetime. Without this type, comparing a value read
    back from the database with `utcnow()` (timezone-aware) raises a TypeError.
    """

    impl = DateTime
    cache_ok = True

    def __init__(self, *args, **kwargs) -> None:
        kwargs.setdefault("timezone", True)
        super().__init__(*args, **kwargs)

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("Naive datetime: use timezone-aware UTC datetimes (database.utcnow)")
        return value.astimezone(timezone.utc)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


def make_engine(url: str) -> Engine:
    """Create an engine with the right settings for SQLite (dev, tests) or PostgreSQL."""
    kwargs: dict = {}
    is_sqlite = url.startswith("sqlite")
    if is_sqlite:
        # SQLite connections are single-thread by default; FastAPI uses a thread pool.
        kwargs["connect_args"] = {"check_same_thread": False}
        if url in ("sqlite://", "sqlite:///:memory:"):
            kwargs["poolclass"] = StaticPool  # one shared connection, so the in-memory DB survives
    else:
        kwargs["pool_pre_ping"] = True
    engine = create_engine(url, **kwargs)

    if is_sqlite:

        @event.listens_for(engine, "connect")
        def _enable_foreign_keys(dbapi_connection, _record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


engine = make_engine(settings.DATABASE_URL)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    """Base class for every ORM model."""


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: one DB session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
