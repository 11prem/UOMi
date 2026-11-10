"""Phase 2 security hardening: production settings, tokens and keys, refresh-token reuse, races, headers, logs."""

import asyncio
import hashlib
import hmac
import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path

import jwt
import pytest
from fastapi import BackgroundTasks, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import event, select
from sqlalchemy.orm import Session
from starlette.requests import ClientDisconnect

from app.config import Settings, check_production_settings, settings
from app.database import Base, SessionLocal, make_engine, utcnow
from app.main import create_app
from app.models.login_attempt import LoginAttempt
from app.models.password_reset import PasswordReset
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.schemas.user import RegisterRequest
from app.services import auth_service, otp_service, session_service, user_service
from app.utils import security
from app.utils.log_redaction import RedactQueryFilter, install_access_log_redaction, redact
from app.utils.middleware import SafeErrorsMiddleware
from tests.helpers import PHONES, auth, db_all, error_code, register, register_payload

GOOD_SECRET = "0123456789abcdef" * 4  # obviously fake: a test fixture, not a key
GOOD_OTP_KEY = "fedcba9876543210" * 4  # obviously fake: a test fixture, not a key
ORIGIN = "http://localhost:8081"
PHONE = "+919876543210"


# --- Settings: production checks (2.3), CORS (2.10), bcrypt floor and key rules (2.7) ---------------


def production_settings(**overrides) -> Settings:
    values = dict(
        ENVIRONMENT="production",
        DEBUG=False,
        SMS_BACKEND="a-real-provider",
        SECRET_KEY=GOOD_SECRET,
        OTP_HMAC_KEY=GOOD_OTP_KEY,
        BCRYPT_ROUNDS=12,
        CORS_ORIGINS=[],
    )
    values.update(overrides)
    return Settings(_env_file=None, **values)  # _env_file=None: a developer's own .env must not change the test


def test_safe_production_settings_have_no_problems():
    safe = production_settings()
    assert safe.production_problems() == []
    check_production_settings(safe)  # does not raise


@pytest.mark.parametrize(
    ("overrides", "fragment"),
    [
        ({"DEBUG": True}, "DEBUG"),
        ({"SMS_BACKEND": "console"}, "SMS_BACKEND"),
        ({"SECRET_KEY": "test-secret-key-0123456789-0123456789"}, "SECRET_KEY looks like a placeholder"),
        ({"SECRET_KEY": "a" * 40}, "SECRET_KEY uses too few different characters"),
        ({"OTP_HMAC_KEY": ""}, "OTP_HMAC_KEY is not set"),
        ({"OTP_HMAC_KEY": GOOD_SECRET}, "OTP_HMAC_KEY must differ"),
        ({"OTP_HMAC_KEY": "b" * 40}, "OTP_HMAC_KEY uses too few"),
        ({"CORS_ORIGINS": ["*"]}, "CORS_ORIGINS"),
        ({"CORS_ORIGINS": ["http://app.uomi.test"]}, "CORS_ORIGINS"),
    ],
)
def test_each_unsafe_production_setting_is_reported(overrides, fragment):
    problems = production_settings(**overrides).production_problems()
    assert any(fragment in problem for problem in problems), problems


def test_exact_https_origins_are_allowed_in_production():
    assert production_settings(CORS_ORIGINS=["https://app.uomi.test"]).production_problems() == []


def test_refusing_to_start_lists_every_problem_at_once():
    unsafe = production_settings(DEBUG=True, SMS_BACKEND="console", OTP_HMAC_KEY="")
    with pytest.raises(RuntimeError) as caught:
        check_production_settings(unsafe)
    message = str(caught.value)
    assert message.startswith("Refusing to start with ENVIRONMENT=production")
    assert "DEBUG" in message and "SMS_BACKEND" in message and "OTP_HMAC_KEY" in message


def test_other_environments_are_never_refused():
    relaxed = Settings(
        _env_file=None, ENVIRONMENT="development", DEBUG=True, SMS_BACKEND="console", BCRYPT_ROUNDS=12
    )
    check_production_settings(relaxed)  # development may use the console SMS backend and debug mode


