"""Phone and email together.

Sign-up collects both. The verification code goes to the EMAIL only: the phone is checked (a real mobile number, one
account per number) but never gets a code. Forgot password needs the username and the email on that account. Signing in
is still username and password. People are found by username or by a complete phone number.
"""

import pytest
from sqlalchemy import select

from app.config import settings
from app.database import SessionLocal
from app.models.pending_signup import PendingSignup
from app.models.user import User
from app.utils import security
from app.utils.validators import normalize_phone, parse_full_phone
from tests.helpers import EMAILS, PASSWORD, PHONES, auth, create_space, db_all, error_code, last_code, register, register_payload, rewind, start_signup


def sign_up(client, **overrides):
    return client.post("/auth/register", json=register_payload(**overrides))


def finish(client, started, email):
    """The second step: the code that was emailed to `email`."""
    return client.post("/auth/register/verify", json={"pending_id": started.json()["pending_id"], "code": last_code(email)})


def search(client, tokens, q):
    return client.get("/users/search", params={"q": q}, headers=auth(tokens))


def usernames(response) -> list[str]:
    return [row["username"] for row in response.json()]


# --- Sign-up collects both, and only the email gets a code ---------------------------------------------


def test_sign_up_takes_name_username_phone_email_and_the_password_twice(client, email_outbox):
    response = sign_up(client)

    assert response.status_code == 202
    [pending] = db_all(select(PendingSignup))
    assert (pending.username, pending.name, pending.phone, pending.email) == ("alice", "Alice", "+919876543210", "alice@example.com")
    assert response.json()["masked_email"] == "al***@example.com"  # the screen says where the code went: the email


def test_the_code_is_emailed_and_nothing_is_sent_to_the_phone(client, email_outbox):
    sign_up(client)

    assert [to for to, _ in email_outbox] == ["alice@example.com"]  # one email, to the address; there is no other channel
    assert "+919876543210" not in " ".join(body for _, body in email_outbox)


def test_the_right_code_creates_an_account_with_the_phone_and_the_email(client, email_outbox):
    started = sign_up(client)

    done = finish(client, started, EMAILS["alice"])

    assert done.status_code == 201
    me = client.get("/users/me", headers=auth(done.json())).json()
    assert (me["phone"], me["email"]) == ("+919876543210", "alice@example.com")
    [user] = db_all(select(User))
    assert (user.phone, user.email) == ("+919876543210", "alice@example.com")


def test_the_phone_is_required(client):
    payload = register_payload()
    del payload["phone"]

    response = client.post("/auth/register", json=payload)

    assert response.status_code == 422 and "phone" in [f["field"] for f in response.json()["detail"]["fields"]]
    assert db_all(select(PendingSignup)) == []


def test_the_email_is_required_too(client):
    payload = register_payload()
    del payload["email"]

    response = client.post("/auth/register", json=payload)

    assert response.status_code == 422 and "email" in [f["field"] for f in response.json()["detail"]["fields"]]


# --- The phone number rules (libphonenumber, mobile only, ASCII digits) ----------------------------------

VALID = [
    ("9876543210", "+919876543210"),  # a national number: read as +91
    ("+91 98765 43210", "+919876543210"),
    ("91 98765 43210", "+919876543210"),  # with the country code but no plus
    ("(+91) 98765-43210", "+919876543210"),
    ("00919876543210", "+919876543210"),  # the international dialling prefix
    ("+44 7911 123456", "+447911123456"),
    ("+1 415 555 2671", "+14155552671"),
    ("+971 50 123 4567", "+971501234567"),
    ("  +91 9876543210  ", "+919876543210"),
]
INVALID = [
    ("+91 80 4123 4567", "a landline"),
    ("12345", "too short"),
    ("+91 98765 4321", "one digit short"),
    ("+91 98765 432100", "one digit long"),
    ("+9876543210", "no such country"),
    ("98765abcde", "letters"),
    ("++919876543210", "two pluses"),
    ("+91 98765 43210 ext 5", "an extension"),
    ("٩٨٧٦٥٤٣٢١٠", "Arabic-Indic digits"),
    ("９８７６５４３２１０", "fullwidth digits"),
    ("+९१ ९८७६५ ४३२१०", "Devanagari digits"),
    ("", "empty"),
    ("   ", "blank"),
]


@pytest.mark.parametrize("typed, expected", VALID)
def test_real_mobile_numbers_are_normalised(typed, expected):
    assert normalize_phone(typed) == expected


@pytest.mark.parametrize("typed, why", INVALID, ids=[why for _, why in INVALID])
def test_anything_else_is_refused(typed, why):
    with pytest.raises(ValueError):
        normalize_phone(typed)


