"""Forgot password: texted code -> reset token -> new password, with every timeout."""

import re
from datetime import timedelta

import pytest
from sqlalchemy import select, update

from app.config import settings
from app.database import SessionLocal, utcnow
from app.models.password_reset import PasswordReset
from tests.helpers import PASSWORD, PHONES, auth, db_exec, error_code, register

PHONE = PHONES["alice"]
NEW_PASSWORD = "brand-new-password-1"


def forgot(client, phone=PHONE):
    return client.post("/auth/forgot", json={"phone": phone})


def request_code(client, sms_outbox, phone=PHONE) -> str:
    """Ask for a code and read it out of the text message the app 'sent'."""
    response = forgot(client, phone)
    assert response.status_code == 202, response.text
    return re.search(r"\b(\d{6})\b", sms_outbox[-1][1]).group(1)


def verify(client, code, phone=PHONE):
    return client.post("/auth/verify-otp", json={"phone": phone, "code": code})


def reset(client, token, password=NEW_PASSWORD, confirm=None):
    return client.post(
        "/auth/reset",
        json={"reset_token": token, "new_password": password, "confirm_password": confirm or password},
    )


def login(client, password):
    return client.post("/auth/login", json={"username": "alice", "password": password})


def age_requests(minutes: int) -> None:
    """Pretend the earlier code requests happened `minutes` ago."""
    with SessionLocal() as session:
        for row in session.scalars(select(PasswordReset)):
            row.created_at -= timedelta(minutes=minutes)
        session.commit()


@pytest.fixture
def otp_codes(monkeypatch):
    """Make the generated codes predictable: otp_codes("111111", "222222")."""

    def use(*codes):
        iterator = iter(codes)
        monkeypatch.setattr("app.utils.security.generate_otp", lambda length=None: next(iterator))

    return use


# --- Step 1: the code is texted ---------------------------------------------


def test_unknown_number_gets_the_same_reply_and_no_text(client, sms_outbox):
    register(client, "alice")
    known = forgot(client, PHONE)
    unknown = forgot(client, "9000000000")
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()
    assert known.json()["expires_in_seconds"] == settings.OTP_TTL_MINUTES * 60
    assert known.json()["resend_after_seconds"] == settings.OTP_RESEND_COOLDOWN_SECONDS
    assert len(sms_outbox) == 1
    assert sms_outbox[0][0] == "+919876543210"


def test_the_number_can_be_typed_in_any_format(client, sms_outbox):
    register(client, "alice")
    assert forgot(client, "+91 98765 43210").status_code == 202
    assert len(sms_outbox) == 1


def test_the_code_is_not_stored_in_plain_text(client, sms_outbox):
    register(client, "alice")
    code = request_code(client, sms_outbox)
    with SessionLocal() as session:
        row = session.scalars(select(PasswordReset)).one()
    assert code not in row.code_hash
    assert len(row.code_hash) == 64  # an HMAC-SHA256, not the code


# --- Limits on asking for codes ---------------------------------------------