def test_cors_origins_default_to_nothing_in_production(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    assert Settings(_env_file=None, ENVIRONMENT="production", BCRYPT_ROUNDS=12).CORS_ORIGINS == []
    chosen = ["https://app.uomi.test"]
    assert Settings(_env_file=None, ENVIRONMENT="production", BCRYPT_ROUNDS=12, CORS_ORIGINS=chosen).CORS_ORIGINS == chosen
    development = Settings(_env_file=None, ENVIRONMENT="development", BCRYPT_ROUNDS=12)
    assert development.CORS_ORIGINS == [ORIGIN, "http://127.0.0.1:8081"]  # the Expo web dev server, outside production


def test_bcrypt_rounds_have_a_floor_outside_the_test_environment():
    for environment in ("development", "staging", "production"):
        with pytest.raises(ValidationError, match="BCRYPT_ROUNDS"):
            Settings(_env_file=None, ENVIRONMENT=environment, BCRYPT_ROUNDS=8)
    assert Settings(_env_file=None, ENVIRONMENT="development", BCRYPT_ROUNDS=12).BCRYPT_ROUNDS == 12
    assert Settings(_env_file=None, ENVIRONMENT="test", BCRYPT_ROUNDS=4).BCRYPT_ROUNDS == 4


def test_a_short_otp_key_is_refused():
    with pytest.raises(ValidationError, match="OTP_HMAC_KEY"):
        Settings(_env_file=None, OTP_HMAC_KEY="too-short")


def use_production_settings(monkeypatch) -> None:
    for name, value in dict(
        ENVIRONMENT="production",
        DEBUG=False,
        SMS_BACKEND="a-real-provider",
        SECRET_KEY=GOOD_SECRET,
        OTP_HMAC_KEY=GOOD_OTP_KEY,
        CORS_ORIGINS=[],
    ).items():
        monkeypatch.setattr(settings, name, value)


def test_the_api_will_not_start_in_production_with_unsafe_settings(monkeypatch):
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")  # the console SMS backend and the test key remain
    with pytest.raises(RuntimeError, match="Refusing to start"):
        create_app()


def test_production_has_no_docs_pages_and_other_environments_do(client, monkeypatch):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 200, path

    use_production_settings(monkeypatch)
    with TestClient(create_app()) as production:
        assert production.get("/health").status_code == 200
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert production.get(path).status_code == 404, path


# --- Tokens (2.7) ------------------------------------------------------------


def good_claims(session_id: str) -> dict:
    now = utcnow()
    return {
        "iss": settings.JWT_ISSUER,
        "aud": settings.JWT_AUDIENCE,
        "sub": "alice",
        "sid": session_id,
        "purpose": "access",
        "iat": now,
        "exp": now + timedelta(minutes=5),
    }


def get_spaces(client, token: str):
    return client.get("/spaces", headers={"Authorization": f"Bearer {token}"})


def test_access_tokens_carry_issuer_and_audience_and_use_hs256(client):
    token = register(client, "alice")["access_token"]
    claims = jwt.decode(token, options={"verify_signature": False})
    assert claims["iss"] == settings.JWT_ISSUER and claims["aud"] == settings.JWT_AUDIENCE
    assert jwt.get_unverified_header(token)["alg"] == "HS256"


def test_forged_or_off_spec_tokens_are_refused(client):
    register(client, "alice")
    session_id = db_all(select(RefreshToken))[0].id
    key = settings.SECRET_KEY

    assert get_spaces(client, jwt.encode(good_claims(session_id), key, algorithm="HS256")).status_code == 200  # control

    missing_aud = {k: v for k, v in good_claims(session_id).items() if k != "aud"}
    missing_iss = {k: v for k, v in good_claims(session_id).items() if k != "iss"}
    bad_tokens = {
        "wrong audience": jwt.encode({**good_claims(session_id), "aud": "someone-else"}, key, algorithm="HS256"),
        "wrong issuer": jwt.encode({**good_claims(session_id), "iss": "someone-else"}, key, algorithm="HS256"),
        "no audience": jwt.encode(missing_aud, key, algorithm="HS256"),
        "no issuer": jwt.encode(missing_iss, key, algorithm="HS256"),
        "another algorithm": jwt.encode(good_claims(session_id), key, algorithm="HS512"),
        "no signature": jwt.encode(good_claims(session_id), None, algorithm="none"),
        "another key": jwt.encode(good_claims(session_id), "x" * 40, algorithm="HS256"),
    }
    for reason, token in bad_tokens.items():
        response = get_spaces(client, token)
        assert response.status_code == 401 and error_code(response) == "invalid_token", reason


def test_the_texted_code_hash_uses_the_otp_key_not_the_signing_key(monkeypatch):
    message = f"otp:{PHONE}:123456".encode()
    old_scheme = hmac.new(settings.SECRET_KEY.encode(), message, hashlib.sha256).hexdigest()

    assert security.hash_otp(PHONE, "123456") != old_scheme  # even with no OTP key set, the key is separate

    monkeypatch.setattr(settings, "OTP_HMAC_KEY", GOOD_OTP_KEY)
    expected = hmac.new(GOOD_OTP_KEY.encode(), message, hashlib.sha256).hexdigest()
    assert security.hash_otp(PHONE, "123456") == expected != old_scheme


def test_a_code_texted_under_one_otp_key_is_refused_under_another(client, sms_outbox, monkeypatch):
    def texted_code() -> str:
        return re.search(r"\b(\d{6})\b", sms_outbox[-1][1]).group(1)

    register(client, "alice")
    register(client, "bob")
    monkeypatch.setattr(settings, "OTP_HMAC_KEY", GOOD_OTP_KEY)
    alices = client.post("/auth/forgot", json={"username": "alice"})
    assert alices.status_code == 202
    alices_code = texted_code()

    monkeypatch.setattr(settings, "OTP_HMAC_KEY", "9" * 12 + GOOD_SECRET[:40])  # the key is rotated
    refused = client.post("/auth/verify-otp", json={"reset_id": alices.json()["reset_id"], "code": alices_code})
    assert refused.status_code == 400 and error_code(refused) == "invalid_code"

    # control: a code texted under the new key is accepted, so the refusal above was about the key
    bobs = client.post("/auth/forgot", json={"username": "bob"})
    assert bobs.status_code == 202
    accepted = client.post("/auth/verify-otp", json={"reset_id": bobs.json()["reset_id"], "code": texted_code()})
    assert accepted.status_code == 200


# --- Refresh-token reuse (2.4) ----------------------------------------------


def refresh(client, token: str):
    return client.post("/auth/refresh", json={"refresh_token": token})


def test_replaying_a_swapped_out_refresh_token_ends_the_session(client):
    first = register(client, "alice")
    second = refresh(client, first["refresh_token"]).json()
    assert get_spaces(client, second["access_token"]).status_code == 200

    replay = refresh(client, first["refresh_token"])  # someone kept a copy of the old token
    assert replay.status_code == 401 and error_code(replay) == "invalid_refresh_token"

    # the session is over for both copies: the new tokens stop working too, so the owner signs in again
    ended = get_spaces(client, second["access_token"])
    assert ended.status_code == 401 and error_code(ended) == "session_expired"
    assert refresh(client, second["refresh_token"]).status_code == 401
    assert db_all(select(RefreshToken)) == []


def test_a_replay_looks_exactly_like_any_unknown_token(client):
    first = register(client, "alice")
    refresh(client, first["refresh_token"])
    replay = refresh(client, first["refresh_token"])
    unknown = refresh(client, "a-token-nobody-ever-issued")
    assert replay.status_code == unknown.status_code == 401
    assert replay.json() == unknown.json()  # an attacker is not told that the replay was noticed


def test_an_unknown_token_does_not_end_anyones_session(client):
    tokens = register(client, "alice")
    assert refresh(client, "a-token-nobody-ever-issued").status_code == 401
    assert get_spaces(client, tokens["access_token"]).status_code == 200


def test_other_devices_keep_their_sessions_when_one_session_is_ended_for_reuse(client):
    first = register(client, "alice")
    other_device = client.post("/auth/login", json={"username": "alice", "password": "password123"}).json()
    refresh(client, first["refresh_token"])
    refresh(client, first["refresh_token"])  # the replay ends only the session it belongs to
    assert get_spaces(client, other_device["access_token"]).status_code == 200


@pytest.fixture
def file_engine(tmp_path):
    """A real SQLite file, so that threads use separate connections (the in-memory test database shares one)."""
    engine = make_engine(f"sqlite:///{(tmp_path / 'race.db').as_posix()}")
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


def add_user(engine, username: str = "alice", phone: str = PHONE) -> None:
    with Session(engine) as db:
        db.add(User(username=username, name=username.capitalize(), phone=phone, password_hash=security.hash_password("old-password-1")))
        db.commit()


def run_in_parallel(engine, count: int, work):
    """Run work(session) in `count` threads. Every thread finishes its first SELECT before any of them writes:
    the worst case for code that reads, decides in Python and then writes."""
    barrier = threading.Barrier(count, timeout=10)
    first_read = threading.local()

    @event.listens_for(engine, "after_cursor_execute")
    def wait_for_everyone_to_read(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT") and not getattr(first_read, "done", True):
            first_read.done = True
            barrier.wait()

    def runner(_):
        first_read.done = False
        with Session(engine) as db:
            try:
                return "ok", work(db)
            except HTTPException as exc:
                return "error", exc.detail["code"]

    with ThreadPoolExecutor(count) as pool:
        return list(pool.map(runner, range(count)))


def test_two_parallel_refreshes_with_one_token_cannot_both_succeed(file_engine):
    add_user(file_engine)
    with Session(file_engine) as db:
        tokens = session_service.create_session(db, "alice")
        db.commit()

    results = run_in_parallel(file_engine, 2, lambda db: session_service.refresh_session(db, tokens.refresh_token))

    assert sorted(kind for kind, _ in results) == ["error", "ok"]
    assert [value for kind, value in results if kind == "error"] == ["invalid_refresh_token"]
    with Session(file_engine) as db:  # the loser counts as a reuse, so the session is over
        assert db.scalars(select(RefreshToken)).all() == []


# --- Reset token: used exactly once (2.7) -----------------------------------


def test_a_reset_token_cannot_be_used_twice_at_the_same_moment(file_engine):
    add_user(file_engine)
    now = utcnow()
    token = "reset-token-for-the-race"
    with Session(file_engine) as db:
        db.add(
            PasswordReset(
                phone=PHONE,
                username="alice",
                code_hash="0" * 64,
                expires_at=now + timedelta(minutes=5),
                verified_at=now,
                reset_token_hash=security.hash_token(token),
                reset_expires_at=now + timedelta(minutes=5),
            )
        )
        db.commit()

    results = run_in_parallel(file_engine, 2, lambda db: auth_service.reset_password(db, token, "brand-new-password-1"))

    assert sorted(kind for kind, _ in results) == ["error", "ok"]
    assert [value for kind, value in results if kind == "error"] == ["reset_session_expired"]


# --- Sign-in lockout (2.5) ---------------------------------------------------


def test_the_attempt_is_committed_before_the_password_is_checked(file_engine, monkeypatch):
    add_user(file_engine)
    seen = []
    real_verify = security.verify_password

    def spy(password, password_hash):
        with Session(file_engine) as other:  # another connection sees only what has been committed
            seen.append(len(other.scalars(select(LoginAttempt)).all()))
        return real_verify(password, password_hash)

    monkeypatch.setattr(security, "verify_password", spy)
    with Session(file_engine) as db, pytest.raises(HTTPException):
        auth_service.login(db, "alice", "wrong-password-1")
    assert seen == [1]


def test_a_burst_of_parallel_guesses_cannot_get_past_the_lockout(file_engine):
    """A regression guard, not a proof: SQLite lets one writer at a time in, which hides the race the old code
    had on PostgreSQL (there, parallel requests all read "0 attempts" while the first was still hashing).
    The proof that the race is closed is the test above: the attempt is committed before the password check."""
    guesses = 12
    start = threading.Barrier(guesses, timeout=10)

    def guess(_) -> str:
        start.wait()
        with Session(file_engine) as db:
            try:
                auth_service.login(db, "ghost", "wrong-password-1")
                return "ok"
            except HTTPException as exc:
                return exc.detail["code"]

    with ThreadPoolExecutor(guesses) as pool:
        outcomes = list(pool.map(guess, range(guesses)))

    reached_the_password_check = outcomes.count("invalid_credentials")
    assert reached_the_password_check <= settings.LOGIN_MAX_ATTEMPTS  # however many arrive at once
    assert reached_the_password_check + outcomes.count("too_many_attempts") == guesses
    with Session(file_engine) as db:  # refused attempts were taken back out: only real guesses remain
        assert len(db.scalars(select(LoginAttempt)).all()) == reached_the_password_check


# --- Errors, CORS and headers (2.8) -----------------------------------------


def boom(*_args, **_kwargs):
    raise RuntimeError("secret detail")


def test_a_crash_is_a_json_500_that_still_carries_the_cors_headers(client, monkeypatch):
    monkeypatch.setattr(user_service, "search_users", boom)
    tokens = register(client, "alice")
    response = client.get("/users/search", params={"q": "bob"}, headers={**auth(tokens), "Origin": ORIGIN})
    assert response.status_code == 500
    assert response.json()["detail"]["code"] == "internal_error"
    assert "secret detail" not in response.text
    assert response.headers["access-control-allow-origin"] == ORIGIN  # a browser can read the real error


def test_a_crash_is_logged_without_the_query_string(client, monkeypatch, caplog):
    monkeypatch.setattr(user_service, "search_users", boom)
    tokens = register(client, "alice")
    with caplog.at_level(logging.ERROR, logger="uomi.errors"):
        response = client.get("/users/search", params={"q": "9876543211"}, headers=auth(tokens))
    assert response.status_code == 500
    assert "Unhandled error on GET /users/search" in caplog.text
    assert "9876543211" not in caplog.text  # the search term can be a phone number


def test_responses_to_signed_in_requests_and_sign_in_are_never_cached(client):
    tokens = register(client, "alice")
    assert client.get("/spaces", headers=auth(tokens)).headers["cache-control"] == "no-store"
    assert client.get("/spaces", headers={"Authorization": "Bearer nonsense"}).headers["cache-control"] == "no-store"
    signed_in = client.post("/auth/login", json={"username": "alice", "password": "password123"})
    assert signed_in.headers["cache-control"] == "no-store"  # the body holds the tokens
    assert "cache-control" not in client.get("/health").headers


def test_hsts_is_sent_in_production_only(client, monkeypatch):
    assert "strict-transport-security" not in client.get("/health").headers
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    header = client.get("/health").headers["strict-transport-security"]
    assert "max-age=" in header and "includeSubDomains" in header


# --- Dependencies (2.9) ------------------------------------------------------


def requirement_lines() -> list[str]:
    text = (Path(__file__).resolve().parents[1] / "requirements.txt").read_text(encoding="utf-8")
    lines = (line.split("#", 1)[0].strip() for line in text.splitlines())
    return [line for line in lines if line]


def test_every_requirement_is_pinned_to_an_exact_version():
    unpinned = [line for line in requirement_lines() if not re.fullmatch(r"[A-Za-z0-9_.\-\[\]]+==[0-9][A-Za-z0-9_.+!\-]*", line)]
    assert unpinned == [], f"pin these with ==: {unpinned}"


def test_pydantic_settings_is_new_enough_for_nodecode():
    pinned = next(line for line in requirement_lines() if line.lower().startswith("pydantic-settings=="))
    major, minor, *_ = (int(part) for part in pinned.split("==")[1].split("."))
    assert (major, minor) >= (2, 7)


# --- Access log (2.8) --------------------------------------------------------


def test_search_terms_are_redacted_from_log_lines():
    assert redact("GET /users/search?q=9876543210 HTTP/1.1") == "GET /users/search?q=[redacted] HTTP/1.1"
    assert redact("/users/search?limit=5&q=%2B919876543210&x=1") == "/users/search?limit=5&q=[redacted]&x=1"
    assert redact("/spaces/12?sort=new") == "/spaces/12?sort=new"
    assert redact("/x?email=a%40b.test&refresh_token=abc&limit=5") == "/x?email=[redacted]&refresh_token=[redacted]&limit=5"


def test_the_access_log_filter_rewrites_uvicorn_records():
    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        0,
        '%s - "%s %s HTTP/%s" %d',
        ("10.0.0.1:5000", "GET", "/users/search?q=9876543210", "1.1", 200),
        None,
    )
    assert RedactQueryFilter().filter(record) is True
    assert "9876543210" not in record.getMessage()
    assert "q=[redacted]" in record.getMessage()
    assert record.args[-1] == 200  # non-text arguments are left alone


def test_the_access_log_filter_also_handles_gunicorns_named_arguments():
    """Under gunicorn (with uvicorn workers) gunicorn writes the access line, with %(r)s-style named atoms."""
    atoms = {"h": "10.0.0.1", "r": "GET /users/search?q=9876543210 HTTP/1.1", "s": 200}
    record = logging.LogRecord("gunicorn.access", logging.INFO, __file__, 0, '%(h)s "%(r)s" %(s)s', (atoms,), None)
    assert RedactQueryFilter().filter(record) is True
    assert "9876543210" not in record.getMessage()
    assert "q=[redacted]" in record.getMessage()


def test_the_access_log_filter_is_installed_once_on_each_access_logger():
    install_access_log_redaction()
    install_access_log_redaction()
    for name in ("uvicorn.access", "gunicorn.access"):
        filters = [f for f in logging.getLogger(name).filters if isinstance(f, RedactQueryFilter)]
        assert len(filters) == 1, name


# --- Review follow-ups ---------------------------------------------------------


def test_a_client_disconnect_is_not_turned_into_a_500_or_logged_as_an_error(caplog):
    async def disconnecting_app(scope, receive, send):
        raise ClientDisconnect()

    sent = []

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "method": "GET", "path": "/x", "headers": []}
    with caplog.at_level(logging.ERROR, logger="uomi.errors"):
        with pytest.raises(ClientDisconnect):
            asyncio.run(SafeErrorsMiddleware(disconnecting_app)(scope, None, send))
    assert sent == []  # nobody is left to answer
    assert caplog.text == ""  # and it is not a server error


