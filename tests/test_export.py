"""Export my data (task 1.7.3): a JSON file of what the signed-in person is entitled to see, and nothing else."""

import json

import pytest

from app.config import settings
from app.models.expense_split import ShareStatus
from app.models.payment import SettlementStatus
from app.schemas.export import DataExport
from tests.helpers import PASSWORD, PHONES, add_expense, add_settlement, auth, create_space, error_code, register


@pytest.fixture
def users(client):
    return {name: register(client, name) for name in ("alice", "bob", "carol")}


def export(client, tokens):
    return client.get("/users/me/export", headers=auth(tokens))


@pytest.fixture
def flat(client, users):
    """'Flat': alice, bob and carol. Alice paid a ₹200 dinner split with bob; bob has paid ₹40 of it back (confirmed)."""
    space = create_space(client, users["alice"], "Flat", ["bob", "carol"])
    add_expense(space["id"], "alice", "Dinner", {"alice": ("100", ShareStatus.ACCEPTED), "bob": ("100", ShareStatus.ACCEPTED)})
    add_settlement(space["id"], "bob", "alice", "40", SettlementStatus.CONFIRMED)
    return space


# --- What is in it ----------------------------------------------------------------------------------


def test_the_export_holds_the_profile_the_spaces_and_the_cards(client, users, flat):
    response = export(client, users["alice"])

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"exported_at", "profile", "spaces", "notifications"}
    assert body["profile"] == {
        "username": "alice", "name": "Alice", "phone": "+919876543210", "currency": "INR",
        "notifications_on": True, "created_at": body["profile"]["created_at"],
    }
    [space] = body["spaces"]
    assert (space["name"], space["owner_username"], space["currency"]) == ("Flat", "alice", "INR")
    assert [(m["username"], m["name"]) for m in space["members"]] == [("alice", "Alice"), ("bob", "Bob"), ("carol", "Carol")]
    [dinner] = space["expenses"]
    assert (dinner["description"], dinner["amount_minor"], dinner["paid_by"]["name"]) == ("Dinner", 20000, "Alice")
    assert {s["user"]["username"]: (s["amount_minor"], s["status"]) for s in dinner["shares"]} == {
        "alice": (10000, "accepted"), "bob": (10000, "accepted"),
    }
    [payment] = space["settlements"]
    assert (payment["from_user"]["username"], payment["to_user"]["username"], payment["amount_minor"], payment["status"]) == ("bob", "alice", 4000, "confirmed")


def test_it_includes_the_persons_own_cards(client, users, flat):
    body = export(client, users["bob"]).json()  # bob got the "alice added you" card

    assert [n["type"] for n in body["notifications"]] == ["space_added"]
    assert "Flat" in body["notifications"][0]["message"]
    assert export(client, users["alice"]).json()["notifications"] == []  # alice has none


def test_it_is_a_file_download_and_valid_json_of_the_documented_shape(client, users, flat):
    response = export(client, users["alice"])

    assert response.headers["content-disposition"] == 'attachment; filename="uomi-export-alice.json"'
    assert response.headers["content-type"].startswith("application/json")
    assert DataExport.model_validate(json.loads(response.text)).profile.username == "alice"  # the file reads back as it was written


def test_a_person_with_nothing_yet_gets_an_empty_export(client, users):
    body = export(client, users["carol"]).json()

    assert body["spaces"] == [] and body["notifications"] == [] and body["profile"]["username"] == "carol"


def test_the_export_is_the_same_data_the_space_page_shows(client, users, flat):
    page = client.get(f"/spaces/{flat['id']}", headers=auth(users["alice"])).json()
    [space] = export(client, users["alice"]).json()["spaces"]

    assert [e["id"] for e in space["expenses"]] == [e["id"] for e in page["expenses"]]
    assert [s["id"] for s in space["settlements"]] == [s["id"] for s in page["settlements"]]


# --- Only what the person may see -------------------------------------------------------------------


def test_a_space_the_person_is_not_in_is_not_in_the_export(client, users, flat):
    other = create_space(client, users["bob"], "Bob and Carol", ["carol"])
    add_expense(other["id"], "bob", "Secret", {"bob": ("5", ShareStatus.ACCEPTED), "carol": ("5", ShareStatus.ACCEPTED)})

    alice = export(client, users["alice"]).json()

    assert [s["name"] for s in alice["spaces"]] == ["Flat"]
    assert "Secret" not in json.dumps(alice) and "Bob and Carol" not in json.dumps(alice)


def test_a_space_the_person_has_left_is_gone_from_it(client, users, flat):
    add_settlement(flat["id"], "bob", "alice", "60", SettlementStatus.CONFIRMED)  # settled up, so bob may leave
    assert client.post(f"/spaces/{flat['id']}/leave", headers=auth(users["bob"])).status_code == 204

    assert export(client, users["bob"]).json()["spaces"] == []
    assert [s["name"] for s in export(client, users["alice"]).json()["spaces"]] == ["Flat"]


def test_nobody_elses_phone_number_password_or_token_is_in_it(client, users, flat):
    text = export(client, users["alice"]).text

    assert PHONES["alice"] in text or "+919876543210" in text  # her own number is
    for other in ("bob", "carol"):
        assert PHONES[other] not in text and "+91" + PHONES[other] not in text
    for forbidden_word in ("password", "token", "hash", PASSWORD):
        assert forbidden_word not in text.lower()


def test_each_person_gets_their_own_export(client, users, flat):
    alice, bob = export(client, users["alice"]).json(), export(client, users["bob"]).json()

    assert alice["profile"]["username"] == "alice" and bob["profile"]["username"] == "bob"
    assert alice["notifications"] != bob["notifications"]


def test_someone_whose_account_was_deleted_is_named_as_such(client, users):
    space = create_space(client, users["alice"], "Pair", ["bob"])
    add_expense(space["id"], "bob", "Gas", {"alice": ("30", ShareStatus.ACCEPTED), "bob": ("30", ShareStatus.ACCEPTED)})
    add_settlement(space["id"], "alice", "bob", "30", SettlementStatus.CONFIRMED)
    assert client.post("/users/me/delete", json={"password": PASSWORD}, headers=auth(users["bob"])).status_code == 204

    [pair] = export(client, users["alice"]).json()["spaces"]

    assert pair["expenses"][0]["paid_by"] == {"username": "bob", "name": "Deleted user"}
    assert "Bob" not in json.dumps(pair["expenses"]) and PHONES["bob"] not in json.dumps(pair)


# --- Signed in, and not too often -------------------------------------------------------------------


def test_you_must_be_signed_in(client):
    response = client.get("/users/me/export")

    assert response.status_code == 401 and error_code(response) == "not_authenticated"


def test_exports_are_limited_per_person_per_hour(client, users, flat, monkeypatch):
    monkeypatch.setattr(settings, "EXPORT_MAX_PER_USER_PER_HOUR", 2)

    assert [export(client, users["alice"]).status_code for _ in range(2)] == [200, 200]
    limited = export(client, users["alice"])

    assert limited.status_code == 429 and error_code(limited) == "too_many_requests" and "Retry-After" in limited.headers
    assert export(client, users["bob"]).status_code == 200  # the limit is hers alone
