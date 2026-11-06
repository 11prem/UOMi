"""Pairwise balances, the Home page cards and the Group page contract (amounts are minor units)."""

from datetime import datetime, timedelta

import pytest
from sqlalchemy import event, update

from app.database import SessionLocal, engine, utcnow
from app.models.expense_split import ShareStatus
from app.models.group import Space
from app.models.payment import Settlement, SettlementStatus
from app.models.user import User
from app.services import balance_service
from tests.helpers import add_expense, add_settlement, auth, create_space, db_exec, register

ACCEPTED = ShareStatus.ACCEPTED
PENDING = ShareStatus.PENDING
REJECTED = ShareStatus.REJECTED

EXTRA_PHONES = {"swetha": "9876543220", "arun": "9876543221"}


@pytest.fixture
def users(client):
    people = {name: register(client, name) for name in ("alice", "bob", "carol")}
    people.update({name: register(client, name, phone) for name, phone in EXTRA_PHONES.items()})
    return people


def home(client, tokens) -> dict:
    response = client.get("/spaces", headers=auth(tokens))
    assert response.status_code == 200, response.text
    return response.json()


def card(client, tokens, space_id: int) -> dict:
    return next(c for c in home(client, tokens)["spaces"] if c["id"] == space_id)


def detail(client, tokens, space_id: int) -> dict:
    response = client.get(f"/spaces/{space_id}", headers=auth(tokens))
    assert response.status_code == 200, response.text
    return response.json()


def parse(timestamp: str) -> datetime:
    return datetime.fromisoformat(timestamp)


def dinner(space_id: int, carol_status: ShareStatus) -> None:
    """Alice pays 30000 for three, split equally."""
    add_expense(
        space_id,
        "alice",
        "Dinner",
        {"alice": ("100", PENDING), "bob": ("100", PENDING), "carol": ("100", carol_status)},
    )


def swetha_and_arun_space(client, users) -> int:
    """alice owes swetha 5000, and arun owes alice 3000."""
    space = create_space(client, users["alice"], "Flat", ["swetha", "arun"])
    add_expense(space["id"], "swetha", "Rent", {"swetha": ("50", ACCEPTED), "alice": ("50", ACCEPTED)})
    add_expense(space["id"], "alice", "Taxi", {"alice": ("30", ACCEPTED), "arun": ("30", ACCEPTED)})
    return space["id"]


# --- The balance rules ------------------------------------------------------


def test_pending_share_counts(client, users):
    space = create_space(client, users["alice"], "Flat", ["bob", "carol"])
    dinner(space["id"], PENDING)

    # the payer's own share never counts: 30000 paid, 10000 is hers, 20000 is owed to her
    assert card(client, users["alice"], space["id"])["balance_minor"] == 20000
    assert card(client, users["bob"], space["id"])["balance_minor"] == -10000


def test_disputed_expense_excluded(client, users):
    space = create_space(client, users["alice"], "Flat", ["bob", "carol"])
    dinner(space["id"], REJECTED)

    assert card(client, users["alice"], space["id"])["balance_minor"] == 0
    assert card(client, users["bob"], space["id"])["balance_minor"] == 0
    expenses = detail(client, users["alice"], space["id"])["expenses"]
    assert [e["disputed"] for e in expenses] == [True]


def test_confirmed_settlement_counts_pending_does_not(client, users):
    space = create_space(client, users["alice"], "Flat", ["bob"])
    add_expense(space["id"], "alice", "Rent", {"alice": ("100", ACCEPTED), "bob": ("100", ACCEPTED)})
    add_settlement(space["id"], "bob", "alice", "40", SettlementStatus.PENDING)
    assert card(client, users["alice"], space["id"])["balance_minor"] == 10000

    db_exec(update(Settlement).values(status=SettlementStatus.CONFIRMED))
    assert card(client, users["alice"], space["id"])["balance_minor"] == 6000
    assert card(client, users["bob"], space["id"])["balance_minor"] == -6000


@pytest.mark.parametrize("status", [SettlementStatus.REJECTED, SettlementStatus.CANCELLED])
def test_rejected_and_cancelled_settlements_do_not_count(client, users, status):
    space = create_space(client, users["alice"], "Flat", ["bob"])
    add_expense(space["id"], "alice", "Rent", {"alice": ("100", ACCEPTED), "bob": ("100", ACCEPTED)})
    add_settlement(space["id"], "bob", "alice", "40", status)
    assert card(client, users["alice"], space["id"])["balance_minor"] == 10000