@pytest.mark.parametrize("typed, why", INVALID, ids=[why for _, why in INVALID])
def test_a_bad_number_is_a_validation_error_on_sign_up(client, typed, why):
    response = sign_up(client, phone=typed)

    assert response.status_code == 422 and "phone" in [f["field"] for f in response.json()["detail"]["fields"]]
    assert db_all(select(PendingSignup)) == []


def test_look_alike_digits_are_not_a_phone_number_in_search_either():
    assert parse_full_phone("٩٨٧٦٥٤٣٢١٠") is None
    assert parse_full_phone("９８７６５４３２１０") is None
    assert parse_full_phone("98765 43210") == "+919876543210"


@pytest.mark.parametrize("typed", ["+", "++919876543210", "1+1", "98+76543210", "phone 9876543210", "(+91) 98765 4321"])
def test_search_does_not_mistake_something_else_for_a_complete_number(typed):
    assert parse_full_phone(typed) is None


# --- One account per phone number ---------------------------------------------------------------------


def test_the_same_phone_typed_two_ways_is_one_phone(client):
    register(client, "alice")

    for typed in ("9876543210", "+91 98765 43210", "(+91) 98765-43210"):
        again = start_signup(client, "bob", phone=typed)
        assert again.status_code == 409 and error_code(again) == "phone_taken", typed


def test_two_sign_ups_with_one_number_cannot_both_finish(client):
    """An unverified sign-up reserves nothing: whoever verifies first gets the number."""
    first = start_signup(client, "bob", phone=PHONES["bob"])
    second = start_signup(client, "carol", phone=PHONES["bob"])
    assert first.status_code == second.status_code == 202

    assert finish(client, first, EMAILS["bob"]).status_code == 201
    late = finish(client, second, EMAILS["carol"])

    assert late.status_code == 409 and error_code(late) in ("phone_taken", "already_registered")
    assert [u.username for u in db_all(select(User))] == ["bob"]


def test_a_phone_and_an_email_are_each_unique_on_their_own(client):
    register(client, "alice")

    same_email = start_signup(client, "bob", email=EMAILS["alice"])
    same_phone = start_signup(client, "bob", phone=PHONES["alice"])

    assert error_code(same_email) == "email_taken" and error_code(same_phone) == "phone_taken"


def test_accounts_without_a_phone_can_exist_side_by_side(client):
    """Accounts made before phone numbers came back have none; several empty ones do not clash."""
    with SessionLocal() as db:
        for name in ("old.one", "old.two"):
            db.add(User(username=name, name=name, email=f"{name}@example.com", phone=None, password_hash=security.hash_password(PASSWORD)))
        db.commit()

    login = client.post("/auth/login", json={"username": "old.one", "password": PASSWORD})
    me = client.get("/users/me", headers=auth(login.json())).json()

    assert login.status_code == 200 and me["phone"] is None and me["email"] == "old.one@example.com"


def test_a_phone_number_in_a_url_is_kept_out_of_the_access_log():
    from app.utils.log_redaction import redact

    assert redact("GET /auth/check-phone?phone=%2B919876543210 HTTP/1.1") == "GET /auth/check-phone?phone=[redacted] HTTP/1.1"


# --- The live phone check -----------------------------------------------------------------------------


def test_the_live_phone_check_says_whether_a_number_is_free(client):
    register(client, "alice")

    taken = client.get("/auth/check-phone", params={"phone": "+91 98765 43210"})
    free = client.get("/auth/check-phone", params={"phone": PHONES["bob"]})

    assert taken.json() == {"available": False} and free.json() == {"available": True}


def test_the_live_phone_check_refuses_something_that_could_never_be_a_number(client):
    response = client.get("/auth/check-phone", params={"phone": "12345"})

    assert response.status_code == 422 and [f["field"] for f in response.json()["detail"]["fields"]] == ["phone"]


def test_the_live_phone_check_is_limited_per_address(client, monkeypatch):
    monkeypatch.setattr(settings, "PHONE_CHECK_MAX_PER_IP_PER_HOUR", 2)

    assert [client.get("/auth/check-phone", params={"phone": PHONES["bob"]}).status_code for _ in range(2)] == [200, 200]
    limited = client.get("/auth/check-phone", params={"phone": PHONES["bob"]})

    assert limited.status_code == 429 and error_code(limited) == "too_many_requests"


# --- Signing in is still username and password ---------------------------------------------------------


def test_sign_in_is_the_username_and_the_password(client):
    register(client, "alice")

    assert client.post("/auth/login", json={"username": "alice", "password": PASSWORD}).status_code == 200


