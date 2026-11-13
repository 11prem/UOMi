"""Sign up with phone verification (task 1.1.1, specs § 4.3): the account exists only after the texted code."""

from datetime import timedelta

import pytest
from sqlalchemy import select, update

from app.config import settings
from app.database import Base, SessionLocal, make_engine, utcnow
from app.models.pending_signup import PendingSignup
from app.models.user import User
from app.services import auth_service
from tests.helpers import PASSWORD, PHONES, db_all, db_exec, error_code, last_code, register, register_payload, rewind, start_signup, wrong_code
from tests.test_phase2_security import run_in_parallel

PAST_COOLDOWN = settings.OTP_RESEND_COOLDOWN_SECONDS + 1


def verify(client, pending_id, code):
    return client.post("/auth/register/verify", json={"pending_id": pending_id, "code": code})


def resend(client, pending_id):
    return client.post("/auth/otp/resend", json={"id": pending_id})


def login(client, username="alice", password=PASSWORD):
    return client.post("/auth/login", json={"username": username, "password": password})


def started(client, username="alice", **kwargs) -> dict:
    response = start_signup(client, username, **kwargs)
    assert response.status_code == 202, response.text
    return response.json()


def age_signups(seconds: int) -> None:
    """Pretend the sign-ups, and the texts sent for them, happened `seconds` ago."""
    with SessionLocal() as session:
        for row in session.scalars(select(PendingSignup)):
            row.created_at -= timedelta(seconds=seconds)
            row.last_sent_at -= timedelta(seconds=seconds)
        session.commit()


@pytest.fixture
def otp_codes(monkeypatch):
    def use(*codes):
        iterator = iter(codes)
        monkeypatch.setattr("app.utils.security.generate_otp", lambda length=None: next(iterator))

    return use


# --- Step 1: Create Account texts a code and creates nothing ------------------


def test_starting_a_sign_up_texts_a_code_and_creates_no_account(client, sms_outbox):
    body = started(client)

    assert body["pending_id"].startswith("su_")
    assert body["masked_phone"] == "+91 98******10"
    assert body["expires_in_seconds"] == 300
    assert body["resend_after_seconds"] == 30
    assert [phone for phone, _ in sms_outbox] == ["+919876543210"]
    assert db_all(select(User)) == []  # no account yet
    assert login(client).status_code == 401  # a phone nobody has verified cannot sign in


def test_the_password_is_kept_only_as_a_hash_and_the_code_only_as_an_hmac(client):
    started(client)
    pending = db_all(select(PendingSignup))[0]

    assert pending.password_hash.startswith("$2") and PASSWORD not in pending.password_hash
    assert len(pending.code_hash) == 64 and last_code(PHONES["alice"]) not in pending.code_hash


def test_a_taken_username_or_phone_is_refused_before_any_text_is_sent(client, sms_outbox):
    register(client, "alice")
    sms_outbox.clear()

    username = client.post("/auth/register", json=register_payload(username="alice", phone=PHONES["bob"]))
    phone = client.post("/auth/register", json=register_payload(username="bob", phone=PHONES["alice"]))

    assert (username.status_code, error_code(username)) == (409, "username_taken")
    assert (phone.status_code, error_code(phone)) == (409, "phone_taken")
    assert username.json()["detail"]["message"] == "Username already taken"
    assert phone.json()["detail"]["message"] == "Phone number already registered"
    assert sms_outbox == []  # nothing was sent
    assert [p for p in db_all(select(PendingSignup)) if p.used_at is None] == []  # and no new sign-up was kept


def test_a_started_sign_up_reserves_nothing(client):
    """Specs § 4.3: if the user leaves before verifying, the username and phone stay free."""
    started(client, "alice")

    other = client.post("/auth/register", json=register_payload(username="alice", phone=PHONES["bob"]))
    assert other.status_code == 202  # someone else can start with the same username
    assert client.get("/auth/check-username", params={"username": "alice"}).json() == {"available": True}
    assert client.get("/auth/check-phone", params={"phone": PHONES["alice"]}).json() == {"available": True}


# --- Step 2: the right code creates the account -------------------------------


def test_the_right_code_creates_the_account_and_signs_the_user_in(client, sms_outbox):
    pending_id = started(client)["pending_id"]

    response = verify(client, pending_id, last_code(PHONES["alice"]))

    assert response.status_code == 201
    tokens = response.json()
    assert tokens["token_type"] == "bearer" and tokens["idle_timeout_seconds"] == settings.SESSION_IDLE_TIMEOUT_MINUTES * 60
    assert client.get("/users/me", headers={"Authorization": f"Bearer {tokens['access_token']}"}).json() == {
        "username": "alice", "name": "Alice", "phone": "+919876543210", "currency": "INR", "notifications_on": True,
    }
    [kept] = db_all(select(PendingSignup))  # kept for a day, because the daily text cap counts it, but used up
    assert kept.used_at is not None and kept.password_hash == ""  # and its password hash is wiped
    assert login(client).status_code == 200  # the password given at sign-up is the one that works


