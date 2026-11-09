"""Rate limits (Phase 2, tasks 2.1, 2.2 and 2.5): the limiter, the client address, and each limited endpoint."""

import logging
from datetime import timedelta

from sqlalchemy import select
from starlette.requests import Request

from app.config import settings
from app.database import SessionLocal
from app.models.login_attempt import LoginAttempt
from app.models.password_reset import PasswordReset
from app.utils.rate_limit import SlidingWindowLimiter, client_ip
from tests.helpers import PHONES, auth, db_all, error_code, register, register_payload

# --- The limiter -------------------------------------------------------------


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_limiter_allows_the_limit_then_says_how_long_to_wait():
    clock = Clock()
    limiter = SlidingWindowLimiter(clock=clock)
    assert [limiter.hit("k", 3, 60) for _ in range(3)] == [0, 0, 0]
    clock.now += 10
    assert limiter.hit("k", 3, 60) == 50  # the first hit leaves the window 60 s after it was made


def test_limiter_window_slides_and_blocked_hits_do_not_extend_it():
    clock = Clock()
    limiter = SlidingWindowLimiter(clock=clock)
    assert limiter.hit("k", 2, 60) == 0  # t=0
    clock.now += 30
    assert limiter.hit("k", 2, 60) == 0  # t=30
    clock.now += 29
    assert limiter.hit("k", 2, 60) == 1  # t=59: blocked, 1 s until the t=0 hit expires
    clock.now += 2
    assert limiter.hit("k", 2, 60) == 0  # t=61: the t=0 hit is gone, and the blocked hit left no trace
    assert limiter.hit("k", 2, 60) > 0  # the hits at t=30 and t=61 are both still inside the window


def test_limiter_keys_are_independent():
    limiter = SlidingWindowLimiter(clock=Clock())
    assert limiter.hit("a", 1, 60) == 0
    assert limiter.hit("a", 1, 60) > 0
    assert limiter.hit("b", 1, 60) == 0


def test_limiter_memory_stays_bounded():
    clock = Clock()
    limiter = SlidingWindowLimiter(max_keys=5, clock=clock)
    for i in range(5):
        limiter.hit(f"old{i}", 1, 60)
    clock.now += 61  # all five windows are over: they are dropped when the table is full
    limiter.hit("new", 1, 60)
    assert len(limiter._buckets) == 1

    for i in range(20):  # a flood of fresh keys inside one window cannot grow the table past its limit
        limiter.hit(f"flood{i}", 1, 60)
    assert len(limiter._buckets) <= 5


# --- The client address ------------------------------------------------------


def make_request(peer: str = "203.0.113.9", forwarded: str | None = None) -> Request:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded else []
    return Request({"type": "http", "headers": headers, "client": (peer, 5000)})


def test_client_address_is_the_socket_peer_when_no_proxy_is_trusted():
    assert client_ip(make_request(forwarded="6.6.6.6")) == "203.0.113.9"  # the header is ignored