def test_counterparty_side_of_net(client, users):
    space_id = swetha_and_arun_space(client, users)

    alice = card(client, users["alice"], space_id)
    assert alice["balance_minor"] == -2000
    assert alice["open_balances"] == 2
    assert alice["counterparty_count"] == 1  # only Swetha is on the "you owe" side
    assert alice["counterparty_name"] == "Swetha"

    arun = card(client, users["arun"], space_id)  # arun owes alice and has no other pair
    assert (arun["balance_minor"], arun["open_balances"]) == (-3000, 1)
    assert (arun["counterparty_count"], arun["counterparty_name"]) == (1, "Alice")


def test_counterparty_name_is_the_full_name(client):
    alice = register(client, "alice")
    response = client.post(
        "/auth/register",
        json={
            "username": "swetha",
            "name": "Swetha Rao",
            "phone": EXTRA_PHONES["swetha"],
            "password": "password123",
            "confirm_password": "password123",
        },
    )
    assert response.status_code == 201, response.text
    space = create_space(client, alice, "Flat", ["swetha"])
    add_expense(space["id"], "swetha", "Rent", {"swetha": ("50", ACCEPTED), "alice": ("50", ACCEPTED)})

    assert card(client, alice, space["id"])["counterparty_name"] == "Swetha Rao"


def test_several_counterparties_have_no_name(client, users):
    space = create_space(client, users["alice"], "Flat", ["bob", "carol"])
    add_expense(space["id"], "alice", "Dinner", {"alice": ("10", ACCEPTED), "bob": ("20", ACCEPTED), "carol": ("30", ACCEPTED)})

    alice = card(client, users["alice"], space["id"])
    assert (alice["balance_minor"], alice["open_balances"]) == (5000, 2)
    assert (alice["counterparty_count"], alice["counterparty_name"]) == (2, None)


def test_zero_net_open(client, users):
    space = create_space(client, users["alice"], "Flat", ["swetha", "arun"])
    add_expense(space["id"], "swetha", "Rent", {"swetha": ("30", ACCEPTED), "alice": ("30", ACCEPTED)})
    add_expense(space["id"], "alice", "Taxi", {"alice": ("30", ACCEPTED), "arun": ("30", ACCEPTED)})

    alice = card(client, users["alice"], space["id"])
    assert alice["balance_minor"] == 0
    assert alice["open_balances"] == 2
    assert alice["counterparty_count"] == 0
    assert alice["counterparty_name"] is None


def test_a_pair_that_cancels_out_is_not_open(client, users):
    space = create_space(client, users["alice"], "Flat", ["bob"])
    add_expense(space["id"], "alice", "Rent", {"alice": ("50", ACCEPTED), "bob": ("50", ACCEPTED)})
    add_expense(space["id"], "bob", "Taxi", {"bob": ("50", ACCEPTED), "alice": ("50", ACCEPTED)})

    alice = card(client, users["alice"], space["id"])
    assert (alice["balance_minor"], alice["open_balances"], alice["counterparty_count"]) == (0, 0, 0)
    assert detail(client, users["alice"], space["id"])["pairwise"] == []


def test_pairwise_keys_are_sorted_and_positive_means_b_owes_a(client, users):
    space = create_space(client, users["alice"], "Flat", ["bob"])
    add_expense(space["id"], "bob", "Rent", {"bob": ("10", ACCEPTED), "alice": ("10", ACCEPTED)})  # alice owes bob
    with SessionLocal() as db:
        assert balance_service.pairwise(db, space["id"]) == {("alice", "bob"): -1000}
        assert balance_service.viewer_pairs(db, space["id"], "alice") == {"bob": -1000}
        assert balance_service.viewer_pairs(db, space["id"], "bob") == {"alice": 1000}
        assert balance_service.viewer_pairs(db, space["id"], "carol") == {}  # not in the space

    add_expense(space["id"], "alice", "Taxi", {"alice": ("40", ACCEPTED), "bob": ("40", ACCEPTED)})  # now bob owes
    with SessionLocal() as db:
        assert balance_service.pairwise(db, space["id"]) == {("alice", "bob"): 3000}
        card = balance_service.space_card(db, db.get(Space, space["id"]), "alice")
        assert (card.balance_minor, card.counterparty_name) == (3000, "Bob")
        assert balance_service.overall(db, "alice")[0].net_minor == 3000


# --- Overall (Home page) ----------------------------------------------------


def test_overall_per_currency_never_summed(client, users):
    inr = create_space(client, users["alice"], "Flat", ["bob"])
    usd = create_space(client, users["alice"], "Dubai", ["carol"], currency="USD")
    add_expense(inr["id"], "bob", "Rent", {"bob": ("20", ACCEPTED), "alice": ("20", ACCEPTED)})
    add_expense(usd["id"], "alice", "Cab", {"alice": ("15", ACCEPTED), "carol": ("15", ACCEPTED)})

    assert home(client, users["alice"])["overall"] == [
        {"currency": "INR", "net_minor": -2000, "owe_minor": 2000, "owed_minor": 0},
        {"currency": "USD", "net_minor": 1500, "owe_minor": 0, "owed_minor": 1500},
    ]


