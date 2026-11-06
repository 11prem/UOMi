"""Create space, the Home page list and the Group page (balances and who owes whom)."""

from decimal import Decimal

import pytest
from sqlalchemy import update

from app.models.expense_split import ExpenseShare, ShareStatus
from app.models.payment import SettlementStatus
from tests.helpers import add_expense, add_settlement, auth, create_space, db_exec, error_code, register

ACCEPTED = ShareStatus.ACCEPTED
PENDING = ShareStatus.PENDING


@pytest.fixture
def users(client):
    return {name: register(client, name) for name in ("alice", "bob", "carol")}


def get_space(client, tokens, space_id):
    return client.get(f"/spaces/{space_id}", headers=auth(tokens))


def balance(client, tokens, space_id) -> Decimal:
    return Decimal(get_space(client, tokens, space_id).json()["balance"])


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
    assert "Alice added you to Goa Trip" in cards[0]["body"]
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
    assert home["currency"] == "INR"
    assert [s["id"] for s in home["spaces"]] == [second["id"], first["id"]]
    assert [s["member_count"] for s in home["spaces"]] == [1, 2]
    assert Decimal(home["overall_balance"]) == 0


def test_home_overall_balance_adds_up_every_space(client, users):
    one = create_space(client, users["alice"], "One", ["bob"])
    two = create_space(client, users["alice"], "Two", ["bob"])
    add_expense(one["id"], "alice", "Dinner", {"alice": ("100", ACCEPTED), "bob": ("100", ACCEPTED)})
    add_expense(two["id"], "bob", "Taxi", {"alice": ("30", ACCEPTED), "bob": ("30", ACCEPTED)})

    home = client.get("/spaces", headers=auth(users["alice"])).json()
    by_id = {s["id"]: Decimal(s["balance"]) for s in home["spaces"]}
    assert by_id == {one["id"]: Decimal("100"), two["id"]: Decimal("-30")}
    assert Decimal(home["overall_balance"]) == Decimal("70")


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

    # alice paid; only bob has accepted his share so far
    alice_view = get_space(client, users["alice"], sid).json()
    assert Decimal(alice_view["balance"]) == 100
    assert len(alice_view["bills"]) == 1
    bill = alice_view["bills"][0]
    assert (bill["title"], bill["paid_by"]["username"]) == ("Groceries", "alice")
    assert Decimal(bill["my_share"]) == 100 and bill["my_share_status"] == "accepted"
    assert [(d["debtor"]["username"], d["creditor"]["username"], Decimal(d["amount"])) for d in alice_view["who_owes_whom"]] == [
        ("bob", "alice", Decimal("100"))
    ]

    assert balance(client, users["bob"], sid) == -100  # "You owe 100"
    carol_view = get_space(client, users["carol"], sid).json()
    assert Decimal(carol_view["balance"]) == 0  # a share still waiting for the tick does not count
    assert carol_view["bills"][0]["my_share_status"] == "pending"

    # carol ticks her share
    db_exec(update(ExpenseShare).where(ExpenseShare.username == "carol").values(status=ACCEPTED))
    assert balance(client, users["alice"], sid) == 200
    assert balance(client, users["carol"], sid) == -100

    # bob pays alice back, and she confirms
    add_settlement(sid, "bob", "alice", "100", SettlementStatus.CONFIRMED)
    assert balance(client, users["bob"], sid) == 0
    assert balance(client, users["alice"], sid) == 100
    owes = get_space(client, users["alice"], sid).json()["who_owes_whom"]
    assert [(d["debtor"]["username"], d["creditor"]["username"]) for d in owes] == [("carol", "alice")]


def test_a_settlement_nobody_confirmed_does_not_count(client, users):
    space = create_space(client, users["alice"], "Flat", ["bob"])
    add_expense(space["id"], "alice", "Rent", {"alice": ("50", ACCEPTED), "bob": ("50", ACCEPTED)})
    add_settlement(space["id"], "bob", "alice", "50", SettlementStatus.PENDING)
    assert balance(client, users["bob"], space["id"]) == -50


def test_overpaying_flips_who_owes_whom(client, users):
    space = create_space(client, users["alice"], "Flat", ["bob"])
    add_expense(space["id"], "alice", "Rent", {"alice": ("50", ACCEPTED), "bob": ("50", ACCEPTED)})
    add_settlement(space["id"], "bob", "alice", "80", SettlementStatus.CONFIRMED)

    owes = get_space(client, users["alice"], space["id"]).json()["who_owes_whom"]
    assert [(d["debtor"]["username"], d["creditor"]["username"], Decimal(d["amount"])) for d in owes] == [
        ("alice", "bob", Decimal("30"))
    ]