def test_a_code_cannot_be_used_twice(client):
    pending_id = started(client)["pending_id"]
    code = last_code(PHONES["alice"])
    assert verify(client, pending_id, code).status_code == 201

    again = verify(client, pending_id, code)

    assert again.status_code == 404 and error_code(again) == "verification_not_found"
    assert len(db_all(select(User))) == 1


def test_a_wrong_code_is_its_own_error_and_creates_nothing(client):
    pending_id = started(client)["pending_id"]

    wrong = verify(client, pending_id, wrong_code(last_code(PHONES["alice"])))

    assert wrong.status_code == 400 and error_code(wrong) == "invalid_code"
    assert wrong.json()["detail"]["message"] == "That code is incorrect"
    assert db_all(select(User)) == []


def test_five_wrong_codes_lock_the_sign_up_for_ten_minutes(client):
    pending_id = started(client)["pending_id"]
    real = last_code(PHONES["alice"])
    for _ in range(settings.OTP_MAX_ATTEMPTS - 1):
        assert error_code(verify(client, pending_id, wrong_code(real))) == "invalid_code"

    locked = verify(client, pending_id, wrong_code(real))

    assert locked.status_code == 429 and error_code(locked) == "otp_locked"
    assert locked.json()["detail"]["message"] == "Too many attempts — try again in 10 minutes"
    assert locked.json()["detail"]["retry_after_seconds"] == 600 and int(locked.headers["Retry-After"]) == 600
    assert error_code(verify(client, pending_id, real)) == "otp_locked"  # even the right code
    assert error_code(resend(client, pending_id)) == "otp_locked"
    assert db_all(select(User)) == []

    rewind(PendingSignup, settings.OTP_LOCK_MINUTES * 60 + 1)  # ten minutes pass: the code, the lock and the text age together
    expired = verify(client, pending_id, real)
    assert expired.status_code == 400 and error_code(expired) == "code_expired"  # the code lived only 5 minutes
    assert resend(client, pending_id).status_code == 200  # the lock is over, so "Resend code" works again
    assert verify(client, pending_id, last_code(PHONES["alice"])).status_code == 201


def test_an_expired_code_has_its_own_error_and_resend_fixes_it(client, otp_codes):
    otp_codes("111111", "222222")
    pending_id = started(client)["pending_id"]
    db_exec(update(PendingSignup).values(expires_at=utcnow() - timedelta(seconds=1)))

    expired = verify(client, pending_id, "111111")
    assert expired.status_code == 400 and error_code(expired) == "code_expired"
    assert expired.json()["detail"]["message"] == "Code expired — resend"

    age_signups(PAST_COOLDOWN)
    assert resend(client, pending_id).status_code == 200
    assert verify(client, pending_id, "222222").status_code == 201


def test_a_sign_up_that_ran_out_has_its_own_error_and_frees_the_username_and_phone(client):
    pending_id = started(client)["pending_id"]
    code = last_code(PHONES["alice"])
    db_exec(update(PendingSignup).values(valid_until=utcnow() - timedelta(seconds=1)))

    for response in (verify(client, pending_id, code), resend(client, pending_id)):
        assert response.status_code == 400 and error_code(response) == "verification_expired"
    assert db_all(select(User)) == []
    # nothing was held back: the same username and phone can sign up from scratch
    age_signups(PAST_COOLDOWN)
    assert register(client, "alice")["token_type"] == "bearer"


def test_an_unknown_or_foreign_id_is_not_found(client):
    started(client)
    for bad in ("su_made-up", "pw_made-up", "nonsense", "x" * 60):
        response = verify(client, bad, "123456")
        assert response.status_code == 404 and error_code(response) == "verification_not_found", bad
    reset_id = client.post("/auth/forgot", json={"username": "alice"}).json()["reset_id"]
    assert error_code(verify(client, reset_id, "123456")) == "verification_not_found"  # a reset id is not a sign-up id