def test_resend_cooldown(client, sms_outbox):
    register(client, "alice")
    assert forgot(client).status_code == 202
    too_soon = forgot(client)
    assert too_soon.status_code == 429
    assert error_code(too_soon) == "resend_too_soon"
    assert int(too_soon.headers["Retry-After"]) > 0
    assert len(sms_outbox) == 1

    age_requests(settings.OTP_RESEND_COOLDOWN_SECONDS // 60 + 1)
    assert forgot(client).status_code == 202
    assert len(sms_outbox) == 2


def test_unknown_numbers_are_limited_exactly_like_known_ones(client, sms_outbox):
    assert forgot(client, "9000000000").status_code == 202
    again = forgot(client, "9000000000")
    assert again.status_code == 429 and error_code(again) == "resend_too_soon"


def test_at_most_three_codes_per_hour(client, sms_outbox):
    register(client, "alice")
    for _ in range(settings.OTP_MAX_REQUESTS_PER_HOUR):
        assert forgot(client).status_code == 202
        age_requests(settings.OTP_RESEND_COOLDOWN_SECONDS // 60 + 1)  # past the cooldown, inside the hour
    blocked = forgot(client)
    assert blocked.status_code == 429
    assert error_code(blocked) == "too_many_requests"
    assert len(sms_outbox) == settings.OTP_MAX_REQUESTS_PER_HOUR


# --- Step 2: entering the code ----------------------------------------------


def test_too_many_wrong_guesses_kill_the_code(client, sms_outbox, otp_codes):
    register(client, "alice")
    otp_codes("123456")
    request_code(client, sms_outbox)
    for _ in range(settings.OTP_MAX_ATTEMPTS):
        wrong = verify(client, "654321")
        assert wrong.status_code == 400 and error_code(wrong) == "invalid_code"
    too_late = verify(client, "123456")  # the right code, but the code is dead now
    assert too_late.status_code == 400 and error_code(too_late) == "invalid_code"


def test_the_code_expires(client, sms_outbox, otp_codes):
    register(client, "alice")
    otp_codes("123456")
    request_code(client, sms_outbox)
    db_exec(update(PasswordReset).values(expires_at=utcnow() - timedelta(seconds=1)))
    response = verify(client, "123456")
    assert response.status_code == 400 and error_code(response) == "invalid_code"


def test_a_new_code_does_not_cancel_the_old_one(client, sms_outbox, otp_codes):
    """Anyone can ask for a code for any number, so asking again must not cancel the code its owner is typing."""
    register(client, "alice")
    otp_codes("111111", "222222")
    request_code(client, sms_outbox)
    age_requests(settings.OTP_RESEND_COOLDOWN_SECONDS // 60 + 1)
    request_code(client, sms_outbox)

    assert verify(client, "111111").status_code == 200  # the first code still works
    assert verify(client, "222222").status_code == 200  # and so does the newer one


def test_verifying_an_unknown_number_fails_like_a_wrong_code(client):
    response = verify(client, "123456", phone="9000000000")
    assert response.status_code == 400 and error_code(response) == "invalid_code"


# --- Step 3: setting the new password ---------------------------------------


def test_full_reset_flow(client, sms_outbox):
    old_session = register(client, "alice")
    code = request_code(client, sms_outbox)

    verified = verify(client, code)
    assert verified.status_code == 200
    assert verified.json()["expires_in_seconds"] == settings.RESET_SESSION_TIMEOUT_MINUTES * 60

    done = reset(client, verified.json()["reset_token"])
    assert done.status_code == 200

    # everyone who was signed in is signed out
    stale = client.get("/spaces", headers=auth(old_session))
    assert stale.status_code == 401 and error_code(stale) == "session_expired"
    # the new password works and the old one does not
    assert login(client, NEW_PASSWORD).status_code == 200
    assert login(client, PASSWORD).status_code == 401


def test_the_reset_session_times_out(client, sms_outbox):
    register(client, "alice")
    token = verify(client, request_code(client, sms_outbox)).json()["reset_token"]
    db_exec(update(PasswordReset).values(reset_expires_at=utcnow() - timedelta(seconds=1)))

    response = reset(client, token)
    assert response.status_code == 400 and error_code(response) == "reset_session_expired"
    assert login(client, PASSWORD).status_code == 200  # the password was not changed


def test_a_reset_token_works_only_once(client, sms_outbox):
    register(client, "alice")
    token = verify(client, request_code(client, sms_outbox)).json()["reset_token"]
    assert reset(client, token).status_code == 200
    again = reset(client, token, password="another-new-password-2")
    assert again.status_code == 400 and error_code(again) == "reset_session_expired"


def test_asking_for_a_new_code_leaves_an_open_reset_session_alone(client, sms_outbox):
    """A stranger repeating the request must not throw the owner out of the set-new-password screen."""
    register(client, "alice")
    token = verify(client, request_code(client, sms_outbox)).json()["reset_token"]
    age_requests(settings.OTP_RESEND_COOLDOWN_SECONDS // 60 + 1)
    forgot(client)
    assert reset(client, token).status_code == 200


def test_a_finished_reset_closes_every_other_open_code_and_reset_session(client, sms_outbox, otp_codes):
    """Once the password has changed, no earlier code or reset session may change it again."""
    register(client, "alice")
    otp_codes("111111", "222222", "333333")
    request_code(client, sms_outbox)
    age_requests(settings.OTP_RESEND_COOLDOWN_SECONDS // 60 + 1)
    request_code(client, sms_outbox)
    age_requests(settings.OTP_RESEND_COOLDOWN_SECONDS // 60 + 1)
    request_code(client, sms_outbox)

    first_token = verify(client, "111111").json()["reset_token"]
    second_token = verify(client, "222222").json()["reset_token"]
    assert reset(client, first_token).status_code == 200

    assert verify(client, "333333").status_code == 400  # the third code is closed now
    other = reset(client, second_token, password="another-new-password-2")
    assert other.status_code == 400 and error_code(other) == "reset_session_expired"
    assert login(client, NEW_PASSWORD).status_code == 200  # the password is still the one from the first reset


def test_reset_rejects_unknown_tokens_and_bad_passwords(client, sms_outbox):
    register(client, "alice")
    unknown = reset(client, "not-a-real-token")
    assert unknown.status_code == 400 and error_code(unknown) == "reset_session_expired"

    token = verify(client, request_code(client, sms_outbox)).json()["reset_token"]
    assert reset(client, token, password="short").status_code == 422
    assert reset(client, token, confirm="does-not-match-1").status_code == 422
    assert reset(client, token).status_code == 200  # the token was not used up by the failed tries


def test_a_reset_lifts_the_sign_in_lockout(client, sms_outbox):
    register(client, "alice")
    for _ in range(settings.LOGIN_MAX_ATTEMPTS):
        login(client, "wrong-password")
    assert login(client, PASSWORD).status_code == 429

    token = verify(client, request_code(client, sms_outbox)).json()["reset_token"]
    reset(client, token)
    assert login(client, NEW_PASSWORD).status_code == 200
