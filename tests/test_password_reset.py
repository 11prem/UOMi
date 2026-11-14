"""Forgot password: username -> masked phone and texted code -> reset token -> new password, with every timeout."""

import re
from datetime import timedelta

import pytest
from sqlalchemy import select, update

from app.config import settings
from app.database import SessionLocal, utcnow
from app.models.password_reset import PasswordReset
from tests.helpers import PASSWORD, PHONES, auth, db_exec, error_code, last_code, register, rewind

PHONE = PHONES["alice"]
NEW_PASSWORD = "brand-new-password-1"
MASK = re.compile(r"\+91 \d\d\*{6}\d\d")  # the shape of a masked +91 number: "+91 98******10"


def forgot(client, username="alice"):
    return client.post("/auth/forgot", json={"username": username})


def request_code(client, username="alice") -> tuple[str, str]:
    """Ask for a code. Returns the reset id and the code, read out of the text message the app 'sent'."""
    response = forgot(client, username)
    assert response.status_code == 202, response.text
    return response.json()["reset_id"], last_code(PHONES[username])


def verify(client, reset_id, code):
    return client.post("/auth/verify-otp", json={"reset_id": reset_id, "code": code})


def resend(client, reset_id):
    return client.post("/auth/otp/resend", json={"id": reset_id})


def reset(client, token, password=NEW_PASSWORD, confirm=None):
    return client.post(
        "/auth/reset",
        json={"reset_token": token, "new_password": password, "confirm_password": confirm or password},
    )


def login(client, password):
    return client.post("/auth/login", json={"username": "alice", "password": password})


def age_requests(seconds: int) -> None:
    """Pretend the earlier requests, and the texts sent for them, happened `seconds` ago."""
    with SessionLocal() as session:
        for row in session.scalars(select(PasswordReset)):
            row.created_at -= timedelta(seconds=seconds)
            row.last_sent_at -= timedelta(seconds=seconds)
        session.commit()


PAST_COOLDOWN = settings.OTP_RESEND_COOLDOWN_SECONDS + 1


@pytest.fixture
def alice(client, sms_outbox):
    """Alice has an account. The text her sign-up code came in is cleared, so only reset codes remain."""
    tokens = register(client, "alice")
    sms_outbox.clear()
    return tokens


@pytest.fixture
def otp_codes(monkeypatch):
    """Make the generated codes predictable: otp_codes("111111", "222222")."""

    def use(*codes):
        iterator = iter(codes)
        monkeypatch.setattr("app.utils.security.generate_otp", lambda length=None: next(iterator))

    return use


# --- Step a: the username, then the masked phone and the text ---------------


def test_the_reply_shows_the_masked_phone_and_texts_the_code(client, alice, sms_outbox):
    response = forgot(client)

    assert response.status_code == 202
    body = response.json()
    assert body["masked_phone"] == "+91 98******10"  # the first 2 and last 2 digits of the national number (specs § 1)
    assert body["expires_in_seconds"] == settings.OTP_TTL_MINUTES * 60
    assert body["resend_after_seconds"] == settings.OTP_RESEND_COOLDOWN_SECONDS == 30
    assert body["reset_id"].startswith("pw_")
    assert [phone for phone, _ in sms_outbox] == ["+919876543210"]
    assert "Your UOMi code is" in sms_outbox[0][1]


def test_an_unknown_username_gets_the_same_kind_of_reply_and_no_text(client, alice, sms_outbox):
    known = forgot(client, "alice")
    unknown = forgot(client, "nobody.here")

    assert known.status_code == unknown.status_code == 202
    assert set(known.json()) == set(unknown.json())  # the same fields
    for field in ("message", "expires_in_seconds", "resend_after_seconds"):
        assert known.json()[field] == unknown.json()[field]
    assert MASK.fullmatch(unknown.json()["masked_phone"])  # it has a masked number too, in the same format
    assert known.json()["reset_id"] != unknown.json()["reset_id"]
    assert len(sms_outbox) == 1  # only alice's phone was texted