def test_whoever_verifies_first_gets_the_username(client):
    first = started(client, "alice")["pending_id"]
    first_code = last_code(PHONES["alice"])
    second = client.post("/auth/register", json=register_payload(username="alice", phone=PHONES["bob"])).json()["pending_id"]
    second_code = last_code(PHONES["bob"])

    assert verify(client, first, first_code).status_code == 201
    late = verify(client, second, second_code)

    assert late.status_code == 409 and error_code(late) == "username_taken"
    assert [u.phone for u in db_all(select(User))] == ["+919876543210"]


def test_whoever_verifies_first_gets_the_phone(client, otp_codes):
    otp_codes("111111", "222222")
    first = started(client, "alice")["pending_id"]
    age_signups(PAST_COOLDOWN)  # past the cooldown, so a second sign-up may start for the same phone
    second = client.post("/auth/register", json=register_payload(username="alice2", phone=PHONES["alice"])).json()["pending_id"]

    assert verify(client, first, "111111").status_code == 201
    late = verify(client, second, "222222")

    assert late.status_code == 409 and error_code(late) == "phone_taken"
    assert [u.username for u in db_all(select(User))] == ["alice"]


# --- Resend code ---------------------------------------------------------------


def test_resend_gives_a_fresh_code_and_the_old_one_stops_working(client, sms_outbox, otp_codes):
    otp_codes("111111", "222222")
    pending_id = started(client)["pending_id"]
    age_signups(PAST_COOLDOWN)

    response = resend(client, pending_id)

    assert response.status_code == 200
    assert response.json() == {"expires_in_seconds": 300, "resend_after_seconds": 30}
    assert [phone for phone, _ in sms_outbox] == ["+919876543210"] * 2
    assert error_code(verify(client, pending_id, "111111")) == "invalid_code"
    assert verify(client, pending_id, "222222").status_code == 201


def test_resend_has_a_thirty_second_cooldown_with_its_own_error(client, sms_outbox):
    pending_id = started(client)["pending_id"]

    too_soon = resend(client, pending_id)

    assert too_soon.status_code == 429 and error_code(too_soon) == "resend_too_soon"
    assert 0 < too_soon.json()["detail"]["retry_after_seconds"] <= 30
    assert int(too_soon.headers["Retry-After"]) > 0
    assert len(sms_outbox) == 1
    age_signups(PAST_COOLDOWN)
    assert resend(client, pending_id).status_code == 200


def test_a_sign_up_gets_at_most_three_texts(client, sms_outbox):
    pending_id = started(client)["pending_id"]
    for _ in range(settings.OTP_MAX_SENDS_PER_REQUEST - 1):
        age_signups(PAST_COOLDOWN)
        assert resend(client, pending_id).status_code == 200
    age_signups(PAST_COOLDOWN)

    capped = resend(client, pending_id)

    assert capped.status_code == 429 and error_code(capped) == "too_many_requests"
    assert len(sms_outbox) == settings.OTP_MAX_SENDS_PER_REQUEST


def test_resend_starts_the_wrong_guesses_again_and_lengthens_the_sign_up(client, otp_codes):
    otp_codes("111111", "222222")
    pending_id = started(client)["pending_id"]
    for _ in range(settings.OTP_MAX_ATTEMPTS - 1):
        verify(client, pending_id, "000000")
    db_exec(update(PendingSignup).values(valid_until=utcnow() + timedelta(seconds=10)))
    age_signups(PAST_COOLDOWN)

    resend(client, pending_id)

    assert db_all(select(PendingSignup))[0].valid_until > utcnow() + timedelta(minutes=settings.OTP_FLOW_TTL_MINUTES - 1)
    assert error_code(verify(client, pending_id, "000000")) == "invalid_code"  # a fresh count, not locked
    assert verify(client, pending_id, "222222").status_code == 201


# --- Limits ---------------------------------------------------------------------


def test_the_same_phone_cannot_start_sign_ups_without_limit(client, sms_outbox):
    for n in range(settings.OTP_MAX_REQUESTS_PER_HOUR):
        assert client.post("/auth/register", json=register_payload(username=f"user{n}", phone=PHONES["alice"])).status_code == 202
        age_signups(PAST_COOLDOWN)

    blocked = client.post("/auth/register", json=register_payload(username="one.more", phone=PHONES["alice"]))

    assert blocked.status_code == 429 and error_code(blocked) == "too_many_requests"
    assert len(sms_outbox) == settings.OTP_MAX_REQUESTS_PER_HOUR


def test_asking_again_straight_away_hits_the_cooldown(client, sms_outbox):
    started(client)
    again = client.post("/auth/register", json=register_payload(username="alice2", phone=PHONES["alice"]))
    assert again.status_code == 429 and error_code(again) == "resend_too_soon"
    assert len(sms_outbox) == 1


