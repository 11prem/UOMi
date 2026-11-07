"""Test setup: a fresh in-memory database for every test, and fast password hashing."""

import os

# These must be set before anything from `app` is imported, because settings are read on import.
os.environ["DATABASE_URL"] = "sqlite://"  # in-memory: tests never touch your real database
os.environ["BCRYPT_ROUNDS"] = "4"  # the minimum, so tests that sign up many users stay fast
os.environ["DEBUG"] = "false"  # an old .env with DEBUG=true makes Starlette skip the JSON 500 handler
os.environ.setdefault("SECRET_KEY", "test-secret-key-0123456789-0123456789")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.models  # noqa: E402, F401
from app.database import Base, engine  # noqa: E402
from app.main import app as fastapi_app  # noqa: E402


@pytest.fixture(autouse=True)
def database():
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture
def client():
    with TestClient(fastapi_app) as test_client:
        yield test_client


@pytest.fixture
def sms_outbox(monkeypatch):
    """Collects the texts the app would send, as (phone, message) pairs."""
    outbox: list[tuple[str, str]] = []
    monkeypatch.setattr(
        "app.services.sms_service.send_sms", lambda phone, message: outbox.append((phone, message))
    )
    return outbox