def test_overall_adds_up_each_pair_not_just_the_net(client, users):
    swetha_and_arun_space(client, users)  # owe 5000 to swetha, owed 3000 by arun
    other = create_space(client, users["alice"], "Trip", ["bob"])
    add_expense(other["id"], "alice", "Hotel", {"alice": ("10", ACCEPTED), "bob": ("10", ACCEPTED)})

    assert home(client, users["alice"])["overall"] == [
        {"currency": "INR", "net_minor": -1000, "owe_minor": 5000, "owed_minor": 4000}
    ]


def test_overall_leaves_out_currencies_without_a_balance(client, users):
    create_space(client, users["alice"], "Empty", ["bob"])
    assert home(client, users["alice"])["overall"] == []


# --- Ordering and the card list ---------------------------------------------


def test_spaces_sorted_by_last_activity(client, users):
    older = create_space(client, users["alice"], "Older", ["bob"])
    newer = create_space(client, users["alice"], "Newer", ["bob"])

    def order() -> list[int]:
        return [c["id"] for c in home(client, users["alice"])["spaces"]]

    assert order() == [newer["id"], older["id"]]

    expense_time = utcnow() + timedelta(hours=1)
    add_expense(older["id"], "bob", "Taxi", {"bob": ("5", ACCEPTED), "alice": ("5", ACCEPTED)}, updated_at=expense_time)
    assert order() == [older["id"], newer["id"]]
    assert parse(card(client, users["alice"], older["id"])["last_activity_at"]) == expense_time

    answered = utcnow() + timedelta(hours=2)
    add_settlement(newer["id"], "bob", "alice", "1", SettlementStatus.CONFIRMED, answered_at=answered)
    assert order() == [newer["id"], older["id"]]
    assert parse(card(client, users["alice"], newer["id"])["last_activity_at"]) == answered


def test_a_space_with_no_activity_uses_its_creation_time(client, users):
    space = create_space(client, users["alice"], "Quiet", ["bob"])
    assert card(client, users["alice"], space["id"])["last_activity_at"] == space["created_at"]


def test_card_shape(client, users):
    space = create_space(client, users["alice"], "Flat", ["bob", "carol"])
    assert set(home(client, users["alice"])) == {"overall", "spaces"}
    only = home(client, users["alice"])["spaces"][0]
    assert set(only) == {
        "id",
        "name",
        "icon",
        "currency",
        "member_count",
        "balance_minor",
        "open_balances",
        "counterparty_name",
        "counterparty_count",
        "last_activity_at",
    }
    assert (only["id"], only["name"], only["icon"], only["currency"], only["member_count"]) == (
        space["id"],
        "Flat",
        "trip",
        "INR",
        3,
    )
    assert only["last_activity_at"].endswith("Z")