def test_the_code_text_is_scheduled_after_the_reply_not_sent_during_it(client, sms_outbox):
    """A real SMS send takes hundreds of milliseconds. Sent inline, it would make the reply slower for registered
    numbers only, which tells an attacker who has an account."""
    register(client, "alice")
    sms_outbox.clear()  # the sign-up code
    registered, unknown, signing_up = BackgroundTasks(), BackgroundTasks(), BackgroundTasks()
    with SessionLocal() as db:
        auth_service.request_password_reset(db, "alice", registered)
        auth_service.request_password_reset(db, "nobody", unknown)
        auth_service.start_signup(db, RegisterRequest(**register_payload(username="bob", phone=PHONES["bob"])), signing_up)
    assert sms_outbox == []  # nothing was sent while the replies were being prepared
    assert len(registered.tasks) == 1 and unknown.tasks == [] and len(signing_up.tasks) == 1
    asyncio.run(registered())
    asyncio.run(signing_up())
    assert [phone for phone, _ in sms_outbox] == [PHONE, "+919876543211"]  # alice's reset code, bob's sign-up code


def test_a_failing_text_send_is_logged_and_never_raised(monkeypatch, caplog):
    def broken(phone, message):
        raise RuntimeError("provider down")

    monkeypatch.setattr("app.services.sms_service.send_sms", broken)
    with caplog.at_level(logging.ERROR, logger="app.services.otp_service"):
        otp_service.send_code_text(PHONE, "123456")  # does not raise
    assert "Could not send the one-time code text" in caplog.text