def test_the_made_up_number_for_an_unknown_username_is_always_the_same(client, alice):
    first = forgot(client, "nobody.here").json()["masked_phone"]
    age_requests(PAST_COOLDOWN)
    second = forgot(client, "nobody.here").json()["masked_phone"]
    other = forgot(client, "someone.else").json()["masked_phone"]

    assert first == second  # a different number each time would give it away
    assert other != first


def test_the_username_can_be_typed_in_any_case_with_spaces(client, alice, sms_outbox):
    assert forgot(client, "  ALICE ").status_code == 202
    assert len(sms_outbox) == 1


def test_the_code_is_not_stored_in_plain_text(client, alice):
    _, code = request_code(client)
    with SessionLocal() as session:
        row = session.scalars(select(PasswordReset)).one()
    assert code not in row.code_hash
    assert len(row.code_hash) == 64  # an HMAC-SHA256, not the code


def test_an_old_phone_number_request_is_no_longer_a_thing(client, alice):
    assert client.post("/auth/forgot", json={"phone": PHONE}).status_code == 422


# --- Limits on asking for codes ---------------------------------------------


def test_resend_cooldown_applies_to_asking_again(client, alice, sms_outbox):
    assert forgot(client).status_code == 202
    too_soon = forgot(client)
    assert too_soon.status_code == 429
    assert error_code(too_soon) == "resend_too_soon"
    assert int(too_soon.headers["Retry-After"]) > 0
    assert len(sms_outbox) == 1

    age_requests(PAST_COOLDOWN)
    assert forgot(client).status_code == 202
    assert len(sms_outbox) == 2


def test_unknown_usernames_are_limited_exactly_like_known_ones(client):
    assert forgot(client, "nobody.here").status_code == 202
    again = forgot(client, "nobody.here")
    assert again.status_code == 429 and error_code(again) == "resend_too_soon"


def test_at_most_three_requests_per_hour_for_a_username(client, alice, sms_outbox):
    for _ in range(settings.OTP_MAX_REQUESTS_PER_HOUR):
        assert forgot(client).status_code == 202
        age_requests(PAST_COOLDOWN)  # past the cooldown, inside the hour
    blocked = forgot(client)
    assert blocked.status_code == 429
    assert error_code(blocked) == "too_many_requests"
    assert len(sms_outbox) == settings.OTP_MAX_REQUESTS_PER_HOUR


def test_unknown_usernames_hit_the_hourly_limit_too(client):
    for _ in range(settings.OTP_MAX_REQUESTS_PER_HOUR):
        assert forgot(client, "nobody.here").status_code == 202
        age_requests(PAST_COOLDOWN)
    assert error_code(forgot(client, "nobody.here")) == "too_many_requests"


# --- Step b: entering the code ----------------------------------------------


def test_a_wrong_code_is_its_own_error(client, alice, otp_codes):
    otp_codes("123456")
    reset_id, _ = request_code(client)

    wrong = verify(client, reset_id, "654321")

    assert wrong.status_code == 400
    assert error_code(wrong) == "invalid_code"
    assert wrong.json()["detail"]["message"] == "That code is incorrect"


def test_five_wrong_codes_lock_it_for_ten_minutes(client, alice, otp_codes):
    otp_codes("123456")
    reset_id, _ = request_code(client)
    for _ in range(settings.OTP_MAX_ATTEMPTS - 1):
        assert error_code(verify(client, reset_id, "654321")) == "invalid_code"

    locked = verify(client, reset_id, "654321")  # the 5th wrong code is the one that locks

    assert locked.status_code == 429 and error_code(locked) == "otp_locked"
    assert locked.json()["detail"]["message"] == "Too many attempts — try again in 10 minutes"
    assert locked.json()["detail"]["retry_after_seconds"] == settings.OTP_LOCK_MINUTES * 60
    assert int(locked.headers["Retry-After"]) == settings.OTP_LOCK_MINUTES * 60

    still_locked = verify(client, reset_id, "123456")  # the right code does not help while it is locked
    assert still_locked.status_code == 429 and error_code(still_locked) == "otp_locked"
    assert error_code(resend(client, reset_id)) == "otp_locked"  # nor does asking for another code


