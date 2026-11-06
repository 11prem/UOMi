"""The demo seed must give kabir.r exactly what the phone app's built-in demo data gives."""

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.models.expense import Expense
from app.models.notification import Notification
from app.models.payment import Settlement
from app.models.user import User
from scripts.seed_demo import AlreadySeeded, main, seed
from tests.helpers import auth, create_space, db_all, register

# Hard-coded from prototype/js/data.js: the script that runs seed() in Node printed these for viewer kabir.r.
# space name -> (currency, balance_minor, open_balances, counterparty_count, counterparty_name)
EXPECTED_SPACES = {
    "Flat 4B": ("INR", -47334, 2, 2, None),
    "Goa Trip": ("INR", 1014000, 2, 2, None),
    "Office lunches": ("INR", 0, 0, 0, None),
    "Dubai stopover": ("USD", 3500, 1, 1, "Meera Shah"),
    "Sunday cricket": ("INR", 0, 2, 0, None),
}
EXPECTED_OVERALL = [
    {"currency": "INR", "net_minor": 966666, "owe_minor": 87334, "owed_minor": 1054000},
    {"currency": "USD", "net_minor": 3500, "owe_minor": 0, "owed_minor": 3500},
]
# (username, type, message, space_name, needs_answer, read) in the order the rows were created: oldest first.
EXPECTED_NOTIFICATIONS = [
    ("kabir.r", "space_added", "Arun added you to ‘Goa Trip’. 4 people", "Goa Trip", False, True),
    ("swetha.i", "share_rejected", "Priya rejected their ₹600 share. ‘Beach shack lunch’ · Goa Trip", "Goa Trip", False, False),
    ("meera.s", "space_added", "Kabir added you to ‘Dubai stopover’. 2 people", "Dubai stopover", False, False),
    ("kabir.r", "payment_answered", "Priya confirmed your ₹600 payment. Office lunches", "Office lunches", False, True),
    ("kabir.r", "reminder", "You owe Arun ₹400. Sunday cricket · tap to settle up", "Sunday cricket", False, False),
    ("kabir.r", "payment_to_confirm", "Priya says they paid you. ₹2,000 · Goa Trip", "Goa Trip", True, False),
    ("kabir.r", "expense_share", "Swetha added ‘Dinner at Toit’. Your share is ₹480 · Flat 4B", "Flat 4B", True, False),
]


def sign_in_kabir(client) -> dict:
    response = client.post("/auth/login", json={"username": "kabir.r", "password": "demo1234"})
    assert response.status_code == 200, response.text
    return response.json()


def seeded_home(client) -> dict:
    return client.get("/spaces", headers=auth(sign_in_kabir(client))).json()


def card_values(home: dict) -> dict:
    return {
        c["name"]: (c["currency"], c["balance_minor"], c["open_balances"], c["counterparty_count"], c["counterparty_name"])
        for c in home["spaces"]
    }


def test_seed_matches_prototype_balances(client):
    with SessionLocal() as db:
        seed(db)

    home = seeded_home(client)
    assert card_values(home) == EXPECTED_SPACES
    assert home["overall"] == EXPECTED_OVERALL
    assert len(db_all(select(Expense))) == 10
    assert len(db_all(select(Settlement))) == 4


def test_seed_notifications(client):
    with SessionLocal() as db:
        seed(db)

    rows = db_all(select(Notification).order_by(Notification.id))
    assert [(n.username, n.type.value, n.message, n.space_name, n.needs_answer, n.read) for n in rows] == (
        EXPECTED_NOTIFICATIONS
    )
    assert all(n.space_id is not None for n in rows)

    expense_ids = {e.description: e.id for e in db_all(select(Expense))}
    settlements = db_all(select(Settlement))
    pending = next(s.id for s in settlements if s.status.value == "pending")
    answered = next(s.id for s in settlements if s.payer == "kabir.r" and s.payee == "priya.m")
    assert {n.type.value: n.ref_id for n in rows if n.ref_id is not None} == {
        "expense_share": expense_ids["Dinner at Toit"],
        "share_rejected": expense_ids["Beach shack lunch"],
        "payment_to_confirm": pending,
        "payment_answered": answered,
    }

    # newest first, as the app lists them; kabir.r has 3 unread cards
    listing = client.get("/notifications", headers=auth(sign_in_kabir(client))).json()
    assert [n["type"] for n in listing["items"]] == [
        "expense_share", "payment_to_confirm", "reminder", "payment_answered", "space_added"
    ]
    assert listing["unread_count"] == 3


def test_seed_refuses_twice_without_reset(client):
    with SessionLocal() as db:
        seed(db)
    with SessionLocal() as db, pytest.raises(AlreadySeeded):
        seed(db)

    assert main([]) == 1  # the CLI turns the refusal into exit code 1
    assert len(db_all(select(User))) == 6
    assert len(db_all(select(Expense))) == 10


def test_reset_replaces_demo_rows_and_keeps_everyone_else(client):
    assert main([]) == 0
    alice = register(client, "alice")
    create_space(client, alice, "Mine", ["kabir.r"])  # a demo user inside someone else's space

    assert main(["--reset"]) == 0

    assert card_values(seeded_home(client)) == EXPECTED_SPACES
    assert [s["name"] for s in client.get("/spaces", headers=auth(alice)).json()["spaces"]] == ["Mine"]
    assert len(db_all(select(User))) == 7
    assert len(db_all(select(Expense))) == 10
    assert len(db_all(select(Notification))) == 7  # alice's "added" card for kabir.r went with the reset
