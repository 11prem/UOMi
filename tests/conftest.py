"""Test setup: a fresh in-memory database for every test, and fast password hashing."""

import os

# These must be set before anything from `app` is imported, because settings are read on import.
os.environ["ENVIRONMENT"] = "test"  # the only environment allowed to use fewer than 12 bcrypt rounds
os.environ["DATABASE_URL"] = "sqlite://"  # in-memory: tests never touch your real database
os.environ["BCRYPT_ROUNDS"] = "4"  # the minimum, so tests that sign up many users stay fast
os.environ["DEBUG"] = "false"  # keep the tests independent of a developer's own .env
os.environ["OTP_HMAC_KEY"] = ""  # the tests use the key derived from SECRET_KEY
os.environ["RETENTION_ENABLED"] = "false"  # nor the clean-up thread
os.environ["PUSH_ENABLED"] = "false"  # a push test switches it on after the client exists, so no worker thread starts
os.environ["REMINDERS_ENABLED"] = "false"  # `with TestClient(app)` must not start the reminder thread on the test DB
os.environ.setdefault("SECRET_KEY", "test-secret-key-0123456789-0123456789")

import time  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.models  # noqa: E402, F401
from app.database import Base, engine  # noqa: E402
from app.main import app as fastapi_app  # noqa: E402
from app.utils.rate_limit import limiter  # noqa: E402
from tests import helpers  # noqa: E402


@pytest.fixture(autouse=True)
def database():
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture(autouse=True)
def fresh_rate_limits():
    """The rate limiter keeps its counters in memory for the whole process, so each test starts from zero."""
    limiter.reset()
    yield
    limiter.reset()
    limiter.clock = time.monotonic  # a test may have moved time forward


@pytest.fixture
def client():
    with TestClient(fastapi_app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def sms_outbox(monkeypatch):
    """Collects every text the app would send, as (phone, message) pairs.

    Always on: signing up needs the texted code, so `tests.helpers.register` reads it from here.
    """
    helpers.OUTBOX.clear()
    monkeypatch.setattr(
        "app.services.sms_service.send_sms", lambda phone, message: helpers.OUTBOX.append((phone, message))
    )
    return helpers.OUTBOX
