"""Hardening: CORS, one error envelope, id bounds, atomic OTP attempts, phone normalising, example env."""

import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.config import Settings, settings
from app.database import Base, make_engine, utcnow
from app.main import app as fastapi_app
from app.models.password_reset import PasswordReset
from app.models.user import User
from app.services import auth_service, group_service
from app.utils import security
from app.utils.validators import normalize_phone
from tests.helpers import auth, register, register_payload

ORIGIN = "http://localhost:8081"
HUGE_ID = 99999999999999999999


# --- CORS -------------------------------------------------------------------


def test_cors_preflight_allowed_origin(client):
    response = client.options(
        "/auth/login",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,authorization",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ORIGIN
    # Browsers read expose-headers from the real response, not from the preflight.
    actual = client.get("/health", headers={"Origin": ORIGIN})
    assert actual.headers["access-control-allow-origin"] == ORIGIN
    assert "Retry-After" in actual.headers["access-control-expose-headers"]


def test_cors_other_origin_refused(client):
    response = client.options(
        "/auth/login",
        headers={"Origin": "http://evil.test", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in response.headers
    assert "access-control-allow-origin" not in client.get("/health", headers={"Origin": "http://evil.test"}).headers


def test_cors_origins_come_from_a_comma_separated_env_value(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "http://a.test, http://b.test")
    assert Settings().CORS_ORIGINS == ["http://a.test", "http://b.test"]
    assert settings.CORS_ORIGINS == ["http://localhost:8081", "http://127.0.0.1:8081"]


# --- Error envelope ---------------------------------------------------------


def test_validation_error_envelope_no_echo(client):
    response = client.post("/auth/register", json=register_payload(password="short", confirm_password="short"))
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "validation_error"
    assert detail["message"]
    assert detail["fields"][0]["field"] == "password"
    assert set(detail["fields"][0]) == {"field", "message"}
    assert "short" not in response.text


def test_password_mismatch_is_reported_on_confirm_password(client):
    mismatch = client.post("/auth/register", json=register_payload(confirm_password="other-password-1"))
    assert mismatch.status_code == 422
    detail = mismatch.json()["detail"]
    assert detail["code"] == "validation_error"
    assert detail["fields"] == [{"field": "confirm_password", "message": "Passwords do not match"}]

    # a password that already fails its own check gets no extra mismatch error
    weak = client.post("/auth/register", json=register_payload(password="short", confirm_password="other"))
    assert [f["field"] for f in weak.json()["detail"]["fields"]] == ["password"]

    reset = client.post(
        "/auth/reset",
        json={"reset_token": "t", "new_password": "brand-new-password-1", "confirm_password": "other-password-1"},
    )
    assert reset.status_code == 422
    assert reset.json()["detail"]["code"] == "validation_error"
    assert reset.json()["detail"]["fields"] == [{"field": "confirm_password", "message": "Passwords do not match"}]


def test_not_found_envelope(client):
    response = client.get("/nope")
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert detail["code"] == "not_found" and detail["message"]


def test_method_not_allowed_envelope(client):
    response = client.delete("/health")
    assert response.status_code == 405
    assert response.json()["detail"]["code"] == "method_not_allowed"
    assert "GET" in response.headers["allow"]


def test_unhandled_error_is_json_internal_error(monkeypatch):
    def boom(*_args, **_kwargs):
        raise RuntimeError("secret detail")

    monkeypatch.setattr(group_service, "list_spaces", boom)
    with TestClient(fastapi_app, raise_server_exceptions=False) as quiet_client:
        tokens = register(quiet_client, "alice")
        response = quiet_client.get("/spaces", headers=auth(tokens))
    assert response.status_code == 500
    assert response.json()["detail"]["code"] == "internal_error"
    assert "secret detail" not in response.text


def test_oversized_ids_are_422_not_500(client):
    headers = auth(register(client, "alice"))
    for response in (
        client.get(f"/spaces/{HUGE_ID}", headers=headers),
        client.get("/notifications", params={"before": HUGE_ID}, headers=headers),
        client.patch(f"/notifications/{HUGE_ID}", json={"read": True}, headers=headers),
    ):
        assert response.status_code == 422, response.text
        assert response.json()["detail"]["code"] == "validation_error"


# --- Phone ------------------------------------------------------------------


def test_phone_with_country_code_no_plus():
    assert normalize_phone("91 98765 43210") == "+919876543210"
    assert normalize_phone("9876543210") == "+919876543210"
    assert normalize_phone("09876543210") == "+919876543210"
    assert normalize_phone("9198765432") == "+919198765432"  # a 10-digit national number that starts with 91


# --- OTP --------------------------------------------------------------------


def test_otp_attempts_counted_atomically(tmp_path):
    """Every thread reads the code row before any of them writes: the worst case for a counter
    that is read, added to in Python and written back (all 8 would write attempts=1)."""
    engine = make_engine(f"sqlite:///{(tmp_path / 'otp.db').as_posix()}")
    Base.metadata.create_all(engine)
    phone = "+919876543210"
    with Session(engine) as db:
        db.add(User(username="alice", name="Alice", phone=phone, password_hash="x"))
        db.flush()  # the user row first: the reset row has a foreign key to it
        db.add(
            PasswordReset(
                phone=phone,
                username="alice",
                code_hash=security.hash_otp(phone, "123456"),
                expires_at=utcnow() + timedelta(minutes=5),
            )
        )
        db.commit()

    threads = 8
    barrier = threading.Barrier(threads, timeout=10)
    first_read = threading.local()

    @event.listens_for(engine, "after_cursor_execute")
    def wait_for_everyone_to_read(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT") and not getattr(first_read, "done", True):
            first_read.done = True
            barrier.wait()

    def wrong_guess(_) -> str:
        first_read.done = False
        with Session(engine) as db:
            with pytest.raises(HTTPException) as caught:
                auth_service.verify_reset_otp(db, phone, "000000")
        return caught.value.detail["code"]

    with ThreadPoolExecutor(threads) as pool:
        assert list(pool.map(wrong_guess, range(threads))) == ["invalid_code"] * threads

    with Session(engine) as db:
        row = db.scalars(select(PasswordReset)).one()
        assert row.attempts == min(threads, settings.OTP_MAX_ATTEMPTS)
        with pytest.raises(HTTPException) as caught:  # the right code is refused: the code is dead
            auth_service.verify_reset_otp(db, phone, "123456")
        assert caught.value.detail["code"] == "invalid_code"
    engine.dispose()


# --- Example env ------------------------------------------------------------


def test_env_example_debug_false():
    env_example = Path(__file__).resolve().parents[1] / ".env.example"
    assert "DEBUG=false" in env_example.read_text(encoding="utf-8").splitlines()