def test_the_lock_ends_after_ten_minutes_but_by_then_the_code_has_expired(client, alice, otp_codes):
    """The code lives 5 minutes and the lock 10, so the person must ask for a new code once the lock is over."""
    otp_codes("123456", "654322")
    reset_id, _ = request_code(client)
    for _ in range(settings.OTP_MAX_ATTEMPTS):
        verify(client, reset_id, "000000")
    assert error_code(verify(client, reset_id, "123456")) == "otp_locked"

    rewind(PasswordReset, settings.OTP_LOCK_MINUTES * 60 + 1)  # ten minutes pass: the code, the lock and the text age together

    expired = verify(client, reset_id, "123456")
    assert expired.status_code == 400 and error_code(expired) == "code_expired"  # not accepted, and not "locked" any more
    assert resend(client, reset_id).status_code == 200  # "Resend code" works again
    assert verify(client, reset_id, "654322").status_code == 200  # and the guesses started from zero


def test_the_lock_is_per_request_not_per_username(client, alice, otp_codes):
    """Locking one request must not lock the owner out: they can ask again and use the new request."""
    otp_codes("111111", "222222")
    locked_id, _ = request_code(client)
    for _ in range(settings.OTP_MAX_ATTEMPTS):
        verify(client, locked_id, "654321")
    age_requests(PAST_COOLDOWN)

    fresh_id, code = request_code(client)

    assert verify(client, fresh_id, code).status_code == 200


def test_the_code_expires_with_its_own_error(client, alice, otp_codes):
    otp_codes("123456")
    reset_id, _ = request_code(client)
    db_exec(update(PasswordReset).values(expires_at=utcnow() - timedelta(seconds=1)))

    response = verify(client, reset_id, "123456")

    assert response.status_code == 400 and error_code(response) == "code_expired"
    assert response.json()["detail"]["message"] == "Code expired — resend"


def test_a_new_request_does_not_cancel_the_old_one(client, alice, otp_codes):
    """Anyone can ask for a code for any username, so asking again must not cancel the code its owner is typing."""
    otp_codes("111111", "222222")
    first_id, _ = request_code(client)
    age_requests(PAST_COOLDOWN)
    second_id, _ = request_code(client)

    assert verify(client, first_id, "111111").status_code == 200  # the first request still works
    assert verify(client, second_id, "222222").status_code == 200  # and so does the newer one


def test_a_code_only_works_for_its_own_request(client, alice, otp_codes):
    otp_codes("111111", "222222")
    first_id, _ = request_code(client)
    age_requests(PAST_COOLDOWN)
    second_id, _ = request_code(client)

    assert error_code(verify(client, first_id, "222222")) == "invalid_code"  # the other request's code
    assert verify(client, second_id, "222222").status_code == 200


def test_an_unknown_reset_id_is_not_found(client):
    for bad in ("pw_made-up", "su_made-up", "garbage"):
        response = verify(client, bad, "123456")
        assert response.status_code == 404 and error_code(response) == "verification_not_found"


def test_a_request_that_ran_out_has_its_own_error(client, alice):
    reset_id, code = request_code(client)
    db_exec(update(PasswordReset).values(valid_until=utcnow() - timedelta(seconds=1)))

    for response in (verify(client, reset_id, code), resend(client, reset_id)):
        assert response.status_code == 400 and error_code(response) == "verification_expired"


def test_a_made_up_username_behaves_like_a_real_one_when_guessed_at(client):
    """Same answers in the same order, so the guesses cannot tell the two apart."""
    reset_id = forgot(client, "nobody.here").json()["reset_id"]
    answers = [error_code(verify(client, reset_id, "000000")) for _ in range(settings.OTP_MAX_ATTEMPTS)]

    assert answers == ["invalid_code"] * (settings.OTP_MAX_ATTEMPTS - 1) + ["otp_locked"]