def test_the_home_page_query_count_does_not_grow_with_the_spaces(client, users):
    def count_statements() -> int:
        statements: list[str] = []

        def record(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        event.listen(engine, "before_cursor_execute", record)
        try:
            home(client, users["alice"])
        finally:
            event.remove(engine, "before_cursor_execute", record)
        return len(statements)

    def add_busy_space(n: int) -> None:
        space = create_space(client, users["alice"], f"Space {n}", ["bob", "carol"])
        add_expense(space["id"], "alice", "Dinner", {"alice": ("10", ACCEPTED), "bob": ("10", ACCEPTED)})
        add_expense(space["id"], "carol", "Taxi", {"carol": ("10", PENDING), "alice": ("10", PENDING)})
        add_settlement(space["id"], "bob", "alice", "5", SettlementStatus.CONFIRMED)

    add_busy_space(1)
    one_space = count_statements()
    for n in range(2, 6):
        add_busy_space(n)
    assert count_statements() == one_space


# --- Creating a space -------------------------------------------------------


def test_create_space_currency(client, users):
    headers = auth(users["alice"])

    def create(**extra):
        return client.post("/spaces", json={"name": "Dubai", "icon": "trip", "usernames": [], **extra}, headers=headers)

    created = create(currency="USD")
    assert created.status_code == 201, created.text
    space_id = created.json()["id"]
    assert created.json()["currency"] == "USD"
    assert card(client, users["alice"], space_id)["currency"] == "USD"
    assert detail(client, users["alice"], space_id)["currency"] == "USD"

    assert create(currency="XYZ").status_code == 422  # Task 4 adds the validation_error code
    assert create(currency="usd").status_code == 422  # codes are upper case
    assert create(currency=None).status_code == 201  # null is the same as missing

    default = create()
    assert default.status_code == 201
    assert default.json()["currency"] == "INR"

    db_exec(update(User).where(User.username == "alice").values(currency="EUR"))
    assert create().json()["currency"] == "EUR"  # follows the user's default, not a fixed value


def test_every_supported_currency_is_accepted(client, users):
    from app.currencies import SUPPORTED_CURRENCIES

    assert SUPPORTED_CURRENCIES == ("INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD")
    for code in SUPPORTED_CURRENCIES:
        assert create_space(client, users["alice"], "Space", currency=code)["currency"] == code


# --- The Group page ---------------------------------------------------------


def test_space_detail_shape(client, users):
    space = create_space(client, users["alice"], "Flat", ["bob"])
    add_expense(space["id"], "alice", "Dinner", {"alice": ("100", ACCEPTED), "bob": ("100", ACCEPTED)})
    add_settlement(space["id"], "bob", "alice", "40", SettlementStatus.CONFIRMED)

    body = detail(client, users["alice"], space["id"])
    assert set(body) == {
        "id",
        "name",
        "icon",
        "currency",
        "owner_username",
        "created_at",
        "balance_minor",
        "members",
        "expenses",
        "settlements",
        "pairwise",
    }
    assert (body["id"], body["name"], body["icon"], body["currency"]) == (space["id"], "Flat", "trip", "INR")
    assert body["owner_username"] == "alice"
    assert body["created_at"] == space["created_at"] and body["created_at"].endswith("Z")
    assert body["balance_minor"] == 6000
    assert body["members"] == [
        {"username": "alice", "name": "Alice", "position": 1},
        {"username": "bob", "name": "Bob", "position": 2},
    ]

    alice, bob = {"username": "alice", "name": "Alice"}, {"username": "bob", "name": "Bob"}
    assert len(body["expenses"]) == 1
    expense = body["expenses"][0]
    assert set(expense) == {
        "id",
        "description",
        "amount_minor",
        "split_type",
        "paid_by",
        "created_by",
        "date",
        "created_at",
        "updated_at",
        "my_share_minor",
        "my_share_status",
        "disputed",
    }
    assert (expense["description"], expense["amount_minor"], expense["split_type"]) == ("Dinner", 20000, "equal")
    assert (expense["paid_by"], expense["created_by"]) == (alice, alice)
    assert expense["date"] == utcnow().date().isoformat()
    assert expense["created_at"].endswith("Z") and expense["updated_at"].endswith("Z")
    assert (expense["my_share_minor"], expense["my_share_status"], expense["disputed"]) == (10000, "accepted", False)

    assert len(body["settlements"]) == 1
    settlement = body["settlements"][0]
    assert set(settlement) == {"id", "from_user", "to_user", "amount_minor", "status", "created_at", "answered_at"}
    assert (settlement["from_user"], settlement["to_user"]) == (bob, alice)
    assert (settlement["amount_minor"], settlement["status"], settlement["answered_at"]) == (4000, "confirmed", None)
    assert settlement["created_at"].endswith("Z")

    assert body["pairwise"] == [{"debtor": bob, "creditor": alice, "amount_minor": 6000}]


def test_my_share_is_null_when_i_have_no_share(client, users):
    space = create_space(client, users["alice"], "Flat", ["bob", "carol"])
    add_expense(space["id"], "alice", "Dinner", {"alice": ("10", ACCEPTED), "bob": ("10", ACCEPTED)})

    expense = detail(client, users["carol"], space["id"])["expenses"][0]
    assert (expense["my_share_minor"], expense["my_share_status"]) == (None, None)


def test_pairwise_lists_every_pair_in_the_space_not_just_mine(client, users):
    space = create_space(client, users["alice"], "Flat", ["bob", "carol"])
    add_expense(space["id"], "bob", "Taxi", {"bob": ("10", ACCEPTED), "carol": ("25", ACCEPTED)})

    pairs = detail(client, users["alice"], space["id"])["pairwise"]
    assert [(p["debtor"]["username"], p["creditor"]["username"], p["amount_minor"]) for p in pairs] == [
        ("carol", "bob", 2500)
    ]
    assert detail(client, users["alice"], space["id"])["balance_minor"] == 0


def test_expenses_are_capped_at_fifty_newest_first(client, users):
    space = create_space(client, users["alice"], "Flat", ["bob"])
    for n in range(55):
        add_expense(space["id"], "alice", f"Bill {n}", {"alice": ("1", ACCEPTED), "bob": ("1", ACCEPTED)})

    expenses = detail(client, users["alice"], space["id"])["expenses"]
    assert len(expenses) == 50
    assert expenses[0]["description"] == "Bill 54" and expenses[-1]["description"] == "Bill 5"
    # the cap only limits the list: the balance still counts all 55 bills
    assert detail(client, users["alice"], space["id"])["balance_minor"] == 5500
