"""Input rules from the spec (task 1.1.4 and 1.1.5): usernames, names, passwords, space names, icons, phone numbers."""

import pytest

from app.database import SessionLocal
from app.models.group import Space
from app.models.group_member import SpaceMember
from app.models.user import User
from app.utils import security
from app.utils.validators import mask_phone, normalize_phone, parse_full_phone
from tests.helpers import PHONES, auth, create_space, error_code, register, register_payload, start_signup

ICONS = ["home", "trip", "food", "office", "friends", "car", "party", "other"]


def fields_of(response) -> list[str]:
    return [f["field"] for f in response.json()["detail"]["fields"]]


def sign_up_with(client, **overrides):
    return client.post("/auth/register", json=register_payload(**overrides))


# --- Username: 3-20 for a NEW account (specs § 4.2) --------------------------


@pytest.mark.parametrize("username", ["abc", "a" * 20, "kabir.r", "a_b.c9"])
def test_a_username_of_3_to_20_characters_is_accepted(client, username):
    assert sign_up_with(client, username=username).status_code == 202


@pytest.mark.parametrize("username", ["ab", "a" * 21, "a" * 30, "has space", "UPPER!", "dash-ed", "émile"])
def test_other_usernames_are_refused_for_a_new_account(client, username):
    response = sign_up_with(client, username=username)
    assert response.status_code == 422 and "username" in fields_of(response)


def test_older_accounts_with_longer_usernames_still_work_everywhere(client):
    """Accounts made under the looser 3-30 rule keep signing in and stay findable and addable."""
    long_name = "a" * 25
    with SessionLocal() as db:
        db.add(User(username=long_name, name="Old Timer", phone="+919876543299", password_hash=security.hash_password("oldpass1")))
        db.commit()
    alice = register(client, "alice")

    assert client.post("/auth/login", json={"username": long_name, "password": "oldpass1"}).status_code == 200
    assert [p["username"] for p in client.get("/users/search", params={"q": "aaaaa"}, headers=auth(alice)).json()] == [long_name]
    assert create_space(client, alice, "Flat", [long_name])["members"][1]["username"] == long_name


# --- Name: 1-50 (specs § 4.2) -------------------------------------------------


def test_a_name_of_50_characters_is_accepted_and_51_is_not(client):
    assert sign_up_with(client, name="n" * 50).status_code == 202
    too_long = sign_up_with(client, username="bobby", phone=PHONES["bobby"], name="n" * 51)
    assert too_long.status_code == 422 and "name" in fields_of(too_long)


def test_a_name_is_measured_after_the_spaces_are_tidied(client):
    assert sign_up_with(client, name="  " + "n" * 25 + "      " + "m" * 24 + "  ").status_code == 202  # 25 + 1 + 24


# --- Password: 8 characters with a letter and a number (specs § 4.2) ----------


@pytest.mark.parametrize("password", ["abcdefg" + "1", "1" * 8 + "a", "ab" + "!" * 5 + "9", "a1" * 30])  # built, not typed
def test_a_password_with_a_letter_and_a_number_is_accepted(client, password):
    assert sign_up_with(client, password=password, confirm_password=password).status_code == 202


@pytest.mark.parametrize(
    "password",
    ["abcdefg1"[:7], "abcdefghij", "1234567890", "abcdefg٣٣٣", "１２３４５６７８a", "        "],
    ids=["too short", "no number", "no letter", "arabic-indic digits are not numbers", "fullwidth digits are not numbers", "spaces"],
)
def test_other_passwords_are_refused(client, password):
    response = sign_up_with(client, password=password, confirm_password=password)
    assert response.status_code == 422 and "password" in fields_of(response)
    assert response.json()["detail"]["fields"][0]["message"] == "Use at least 8 characters with a letter and a number"


def test_an_older_weaker_password_still_signs_in(client):
    with SessionLocal() as db:
        db.add(User(username="old.timer", name="Old", phone="+919876543299", password_hash=security.hash_password("weakpass")))
        db.commit()
    assert client.post("/auth/login", json={"username": "old.timer", "password": "weakpass"}).status_code == 200


# --- Space name 1-30 and the eight icons (specs § 6.1) ------------------------


def make_space(client, tokens, **overrides):
    body = {"name": "Flat", "icon": "trip", "usernames": ["bob"]}  # a new space needs one other person (decision 1.2.7)
    body.update(overrides)
    return client.post("/spaces", json=body, headers=auth(tokens))


def test_a_space_name_of_30_characters_is_accepted_and_31_is_not(client):
    alice = register(client, "alice")
    register(client, "bob")
    assert make_space(client, alice, name="s" * 30).status_code == 201
    too_long = make_space(client, alice, name="s" * 31)
    assert too_long.status_code == 422 and "name" in fields_of(too_long)
    assert make_space(client, alice, name="   ").status_code == 422


def test_an_older_longer_space_name_still_opens(client):
    alice = register(client, "alice")
    with SessionLocal() as db:
        space = Space(name="x" * 80, icon="rocket", currency="INR", created_by="alice")
        db.add(space)
        db.flush()
        db.add(SpaceMember(space_id=space.id, username="alice", position=1))
        db.commit()
        space_id = space.id
    page = client.get(f"/spaces/{space_id}", headers=auth(alice))
    assert page.status_code == 200 and page.json()["name"] == "x" * 80


@pytest.mark.parametrize("icon", ICONS)
def test_each_of_the_eight_icons_is_accepted(client, icon):
    alice = register(client, "alice")
    register(client, "bob")
    assert make_space(client, alice, icon=icon).status_code == 201