def test_resending_works_on_a_made_up_username_and_sends_nothing(client, sms_outbox):
    reset_id = forgot(client, "nobody.here").json()["reset_id"]
    age_requests(PAST_COOLDOWN)

    response = resend(client, reset_id)

    assert response.status_code == 200
    assert response.json() == {"expires_in_seconds": 300, "resend_after_seconds": 30}
    assert sms_outbox == []


# --- Resend code (the link on the code screen) ------------------------------


def test_resend_gives_a_fresh_code_and_the_old_one_stops_working(client, alice, sms_outbox, otp_codes):
    otp_codes("111111", "222222")
    reset_id, _ = request_code(client)
    age_requests(PAST_COOLDOWN)

    response = resend(client, reset_id)

    assert response.status_code == 200
    assert response.json() == {"expires_in_seconds": 300, "resend_after_seconds": 30}
    assert [phone for phone, _ in sms_outbox] == ["+919876543210"] * 2
    assert last_code(PHONE) == "222222"
    assert error_code(verify(client, reset_id, "111111")) == "invalid_code"
    assert verify(client, reset_id, "222222").status_code == 200


def test_resend_has_a_thirty_second_cooldown(client, alice, sms_outbox):
    reset_id, _ = request_code(client)

    too_soon = resend(client, reset_id)

    assert too_soon.status_code == 429 and error_code(too_soon) == "resend_too_soon"
    assert 0 < too_soon.json()["detail"]["retry_after_seconds"] <= 30
    assert len(sms_outbox) == 1
    age_requests(PAST_COOLDOWN)
    assert resend(client, reset_id).status_code == 200


def test_resend_starts_the_wrong_guesses_again(client, alice, otp_codes):
    otp_codes("111111", "222222")
    reset_id, _ = request_code(client)
    for _ in range(settings.OTP_MAX_ATTEMPTS - 1):
        verify(client, reset_id, "000000")
    age_requests(PAST_COOLDOWN)
    resend(client, reset_id)

    assert error_code(verify(client, reset_id, "000000")) == "invalid_code"  # not locked: a new code, a fresh count
    assert verify(client, reset_id, "222222").status_code == 200


def test_a_request_gets_at_most_three_texts(client, alice, sms_outbox):
    reset_id, _ = request_code(client)
    for _ in range(settings.OTP_MAX_SENDS_PER_REQUEST - 1):
        age_requests(PAST_COOLDOWN)
        assert resend(client, reset_id).status_code == 200
    age_requests(PAST_COOLDOWN)

    capped = resend(client, reset_id)

    assert capped.status_code == 429 and error_code(capped) == "too_many_requests"
    assert len(sms_outbox) == settings.OTP_MAX_SENDS_PER_REQUEST


def test_a_verified_request_cannot_be_resent(client, alice):
    reset_id, code = request_code(client)
    assert verify(client, reset_id, code).status_code == 200
    age_requests(PAST_COOLDOWN)

    assert error_code(resend(client, reset_id)) == "verification_expired"


def test_resend_is_limited_per_address(client, alice, monkeypatch):
    monkeypatch.setattr(settings, "RESEND_MAX_PER_IP_PER_HOUR", 2)
    reset_id, _ = request_code(client)
    for _ in range(2):
        age_requests(PAST_COOLDOWN)
        assert resend(client, reset_id).status_code == 200
    blocked = resend(client, reset_id)
    assert blocked.status_code == 429 and error_code(blocked) == "too_many_requests"


# --- Step c: setting the new password ---------------------------------------