@pytest.mark.parametrize("not_a_username", ["alice@example.com", "9876543210", "+919876543210"])
def test_neither_the_email_nor_the_phone_signs_in(client, not_a_username):
    register(client, "alice")

    response = client.post("/auth/login", json={"username": not_a_username, "password": PASSWORD})

    assert response.status_code == 401 and error_code(response) == "invalid_credentials"


# --- Adding people: by username or by a complete phone number --------------------------------------------


@pytest.fixture
def people(client):
    return {name: register(client, name) for name in ("alice", "bob", "carol")}


def test_a_half_typed_phone_number_finds_nobody(client, people):
    assert usernames(search(client, people["alice"], "98765432")) == []


def test_a_complete_phone_number_finds_exactly_that_person_however_it_is_typed(client, people):
    for typed in (PHONES["carol"], "+91 98765 43213", "(+91) 98765-43213"):
        assert usernames(search(client, people["alice"], typed)) == ["carol"], typed


def test_the_username_still_finds_people(client, people):
    assert usernames(search(client, people["alice"], "bob")) == ["bob"]


def test_a_person_found_by_phone_can_be_added_to_a_space(client, people):
    [found] = usernames(search(client, people["alice"], PHONES["carol"]))

    space = create_space(client, people["alice"], "Trip", [found])

    assert [m["username"] for m in space["members"]] == ["alice", "carol"]


def test_is_friend_is_reported_for_a_phone_match(client, people):
    create_space(client, people["alice"], "Flat", ["bob"])

    friend = search(client, people["alice"], PHONES["bob"]).json()
    stranger = search(client, people["alice"], PHONES["carol"]).json()

    assert friend == [{"username": "bob", "name": "Bob", "is_friend": True}]
    assert stranger == [{"username": "carol", "name": "Carol", "is_friend": False}]


def test_you_never_find_yourself_by_your_own_number(client, people):
    assert usernames(search(client, people["alice"], PHONES["alice"])) == []


def test_results_never_hold_a_phone_number_or_an_email(client, people):
    text = search(client, people["alice"], PHONES["carol"]).text + search(client, people["alice"], "bob").text

    assert "9876543213" not in text and "9876543211" not in text and "example.com" not in text


def test_a_deleted_account_cannot_be_found_by_its_number(client, people):
    assert client.post("/users/me/delete", json={"password": PASSWORD}, headers=auth(people["carol"])).status_code == 204

    assert usernames(search(client, people["alice"], PHONES["carol"])) == []


def test_phone_lookups_are_limited_much_harder_than_username_searches(client, people, monkeypatch):
    monkeypatch.setattr(settings, "PHONE_LOOKUPS_PER_USER_PER_HOUR", 2)

    assert [search(client, people["alice"], PHONES["bob"]).status_code for _ in range(2)] == [200, 200]
    limited = search(client, people["alice"], PHONES["bob"])

    assert limited.status_code == 429 and error_code(limited) == "too_many_requests"
    assert search(client, people["alice"], "bob").status_code == 200  # looking up by username is not counted
    assert search(client, people["bob"], PHONES["carol"]).status_code == 200  # and the limit is per person


# --- Deleting an account lets both go ---------------------------------------------------------------------


def test_deleting_an_account_frees_the_phone_and_the_email(client):
    alice = register(client, "alice")

    assert client.post("/users/me/delete", json={"password": PASSWORD}, headers=auth(alice)).status_code == 204

    with SessionLocal() as db:
        gone = db.get(User, "alice")
        assert gone.phone is None and gone.email == "deleted:alice@example.invalid"
    assert client.get("/auth/check-phone", params={"phone": PHONES["alice"]}).json() == {"available": True}
    assert client.get("/auth/check-email", params={"email": EMAILS["alice"]}).json() == {"available": True}
    rewind(PendingSignup, 60)  # the 30-second wait between emails to one address has passed
    reused = register(client, "alice2", email=EMAILS["alice"], phone=PHONES["alice"])  # a new person may use both
    assert client.get("/users/me", headers=auth(reused)).json()["phone"] == "+919876543210"


# --- The export carries both -------------------------------------------------------------------------------


def test_the_export_profile_has_the_phone_and_the_email_of_the_person_asking(client, people):
    export = client.post("/users/me/export", json={"password": PASSWORD}, headers=auth(people["alice"])).json()

    assert (export["profile"]["phone"], export["profile"]["email"]) == ("+919876543210", "alice@example.com")
    assert "9876543211" not in str(export) and "bob@example.com" not in str(export)  # nobody else's
