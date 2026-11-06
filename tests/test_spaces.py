"""Create space, the Home page list and the Group page (balances and who owes whom)."""

import pytest
from sqlalchemy import update

from app.models.expense_split import ExpenseShare, ShareStatus
from app.models.payment import SettlementStatus
from tests.helpers import add_expense, add_settlement, auth, create_space, db_exec, error_code, register

ACCEPTED = ShareStatus.ACCEPTED
PENDING = ShareStatus.PENDING
REJECTED = ShareStatus.REJECTED


@pytest.fixture
def users(client):
    return {name: register(client, name) for name in ("alice", "bob", "carol")}


def get_space(client, tokens, space_id):
    return client.get(f"/spaces/{space_id}", headers=auth(tokens))


def balance(client, tokens, space_id) -> int:
    return get_space(client, tokens, space_id).json()["balance_minor"]


def owes(view: dict) -> list[tuple[str, str, int]]:
    """The 'who owes whom' lines as (debtor, creditor, amount_minor)."""
    return [(p["debtor"]["username"], p["creditor"]["username"], p["amount_minor"]) for p in view["pairwise"]]


# --- Create space -----------------------------------------------------------


def test_create_space_adds_the_people_in_order_and_notifies_them(client, users):
    space = create_space(client, users["alice"], "Goa Trip", ["bob", "carol"])

    assert space["name"] == "Goa Trip"
    assert [(m["username"], m["position"]) for m in space["members"]] == [
        ("alice", 1),
        ("bob", 2),
        ("carol", 3),
    ]
    cards = client.get("/notifications", headers=auth(users["bob"])).json()["items"]
    assert len(cards) == 1
    assert cards[0]["type"] == "space_added"
    assert cards[0]["space_id"] == space["id"]
    assert cards[0]["message"] == "Alice added you to ‘Goa Trip’"
    assert cards[0]["space_name"] == "Goa Trip"
    assert client.get("/notifications", headers=auth(users["alice"])).json()["items"] == []


def test_an_unknown_username_stops_everything(client, users):
    response = client.post(
        "/spaces",
        json={"name": "Trip", "icon": "trip", "usernames": ["bob", "ghost"]},
        headers=auth(users["alice"]),
    )
    assert response.status_code == 422
    assert error_code(response) == "unknown_usernames"
    assert response.json()["detail"]["usernames"] == ["ghost"]
    # nothing was saved: no space, and bob got no card
    assert client.get("/spaces", headers=auth(users["alice"])).json()["spaces"] == []
    assert client.get("/notifications", headers=auth(users["bob"])).json()["items"] == []


def test_usernames_are_cleaned_up_before_use(client, users):
    space = create_space(client, users["alice"], "Trip", ["Bob", "bob", "ALICE"])
    assert [m["username"] for m in space["members"]] == ["alice", "bob"]  # no repeats, creator not doubled
    cards = client.get("/notifications", headers=auth(users["bob"])).json()["items"]
    assert len(cards) == 1


def test_a_space_can_start_with_just_the_creator(client, users):
    space = create_space(client, users["alice"], "Solo")
    assert [m["username"] for m in space["members"]] == ["alice"]


def test_create_space_rejects_bad_input(client, users):
    headers = auth(users["alice"])
    bad_payloads = [
        {"name": "   ", "icon": "trip", "usernames": []},
        {"name": "Trip", "icon": "Bad Icon!", "usernames": []},
        {"name": "Trip", "icon": "trip", "usernames": ["not valid!"]},
        {"name": "Trip", "icon": "trip", "usernames": [f"user{i:03d}" for i in range(50)]},
    ]
    for payload in bad_payloads:
        assert client.post("/spaces", json=payload, headers=headers).status_code == 422, payload


# --- Home page --------------------------------------------------------------


def test_home_lists_my_spaces_newest_first(client, users):
    first = create_space(client, users["alice"], "First", ["bob"])
    second = create_space(client, users["alice"], "Second")
    create_space(client, users["bob"], "Not alice's")

    home = client.get("/spaces", headers=auth(users["alice"])).json()
    assert [s["id"] for s in home["spaces"]] == [second["id"], first["id"]]
    assert [s["member_count"] for s in home["spaces"]] == [1, 2]
    assert [s["currency"] for s in home["spaces"]] == ["INR", "INR"]
    assert home["overall"] == []  # nothing owed either way yet