def test_a_text_failure_does_not_fail_the_sign_up(client, monkeypatch):
    def broken(phone, message):
        raise RuntimeError("provider down")

    monkeypatch.setattr("app.services.sms_service.send_sms", broken)
    assert start_signup(client, "alice").status_code == 202  # logged, never raised


def test_abandoned_sign_ups_are_forgotten_only_a_day_after_they_end(client):
    """They are counted by the daily text cap, so they must not vanish the moment they expire."""
    started(client, "alice")
    db_exec(update(PendingSignup).values(valid_until=utcnow() - timedelta(hours=2)))
    age_signups(PAST_COOLDOWN)
    started(client, "bob")
    assert len(db_all(select(PendingSignup))) == 2  # the expired one is still there

    db_exec(update(PendingSignup).where(PendingSignup.username == "alice").values(valid_until=utcnow() - timedelta(days=2)))
    age_signups(PAST_COOLDOWN)
    started(client, "carol")
    assert sorted(p.username for p in db_all(select(PendingSignup))) == ["bob", "carol"]


# --- The live checks on Create Account ------------------------------------------


def test_check_username(client):
    register(client, "alice")

    assert client.get("/auth/check-username", params={"username": "alice"}).json() == {"available": False}
    assert client.get("/auth/check-username", params={"username": "  ALICE "}).json() == {"available": False}
    assert client.get("/auth/check-username", params={"username": "bob"}).json() == {"available": True}


def test_check_username_refuses_what_could_never_be_a_username(client):
    for bad in ("ab", "a" * 21, "has space", ""):
        response = client.get("/auth/check-username", params={"username": bad})
        assert response.status_code == 422, bad
        assert error_code(response) == "validation_error"
        assert [f["field"] for f in response.json()["detail"]["fields"]] == ["username"], bad


def test_check_phone(client):
    register(client, "alice")

    assert client.get("/auth/check-phone", params={"phone": "9876543210"}).json() == {"available": False}
    assert client.get("/auth/check-phone", params={"phone": "+91 98765 43210"}).json() == {"available": False}
    assert client.get("/auth/check-phone", params={"phone": "9876543211"}).json() == {"available": True}
    bad = client.get("/auth/check-phone", params={"phone": "12345"})
    assert bad.status_code == 422 and bad.json()["detail"]["fields"][0]["field"] == "phone"


def test_the_checks_are_limited_per_address_and_the_phone_check_is_tighter(client, monkeypatch):
    monkeypatch.setattr(settings, "USERNAME_CHECK_MAX_PER_IP_PER_MINUTE", 3)
    monkeypatch.setattr(settings, "PHONE_CHECK_MAX_PER_IP_PER_HOUR", 2)
    assert [client.get("/auth/check-username", params={"username": "abc"}).status_code for _ in range(3)] == [200] * 3
    blocked = client.get("/auth/check-username", params={"username": "abc"})
    assert blocked.status_code == 429 and error_code(blocked) == "too_many_requests"

    assert [client.get("/auth/check-phone", params={"phone": "9876543211"}).status_code for _ in range(2)] == [200, 200]
    assert client.get("/auth/check-phone", params={"phone": "9876543211"}).status_code == 429


def test_the_phone_is_not_in_the_access_log_for_the_check(client):
    from app.utils.log_redaction import redact

    assert "9876543210" not in redact("GET /auth/check-phone?phone=9876543210 HTTP/1.1")


# --- Two people verifying at the same moment -------------------------------------


@pytest.fixture
def file_engine(tmp_path):
    engine = make_engine(f"sqlite:///{(tmp_path / 'race.db').as_posix()}")
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


def test_one_right_code_cannot_create_the_account_twice_at_the_same_moment(file_engine):
    from sqlalchemy.orm import Session

    from app.utils import security

    now = utcnow()
    with Session(file_engine) as db:
        db.add(
            PendingSignup(
                public_id="su_race", username="alice", name="Alice", phone="+919876543210",
                password_hash=security.hash_password("password123"),
                code_hash=security.hash_otp("+919876543210", "123456"),
                last_sent_at=now, expires_at=now + timedelta(minutes=5), valid_until=now + timedelta(minutes=30),
            )
        )
        db.commit()

    results = run_in_parallel(file_engine, 2, lambda db: auth_service.verify_signup(db, "su_race", "123456"))

    assert sorted(kind for kind, _ in results) == ["error", "ok"]
    assert [value for kind, value in results if kind == "error"] == ["verification_not_found"]
    with Session(file_engine) as db:
        assert len(db.scalars(select(User)).all()) == 1