@pytest.mark.parametrize("icon", ["rocket", "TRIP", "", "trip ", "home-2"])
def test_any_other_icon_is_refused(client, icon):
    alice = register(client, "alice")
    register(client, "bob")
    response = make_space(client, alice, icon=icon)
    assert response.status_code == 422 and "icon" in fields_of(response)


# --- Phone numbers (specs § 1, § 4.2): libphonenumber, mobile only, ASCII digits --------

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
    response = sign_up_with(client, phone=typed)
    assert response.status_code == 422 and "phone" in fields_of(response)


def test_look_alike_digits_are_not_a_phone_number_in_search_either():
    assert parse_full_phone("٩٨٧٦٥٤٣٢١٠") is None
    assert parse_full_phone("９８７６５４３２１０") is None
    assert parse_full_phone("98765 43210") == "+919876543210"


def test_look_alike_digits_are_not_a_code():
    from fastapi.testclient import TestClient  # noqa: F401  (the schema check needs no client)
    from pydantic import ValidationError

    from app.schemas.user import VerifyOTPRequest

    with pytest.raises(ValidationError):
        VerifyOTPRequest(reset_id="pw_x", code="١٢٣٤٥٦")  # Arabic-Indic digits
    with pytest.raises(ValidationError):
        VerifyOTPRequest(reset_id="pw_x", code="１２３４５６")  # fullwidth digits
    assert VerifyOTPRequest(reset_id="pw_x", code="123456").code == "123456"


def test_the_same_phone_typed_two_ways_is_one_phone(client):
    register(client, "alice")
    for typed in ("9876543210", "+91 98765 43210", "(+91) 98765-43210"):
        again = sign_up_with(client, username="alice2", phone=typed)
        assert again.status_code == 409 and error_code(again) == "phone_taken", typed


# --- The masked number (specs § 1) --------------------------------------------


@pytest.mark.parametrize(
    "phone, masked",
    [
        ("+918012345631", "+91 80******31"),  # the spec's own example
        ("+919876543210", "+91 98******10"),
        ("+14155552671", "+1 41******71"),
        ("+971501234567", "+971 50*****67"),  # a 9-digit national number
        ("+447911123456", "+44 79******56"),
    ],
)
def test_the_masked_number_shows_the_first_two_and_last_two_digits(phone, masked):
    assert mask_phone(phone) == masked


def test_a_masked_number_never_contains_the_middle_digits():
    assert "7654" not in mask_phone("+919876543210")


def test_a_sign_up_shows_the_masked_number_not_the_number(client):
    response = start_signup(client, "alice")
    assert response.json()["masked_phone"] == "+91 98******10"
    assert PHONES["alice"] not in response.text


# --- Characters PostgreSQL would refuse, and lengths its columns would refuse (a 500 there, so a 422 here) ------

NUL = chr(0)  # a NUL character cannot be stored in a PostgreSQL text column


def test_a_nul_character_is_refused_in_every_free_text_input(client):
    alice = register(client, "alice")
    register(client, "alex")
    space = create_space(client, alice, "Flat", [])
    pending_id = start_signup(client, "bob").json()["pending_id"]

    attempts = [
        client.post("/auth/register", json=register_payload(username="carol", phone=PHONES["carol"], name="Ca" + NUL + "rol")),
        client.post("/auth/forgot", json={"username": "ali" + NUL + "ce"}),
        client.post("/auth/login", json={"username": "ali" + NUL + "ce", "password": "password123"}),
        client.post("/auth/otp/resend", json={"id": "su_" + NUL}),
        client.post("/auth/register/verify", json={"pending_id": pending_id + NUL, "code": "123456"}),
        client.post("/auth/verify-otp", json={"reset_id": "pw_" + NUL, "code": "123456"}),
        client.post("/spaces", json={"name": "Fl" + NUL + "at", "icon": "home", "usernames": ["alex"]}, headers=auth(alice)),
        client.post(
            f"/spaces/{space['id']}/expenses",
            json={"description": "Din" + NUL + "ner", "amount_minor": 100, "paid_by": "alice", "split_type": "equal",
                  "shares": [{"username": "alice"}], "date": "2026-01-01"},
            headers=auth(alice),
        ),
    ]
    assert [response.status_code for response in attempts] == [422] * len(attempts)


def test_a_username_that_gets_longer_when_lowercased_is_refused_not_stored(client):
    """The capital dotted I lowercases to two characters, so 50 of them are 100 after lower(): more than the column holds."""
    dotted_capital_i = chr(0x130)
    for path, body in (
        ("/auth/forgot", {"username": dotted_capital_i * 50}),
        ("/auth/login", {"username": dotted_capital_i * 50, "password": "x"}),
    ):
        response = client.post(path, json=body)
        assert response.status_code == 422, path
        assert [f["field"] for f in response.json()["detail"]["fields"]] == ["username"]


def test_a_forgot_request_is_still_made_for_a_name_of_the_longest_allowed_size(client):
    assert client.post("/auth/forgot", json={"username": "x" * 50}).status_code == 202


def test_old_reset_requests_are_forgotten_a_day_later_but_not_before(client):
    from datetime import timedelta

    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models.password_reset import PasswordReset
    from tests.helpers import db_all

    register(client, "alice")
    client.post("/auth/forgot", json={"username": "ghost.one"})
    client.post("/auth/forgot", json={"username": "ghost.two"})
    with SessionLocal() as session:  # ghost.one is two days old, ghost.two is only an hour old
        rows = {r.requested_username: r for r in session.scalars(select(PasswordReset))}
        rows["ghost.one"].created_at -= timedelta(days=2)
        rows["ghost.two"].created_at -= timedelta(hours=1)
        session.commit()

    client.post("/auth/forgot", json={"username": "alice"})

    assert sorted(r.requested_username for r in db_all(select(PasswordReset))) == ["alice", "ghost.two"]