def test_full_reset_flow(client, alice, sms_outbox):
    old_session = alice
    reset_id, code = request_code(client)

    verified = verify(client, reset_id, code)
    assert verified.status_code == 200
    assert verified.json()["expires_in_seconds"] == settings.RESET_SESSION_TIMEOUT_MINUTES * 60

    done = reset(client, verified.json()["reset_token"])
    assert done.status_code == 200
    assert done.json() == {"message": "Password updated. Please sign in.", "username": "alice"}  # the username comes back

    # everyone who was signed in is signed out
    stale = client.get("/spaces", headers=auth(old_session))
    assert stale.status_code == 401 and error_code(stale) == "session_expired"
    # the new password works and the old one does not
    assert login(client, NEW_PASSWORD).status_code == 200
    assert login(client, PASSWORD).status_code == 401


def test_the_reset_session_times_out(client, alice):
    reset_id, code = request_code(client)
    token = verify(client, reset_id, code).json()["reset_token"]
    db_exec(update(PasswordReset).values(reset_expires_at=utcnow() - timedelta(seconds=1)))

    response = reset(client, token)
    assert response.status_code == 400 and error_code(response) == "reset_session_expired"
    assert login(client, PASSWORD).status_code == 200  # the password was not changed


def test_a_reset_token_works_only_once(client, alice):
    reset_id, code = request_code(client)
    token = verify(client, reset_id, code).json()["reset_token"]
    assert reset(client, token).status_code == 200
    again = reset(client, token, password="another-new-password-2")
    assert again.status_code == 400 and error_code(again) == "reset_session_expired"


def test_asking_for_a_new_code_leaves_an_open_reset_session_alone(client, alice):
    """A stranger repeating the request must not throw the owner out of the set-new-password screen."""
    reset_id, code = request_code(client)
    token = verify(client, reset_id, code).json()["reset_token"]
    age_requests(PAST_COOLDOWN)
    forgot(client)
    assert reset(client, token).status_code == 200


def test_a_finished_reset_closes_every_other_open_code_and_reset_session(client, alice, otp_codes):
    """Once the password has changed, no earlier code or reset session may change it again."""
    otp_codes("111111", "222222", "333333")
    first_id, _ = request_code(client)
    age_requests(PAST_COOLDOWN)
    second_id, _ = request_code(client)
    age_requests(PAST_COOLDOWN)
    third_id, _ = request_code(client)

    first_token = verify(client, first_id, "111111").json()["reset_token"]
    second_token = verify(client, second_id, "222222").json()["reset_token"]
    assert reset(client, first_token).status_code == 200

    closed = verify(client, third_id, "333333")  # the third request is closed now
    assert closed.status_code == 400 and error_code(closed) == "verification_expired"
    assert error_code(resend(client, third_id)) == "verification_expired"  # and it cannot be brought back
    other = reset(client, second_token, password="another-new-password-2")
    assert other.status_code == 400 and error_code(other) == "reset_session_expired"
    assert login(client, NEW_PASSWORD).status_code == 200  # the password is still the one from the first reset


def test_reset_rejects_unknown_tokens_and_bad_passwords(client, alice):
    unknown = reset(client, "not-a-real-token")
    assert unknown.status_code == 400 and error_code(unknown) == "reset_session_expired"

    reset_id, code = request_code(client)
    token = verify(client, reset_id, code).json()["reset_token"]
    assert reset(client, token, password="short1").status_code == 422
    assert reset(client, token, password="onlyletterspassword").status_code == 422  # needs a number
    assert reset(client, token, password="123456789012").status_code == 422  # needs a letter
    assert reset(client, token, confirm="does-not-match-1").status_code == 422
    assert reset(client, token).status_code == 200  # the token was not used up by the failed tries


def test_a_reset_lifts_the_sign_in_lockout(client, alice):
    for _ in range(settings.LOGIN_MAX_ATTEMPTS):
        login(client, "wrong-password")
    assert login(client, PASSWORD).status_code == 429

    reset_id, code = request_code(client)
    token = verify(client, reset_id, code).json()["reset_token"]
    reset(client, token)
    assert login(client, NEW_PASSWORD).status_code == 200