def test_client_address_behind_one_trusted_proxy(monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_COUNT", 1)
    # The client wrote the first entry; the trusted proxy appended the address it actually saw.
    assert client_ip(make_request(forwarded="6.6.6.6, 198.51.100.7")) == "198.51.100.7"


def test_client_address_behind_two_trusted_proxies(monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_COUNT", 2)
    assert client_ip(make_request(forwarded="6.6.6.6, 198.51.100.7, 10.0.0.2")) == "198.51.100.7"


def test_client_address_falls_back_to_the_peer_when_the_header_is_short(monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_COUNT", 2)
    assert client_ip(make_request(forwarded="198.51.100.7")) == "203.0.113.9"
    assert client_ip(make_request()) == "203.0.113.9"


# --- Sign up (2.1) -----------------------------------------------------------


def test_register_is_limited_per_address_and_failed_attempts_count(client, monkeypatch):
    """Probing for taken usernames and phones is exactly what the limit is for, so a 409 uses the budget too."""
    monkeypatch.setattr(settings, "REGISTER_MAX_PER_IP_PER_HOUR", 3)
    register(client, "alice")
    taken_username = client.post("/auth/register", json=register_payload(username="alice", phone=PHONES["bob"]))
    taken_phone = client.post("/auth/register", json=register_payload(username="bob", phone=PHONES["alice"]))
    assert (taken_username.status_code, taken_phone.status_code) == (409, 409)

    blocked = client.post("/auth/register", json=register_payload(username="carol", phone=PHONES["carol"]))
    assert blocked.status_code == 429 and error_code(blocked) == "too_many_requests"
    assert int(blocked.headers["Retry-After"]) > 0
    assert blocked.json()["detail"]["retry_after_seconds"] == int(blocked.headers["Retry-After"])


def test_each_address_has_its_own_budget_behind_a_trusted_proxy(client, monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_COUNT", 1)
    monkeypatch.setattr(settings, "REGISTER_MAX_PER_IP_PER_HOUR", 1)

    def sign_up(username: str, address: str):
        return client.post(
            "/auth/register",
            json=register_payload(username=username, phone=PHONES[username]),
            headers={"X-Forwarded-For": address},
        )

    assert sign_up("alice", "198.51.100.1").status_code == 201
    assert sign_up("bob", "198.51.100.1").status_code == 429
    assert sign_up("bob", "198.51.100.2").status_code == 201


def test_a_forged_forwarded_header_does_not_dodge_the_limit(client, monkeypatch):
    monkeypatch.setattr(settings, "REGISTER_MAX_PER_IP_PER_HOUR", 1)  # no trusted proxy configured
    first = client.post(
        "/auth/register", json=register_payload(), headers={"X-Forwarded-For": "198.51.100.1"}
    )
    second = client.post(
        "/auth/register",
        json=register_payload(username="bob", phone=PHONES["bob"]),
        headers={"X-Forwarded-For": "198.51.100.2"},
    )
    assert first.status_code == 201 and second.status_code == 429


# --- Search (2.1) ------------------------------------------------------------


def search(client, tokens, q):
    return client.get("/users/search", params={"q": q}, headers=auth(tokens))


def test_search_is_limited_per_user(client, monkeypatch):
    monkeypatch.setattr(settings, "SEARCH_MAX_PER_USER_PER_MINUTE", 3)
    alice, bob = register(client, "alice"), register(client, "bob")
    assert [search(client, alice, "zz").status_code for _ in range(3)] == [200, 200, 200]
    blocked = search(client, alice, "zz")
    assert blocked.status_code == 429 and error_code(blocked) == "too_many_requests"
    assert int(blocked.headers["Retry-After"]) > 0
    assert search(client, bob, "zz").status_code == 200  # someone else's budget is untouched


def test_search_is_limited_per_address(client, monkeypatch):
    monkeypatch.setattr(settings, "SEARCH_MAX_PER_IP_PER_MINUTE", 2)
    alice, bob = register(client, "alice"), register(client, "bob")
    assert search(client, alice, "zz").status_code == 200
    assert search(client, bob, "zz").status_code == 200
    assert search(client, alice, "zz").status_code == 429  # a third person on the same address is stopped too


def test_looking_people_up_by_phone_number_has_its_own_tight_limit(client, monkeypatch):
    monkeypatch.setattr(settings, "PHONE_LOOKUPS_PER_USER_PER_HOUR", 2)
    alice = register(client, "alice")
    register(client, "bob")
    assert search(client, alice, PHONES["bob"]).status_code == 200  # found
    assert search(client, alice, "9000000001").status_code == 200  # nobody: still counts
    blocked = search(client, alice, "9000000002")
    assert blocked.status_code == 429 and error_code(blocked) == "too_many_requests"
    assert "phone" in blocked.json()["detail"]["message"]
    assert search(client, alice, "bo").status_code == 200  # looking people up by name is not affected


# --- Forgot password and codes (2.2) ----------------------------------------


def forgot(client, phone):
    return client.post("/auth/forgot", json={"phone": phone})


def test_forgot_is_limited_per_address_across_phone_numbers(client, sms_outbox, monkeypatch):
    monkeypatch.setattr(settings, "FORGOT_MAX_PER_IP_PER_HOUR", 2)
    register(client, "alice")
    assert forgot(client, PHONES["alice"]).status_code == 202
    assert forgot(client, "9000000001").status_code == 202
    blocked = forgot(client, "9000000002")
    assert blocked.status_code == 429 and error_code(blocked) == "too_many_requests"
    assert len(db_all(select(PasswordReset))) == 2  # no code was created for the blocked request
    assert len(sms_outbox) == 1  # only alice's number is registered


def test_verify_otp_is_limited_per_address(client, monkeypatch):
    monkeypatch.setattr(settings, "VERIFY_OTP_MAX_PER_IP_PER_HOUR", 3)
    for _ in range(3):
        wrong = client.post("/auth/verify-otp", json={"phone": PHONES["alice"], "code": "123456"})
        assert wrong.status_code == 400
    blocked = client.post("/auth/verify-otp", json={"phone": PHONES["alice"], "code": "123456"})
    assert blocked.status_code == 429 and error_code(blocked) == "too_many_requests"


def move_requests_back(days: int) -> None:
    with SessionLocal() as session:
        for row in session.scalars(select(PasswordReset)):
            row.created_at -= timedelta(days=days)
        session.commit()


def test_daily_code_cap_stops_every_number_alike_and_resets_the_next_day(client, sms_outbox, monkeypatch):
    monkeypatch.setattr(settings, "SMS_DAILY_CAP", 2)
    for name in ("alice", "bob", "carol"):
        register(client, name)
    assert forgot(client, PHONES["alice"]).status_code == 202
    assert forgot(client, PHONES["bob"]).status_code == 202

    registered = forgot(client, PHONES["carol"])
    unknown = forgot(client, "9000000009")
    for capped in (registered, unknown):  # the answer does not depend on whether the number is registered
        assert capped.status_code == 429 and error_code(capped) == "too_many_requests"
        assert int(capped.headers["Retry-After"]) > 0
    assert len(sms_outbox) == 2

    move_requests_back(1)  # a new UTC day
    assert forgot(client, PHONES["carol"]).status_code == 202
    assert len(sms_outbox) == 3


def test_daily_code_cap_warns_at_80_percent_and_logs_when_reached(client, sms_outbox, monkeypatch, caplog):
    monkeypatch.setattr(settings, "SMS_DAILY_CAP", 5)
    with caplog.at_level(logging.WARNING, logger="app.services.auth_service"):
        for i in range(1, 5):
            assert forgot(client, f"900000000{i}").status_code == 202
        assert "Daily code cap: 4 of 5 used" in caplog.text
        assert forgot(client, "9000000005").status_code == 202
        assert forgot(client, "9000000006").status_code == 429
        assert "Daily code cap of 5 reached" in caplog.text


# --- Sign in (2.5) -----------------------------------------------------------


def login(client, username, password="password123"):
    return client.post("/auth/login", json={"username": username, "password": password})


def test_sign_in_is_limited_per_address_across_usernames(client, monkeypatch):
    monkeypatch.setattr(settings, "LOGIN_MAX_PER_IP", 3)
    register(client, "alice")
    assert [login(client, name, "wrong-password-1").status_code for name in ("g1", "g2", "g3")] == [401] * 3

    blocked = login(client, "alice")  # even the right password, from an address that has used its budget
    assert blocked.status_code == 429 and error_code(blocked) == "too_many_attempts"
    assert int(blocked.headers["Retry-After"]) > 0
    assert len(db_all(select(LoginAttempt))) == 3  # the blocked request never reached the lockout counter


def test_a_locked_account_answers_the_same_whether_or_not_it_exists(client):
    register(client, "alice")
    replies = []
    for name in ("alice", "ghost"):
        for _ in range(settings.LOGIN_MAX_ATTEMPTS):
            assert login(client, name, "wrong-password-1").status_code == 401
        replies.append(login(client, name, "wrong-password-1"))
    known, unknown = (reply.json()["detail"] for reply in replies)
    assert [reply.status_code for reply in replies] == [429, 429]
    assert known["code"] == unknown["code"] == "too_many_attempts"
    assert known["message"] == unknown["message"]


def test_refused_attempts_do_not_keep_a_lockout_going(client):
    register(client, "alice")
    for _ in range(settings.LOGIN_MAX_ATTEMPTS + 3):
        login(client, "alice", "wrong-password-1")
    assert len(db_all(select(LoginAttempt))) == settings.LOGIN_MAX_ATTEMPTS