def test_home_overall_balance_adds_up_every_space(client, users):
    one = create_space(client, users["alice"], "One", ["bob"])
    two = create_space(client, users["alice"], "Two", ["bob"])
    add_expense(one["id"], "alice", "Dinner", {"alice": ("100", ACCEPTED), "bob": ("100", ACCEPTED)})
    add_expense(two["id"], "bob", "Taxi", {"alice": ("30", ACCEPTED), "bob": ("30", ACCEPTED)})

    home = client.get("/spaces", headers=auth(users["alice"])).json()
    by_id = {s["id"]: s["balance_minor"] for s in home["spaces"]}
    assert by_id == {one["id"]: 10000, two["id"]: -3000}
    assert home["overall"] == [{"currency": "INR", "net_minor": 7000, "owe_minor": 3000, "owed_minor": 10000}]


# --- Group page -------------------------------------------------------------


def test_only_members_can_open_a_space(client, users):
    space = create_space(client, users["alice"], "Private", ["bob"])
    assert get_space(client, users["bob"], space["id"]).status_code == 200

    outsider = get_space(client, users["carol"], space["id"])
    assert outsider.status_code == 404 and error_code(outsider) == "space_not_found"
    missing = get_space(client, users["alice"], 99999)
    assert missing.status_code == 404 and error_code(missing) == "space_not_found"


def test_balances_and_who_owes_whom(client, users):
    space = create_space(client, users["alice"], "Flat", ["bob", "carol"])
    sid = space["id"]
    add_expense(
        sid,
        "alice",
        "Groceries",
        {"alice": ("100", ACCEPTED), "bob": ("100", ACCEPTED), "carol": ("100", PENDING)},
    )

    # alice paid; bob accepted his share and carol has not answered yet. A pending share counts.
    alice_view = get_space(client, users["alice"], sid).json()
    assert alice_view["balance_minor"] == 20000
    assert len(alice_view["expenses"]) == 1
    expense = alice_view["expenses"][0]
    assert (expense["description"], expense["paid_by"]["username"]) == ("Groceries", "alice")
    assert expense["my_share_minor"] == 10000 and expense["my_share_status"] == "accepted"
    assert owes(alice_view) == [("bob", "alice", 10000), ("carol", "alice", 10000)]

    assert balance(client, users["bob"], sid) == -10000  # "You owe 100"
    carol_view = get_space(client, users["carol"], sid).json()
    assert carol_view["balance_minor"] == -10000
    assert carol_view["expenses"][0]["my_share_status"] == "pending"

    # carol rejects her share: the whole expense is disputed and counts for nobody
    db_exec(update(ExpenseShare).where(ExpenseShare.username == "carol").values(status=REJECTED))
    assert [balance(client, users[name], sid) for name in ("alice", "bob", "carol")] == [0, 0, 0]
    disputed_view = get_space(client, users["alice"], sid).json()
    assert disputed_view["expenses"][0]["disputed"] is True
    assert disputed_view["pairwise"] == []

    # carol changes her mind and accepts
    db_exec(update(ExpenseShare).where(ExpenseShare.username == "carol").values(status=ACCEPTED))
    assert balance(client, users["alice"], sid) == 20000
    assert balance(client, users["carol"], sid) == -10000

    # bob pays alice back, and she confirms
    add_settlement(sid, "bob", "alice", "100", SettlementStatus.CONFIRMED)
    assert balance(client, users["bob"], sid) == 0
    assert balance(client, users["alice"], sid) == 10000
    assert owes(get_space(client, users["alice"], sid).json()) == [("carol", "alice", 10000)]


def test_a_settlement_nobody_confirmed_does_not_count(client, users):
    space = create_space(client, users["alice"], "Flat", ["bob"])
    add_expense(space["id"], "alice", "Rent", {"alice": ("50", ACCEPTED), "bob": ("50", ACCEPTED)})
    add_settlement(space["id"], "bob", "alice", "50", SettlementStatus.PENDING)
    assert balance(client, users["bob"], space["id"]) == -5000


def test_overpaying_flips_who_owes_whom(client, users):
    space = create_space(client, users["alice"], "Flat", ["bob"])
    add_expense(space["id"], "alice", "Rent", {"alice": ("50", ACCEPTED), "bob": ("50", ACCEPTED)})
    add_settlement(space["id"], "bob", "alice", "80", SettlementStatus.CONFIRMED)

    assert owes(get_space(client, users["alice"], space["id"]).json()) == [("alice", "bob", 3000)]
