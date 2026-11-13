"""The Transactions page (task 1.5): the order, the paging markers, the filters, and who sees which rows."""

import datetime as dt
import random

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.models.expense import Expense, SplitType
from app.models.expense_split import ExpenseShare, ShareStatus
from app.models.payment import Settlement, SettlementStatus
from app.services.transaction_service import EPOCH, PAYMENT, _micros
from tests.helpers import auth, create_space, error_code, register

UTC = dt.timezone.utc
ACCEPTED, PENDING, REJECTED = ShareStatus.ACCEPTED, ShareStatus.PENDING, ShareStatus.REJECTED


def at(day: int, hour: int = 0, minute: int = 0, second: int = 0, micro: int = 0) -> dt.datetime:
    """A moment on 1 to 28 November 2026 (UTC)."""
    return dt.datetime(2026, 11, day, hour, minute, second, micro, tzinfo=UTC)


@pytest.fixture
def users(client):
    return {name: register(client, name) for name in ("alice", "bob", "carol")}


@pytest.fixture
def spaces(client, users):
    """Flat: alice, bob, carol (₹). Trip: alice, bob ($). Other: bob and carol only, so alice is not in it."""
    return {
        "flat": create_space(client, users["alice"], "Flat", ["bob", "carol"]),
        "trip": create_space(client, users["alice"], "Trip", ["bob"], currency="USD"),
        "other": create_space(client, users["bob"], "Other", ["carol"]),
    }


def make_expense(space_id, paid_by, description, day, amount=3000, shares=None) -> int:
    """An expense dated `day` (a dt.date), written straight to the database. shares = {username: (amount, status)}."""
    with SessionLocal() as db:
        expense = Expense(
            space_id=space_id, paid_by=paid_by, created_by=paid_by, description=description, amount_minor=amount,
            split_type=SplitType.EQUAL, date=day,
        )
        db.add(expense)
        db.flush()
        for username, (share, status) in (shares or {}).items():
            db.add(ExpenseShare(expense_id=expense.id, username=username, amount_minor=share, status=status))
        db.commit()
        return expense.id


def make_payment(space_id, payer, payee, when, amount=1000, status=SettlementStatus.CONFIRMED) -> int:
    with SessionLocal() as db:
        payment = Settlement(space_id=space_id, payer=payer, payee=payee, amount_minor=amount, status=status, created_at=when)
        db.add(payment)
        db.commit()
        return payment.id


def ask(client, tokens, **params):
    response = client.get("/transactions", params=params, headers=auth(tokens))
    assert response.status_code == 200, response.text
    return response.json()


def keys(page) -> list[tuple[str, int]]:
    return [(row["kind"], row["id"]) for row in page["items"]]


def everything(client, tokens, limit, **params) -> list[tuple[str, int]]:
    """Follow next_before from the first page to the last, and return every row in the order it came."""
    seen, before, pages = [], None, 0
    while True:
        page = ask(client, tokens, limit=limit, **({"before": before} if before else {}), **params)
        assert len(page["items"]) <= limit
        seen += keys(page)
        before, pages = page["next_before"], pages + 1
        assert pages < 500, "next_before never ran out"
        if before is None:
            return seen


# --- What a row holds --------------------------------------------------------------------------------------


def test_an_expense_row_is_the_space_page_card_plus_the_space(client, users, spaces):
    flat = spaces["flat"]
    expense = make_expense(
        flat["id"], "alice", "Dinner", dt.date(2026, 11, 3), 3000,
        {"alice": (1000, ACCEPTED), "bob": (1000, PENDING), "carol": (1000, REJECTED)},
    )

    [row] = ask(client, users["bob"])["items"]

    assert row["kind"] == "expense" and row["id"] == expense
    assert (row["space_id"], row["space_name"], row["currency"]) == (flat["id"], "Flat", "INR")
    assert row["description"] == "Dinner" and row["amount_minor"] == 3000 and row["date"] == "2026-11-03"
    assert row["paid_by"] == {"username": "alice", "name": "Alice"}
    assert (row["my_share_minor"], row["my_share_status"]) == (1000, "pending")  # bob's own share and answer
    assert row["disputed"] is True  # carol rejected hers


def test_the_viewers_effect_comes_from_their_own_share(client, users, spaces):
    flat = spaces["flat"]
    make_expense(flat["id"], "alice", "Taxi", dt.date(2026, 11, 3), 3000, {"alice": (1500, ACCEPTED), "bob": (1500, ACCEPTED)})

    mine = ask(client, users["alice"])["items"][0]
    bobs = ask(client, users["bob"])["items"][0]
    carols = ask(client, users["carol"])["items"][0]  # in the space but not in the split

    assert mine["paid_by"]["username"] == "alice" and mine["my_share_minor"] == 1500
    assert bobs["paid_by"]["username"] == "alice" and bobs["my_share_minor"] == 1500
    assert carols["my_share_minor"] is None and carols["my_share_status"] is None  # not involved


def test_a_payment_row_is_the_space_page_row_plus_the_space(client, users, spaces):
    trip = spaces["trip"]
    payment = make_payment(trip["id"], "bob", "alice", at(5, 9, 30), 4000, SettlementStatus.PENDING)

    [row] = ask(client, users["alice"])["items"]

    assert row["kind"] == "payment" and row["id"] == payment
    assert (row["space_id"], row["space_name"], row["currency"]) == (trip["id"], "Trip", "USD")
    assert row["from_user"] == {"username": "bob", "name": "Bob"} and row["to_user"] == {"username": "alice", "name": "Alice"}
    assert row["amount_minor"] == 4000 and row["status"] == "pending" and row["answered_at"] is None


def test_no_totals_are_returned(client, users, spaces):
    make_expense(spaces["flat"]["id"], "alice", "Dinner", dt.date(2026, 11, 3), shares={"alice": (3000, ACCEPTED)})
    assert set(ask(client, users["alice"])) == {"items", "next_before"}


def test_a_person_with_no_spaces_has_an_empty_list(client):
    nobody = register(client, "carol")
    assert ask(client, nobody) == {"items": [], "next_before": None}


# --- Who sees which rows -----------------------------------------------------------------------------------


def test_every_expense_in_my_spaces_is_listed_and_none_from_other_spaces(client, users, spaces):
    in_flat = make_expense(spaces["flat"]["id"], "bob", "Rent", dt.date(2026, 11, 2), shares={"bob": (3000, ACCEPTED)})
    in_other = make_expense(spaces["other"]["id"], "bob", "Secret", dt.date(2026, 11, 2), shares={"bob": (3000, ACCEPTED)})

    assert keys(ask(client, users["alice"])) == [("expense", in_flat)]  # alice is not in "Other"
    assert sorted(keys(ask(client, users["bob"]))) == sorted([("expense", in_flat), ("expense", in_other)])


def test_only_payments_the_viewer_is_part_of_are_listed(client, users, spaces):
    between_bob_and_carol = make_payment(spaces["flat"]["id"], "bob", "carol", at(4, 10))
    paid_by_alice = make_payment(spaces["flat"]["id"], "alice", "bob", at(5, 10))
    received_by_alice = make_payment(spaces["flat"]["id"], "carol", "alice", at(6, 10))

    assert keys(ask(client, users["alice"])) == [("payment", received_by_alice), ("payment", paid_by_alice)]
    assert keys(ask(client, users["carol"])) == [("payment", received_by_alice), ("payment", between_bob_and_carol)]
    assert ("payment", between_bob_and_carol) not in keys(ask(client, users["alice"]))


def test_a_space_the_viewer_left_is_not_in_the_list(client, users, spaces):
    from app.models.group_member import SpaceMember

    make_expense(spaces["trip"]["id"], "bob", "Hotel", dt.date(2026, 11, 2), shares={"bob": (3000, ACCEPTED)})
    with SessionLocal() as db:
        db.delete(db.get(SpaceMember, (spaces["trip"]["id"], "alice")))
        db.commit()

    assert ask(client, users["alice"])["items"] == []


# --- The order ---------------------------------------------------------------------------------------------


def test_newest_first_across_both_kinds_by_the_moment_each_takes(client, users, spaces):
    flat = spaces["flat"]["id"]
    old_expense = make_expense(flat, "alice", "Old", dt.date(2026, 11, 1), shares={"alice": (3000, ACCEPTED)})
    new_expense = make_expense(flat, "alice", "New", dt.date(2026, 11, 9), shares={"alice": (3000, ACCEPTED)})
    noon_payment = make_payment(flat, "bob", "alice", at(5, 12))
    late_payment = make_payment(flat, "bob", "alice", at(9, 23, 59))

    # an expense dated the 9th starts at midnight, so a payment on the 9th, at any time, is newer than it
    assert keys(ask(client, users["alice"])) == [
        ("payment", late_payment),
        ("expense", new_expense),
        ("payment", noon_payment),
        ("expense", old_expense),
    ]


def test_a_tie_puts_a_payment_before_an_expense_then_the_higher_id_first(client, users, spaces):
    flat = spaces["flat"]["id"]
    first_expense = make_expense(flat, "alice", "A", dt.date(2026, 11, 7), shares={"alice": (3000, ACCEPTED)})
    second_expense = make_expense(flat, "alice", "B", dt.date(2026, 11, 7), shares={"alice": (3000, ACCEPTED)})
    midnight_payment = make_payment(flat, "bob", "alice", at(7))  # exactly the moment the two expenses take
    same_moment_payment = make_payment(flat, "bob", "alice", at(7))

    assert keys(ask(client, users["alice"])) == [
        ("payment", same_moment_payment),  # payments first, higher id first
        ("payment", midnight_payment),
        ("expense", second_expense),  # then the expenses, higher id first
        ("expense", first_expense),
    ]


def test_microseconds_count(client, users, spaces):
    flat = spaces["flat"]["id"]
    earlier = make_payment(flat, "bob", "alice", at(7, 10, 0, 0, 1))
    later = make_payment(flat, "bob", "alice", at(7, 10, 0, 0, 2))
    assert keys(ask(client, users["alice"])) == [("payment", later), ("payment", earlier)]


# --- Filters -----------------------------------------------------------------------------------------------


@pytest.fixture
def mixed(client, users, spaces):
    flat, trip = spaces["flat"]["id"], spaces["trip"]["id"]
    return {
        "flat_expense": make_expense(flat, "alice", "Dinner", dt.date(2026, 11, 3), shares={"alice": (3000, ACCEPTED)}),
        "trip_expense": make_expense(trip, "bob", "Hotel", dt.date(2026, 11, 4), shares={"bob": (3000, ACCEPTED)}),
        "flat_payment": make_payment(flat, "bob", "alice", at(5, 9)),
        "trip_payment": make_payment(trip, "alice", "bob", at(6, 9)),
    }


def test_kind_filters_expenses_and_payments(client, users, mixed):
    assert keys(ask(client, users["alice"], kind="expenses")) == [("expense", mixed["trip_expense"]), ("expense", mixed["flat_expense"])]
    assert keys(ask(client, users["alice"], kind="payments")) == [("payment", mixed["trip_payment"]), ("payment", mixed["flat_payment"])]
    assert len(keys(ask(client, users["alice"], kind="all"))) == 4 == len(keys(ask(client, users["alice"])))


def test_one_space_can_be_picked(client, users, spaces, mixed):
    flat = spaces["flat"]["id"]
    assert keys(ask(client, users["alice"], space_id=flat)) == [("payment", mixed["flat_payment"]), ("expense", mixed["flat_expense"])]
    assert keys(ask(client, users["alice"], space_id=flat, kind="payments")) == [("payment", mixed["flat_payment"])]
    assert ask(client, users["alice"], space_id=flat, kind="expenses")["items"][0]["space_name"] == "Flat"


def test_a_space_you_are_not_in_is_not_found(client, users, spaces):
    response = client.get("/transactions", params={"space_id": spaces["other"]["id"]}, headers=auth(users["alice"]))
    assert response.status_code == 404 and error_code(response) == "space_not_found"
    assert client.get("/transactions", params={"space_id": 99999}, headers=auth(users["alice"])).status_code == 404


@pytest.mark.parametrize(
    "params",
    [{"kind": "everything"}, {"kind": ""}, {"limit": 0}, {"limit": 101}, {"limit": "abc"}, {"space_id": 0}, {"space_id": 99999999999}, {"space_id": "x"}],
)
def test_bad_filters_are_validation_errors(client, users, params):
    response = client.get("/transactions", params=params, headers=auth(users["alice"]))
    assert response.status_code == 422 and error_code(response) == "validation_error"


def test_you_must_be_signed_in(client):
    response = client.get("/transactions")
    assert response.status_code == 401 and error_code(response) == "not_authenticated"


# --- The page marker ---------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "marker",
    [
        "abc", "", "1", "1.2", "1.0", "1.2.3", "1.0.1.1", "-1.0.1", "1.0.-1", "1.5.1",  # not a marker
        "1234567890123456789.0.1",  # 19 digits: more than any date
        "253402300800000000.0.1",  # the first microsecond of the year 10000: past the last date there is
        "999999999999999999.1.1",
        "1.0.12345678901",  # an id of 11 digits
        "٣.0.1", "1.0.١",  # digits of another script
        "1.0.1\n", " 1.0.1", "1.0.1 ",
    ],
)
def test_a_marker_that_is_not_from_this_list_is_a_validation_error_on_before(client, users, marker):
    response = client.get("/transactions", params={"before": marker}, headers=auth(users["alice"]))
    assert response.status_code == 422, marker
    assert error_code(response) == "validation_error"
    assert [f["field"] for f in response.json()["detail"]["fields"]] == ["before"]


def test_a_marker_in_the_far_past_or_future_is_fine_and_gives_the_rows_after_it(client, users, spaces):
    make_expense(spaces["flat"]["id"], "alice", "Dinner", dt.date(2026, 11, 3), shares={"alice": (3000, ACCEPTED)})
    past_everything = f"{_micros(at(1))}.{PAYMENT}.1"
    assert ask(client, users["alice"], before=past_everything)["items"] == []
    far_future = "253402300799999999.0.99"  # the last microsecond of the year 9999
    assert len(ask(client, users["alice"], before=far_future)["items"]) == 1


def test_a_marker_is_where_the_page_ended_so_the_next_page_continues_exactly_there(client, users, spaces):
    flat = spaces["flat"]["id"]
    payment = make_payment(flat, "bob", "alice", at(7, 8))
    expense = make_expense(flat, "alice", "A", dt.date(2026, 11, 7), shares={"alice": (3000, ACCEPTED)})
    older = make_payment(flat, "bob", "alice", at(6, 8))

    first = ask(client, users["alice"], limit=1)
    assert keys(first) == [("payment", payment)] and first["next_before"] == f"{_micros(at(7, 8))}.0.{payment}"
    second = ask(client, users["alice"], limit=1, before=first["next_before"])
    assert keys(second) == [("expense", expense)] and second["next_before"] == f"{_micros(at(7))}.1.{expense}"
    third = ask(client, users["alice"], limit=1, before=second["next_before"])
    assert keys(third) == [("payment", older)] and third["next_before"] is None


def test_the_last_page_has_no_marker_even_when_it_is_exactly_full(client, users, spaces):
    flat = spaces["flat"]["id"]
    for day in (1, 2, 3):
        make_payment(flat, "bob", "alice", at(day, 9))
    assert ask(client, users["alice"], limit=3)["next_before"] is None
    assert ask(client, users["alice"], limit=2)["next_before"] is not None


def test_a_row_added_between_pages_cannot_shift_or_repeat_one(client, users, spaces):
    """Paging is by marker, not by offset: a new newest row does not push an old one onto the next page."""
    flat = spaces["flat"]["id"]
    for day in range(1, 6):
        make_payment(flat, "bob", "alice", at(day, 9))
    first = ask(client, users["alice"], limit=2)

    make_payment(flat, "bob", "alice", at(20, 9))  # newer than everything: it belongs on page one, which is gone
    second = ask(client, users["alice"], limit=2, before=first["next_before"])

    assert [row["created_at"][:10] for row in second["items"]] == ["2026-11-03", "2026-11-02"]
    assert not set(keys(first)) & set(keys(second))


# --- Paging, checked against the plain way ------------------------------------------------------------------


def test_paging_returns_exactly_what_sorting_everything_would_for_any_page_size(client, users, spaces):
    """A pile of rows full of ties (same day, same moment, midnight payments) and every page size from 1 up.

    The reference is the dull way: take every row, sort by (newest first, payment before expense, higher id first), and
    cut it into pages. The marker paging must give the same rows in the same order, none skipped and none repeated.
    """
    rng = random.Random(20261110)
    flat, trip = spaces["flat"]["id"], spaces["trip"]["id"]
    days = [1, 2, 2, 3, 5, 5, 5, 8, 9, 13]
    for n in range(45):
        make_expense(rng.choice([flat, trip]), rng.choice(["alice", "bob"]), f"E{n}", dt.date(2026, 11, rng.choice(days)),
                     shares={"alice": (100, ACCEPTED)})
    moments = [at(d, h, m, 0, us) for d in days for (h, m, us) in ((0, 0, 0), (12, 30, 0), (0, 0, 1), (23, 59, 999999))]
    for n in range(55):
        payer, payee = rng.choice([("alice", "bob"), ("bob", "alice"), ("alice", "carol"), ("carol", "alice")])
        make_payment(rng.choice([flat, trip]) if "carol" not in (payer, payee) else flat, payer, payee, rng.choice(moments))

    with SessionLocal() as db:  # alice's rows: every expense in her spaces, and the payments she is part of
        expenses = db.scalars(select(Expense).where(Expense.space_id.in_([flat, trip]))).all()
        payments = db.scalars(select(Settlement).where((Settlement.payer == "alice") | (Settlement.payee == "alice"))).all()
        rows = [(_micros(dt.datetime(e.date.year, e.date.month, e.date.day, tzinfo=UTC)), 1, e.id, "expense") for e in expenses]
        rows += [(_micros(p.created_at), 0, p.id, "payment") for p in payments]
    reference = [(kind, row_id) for _, _, row_id, kind in sorted(rows, key=lambda r: (-r[0], r[1], -r[2]))]
    assert len(reference) == 100  # 45 + 55

    for limit in (1, 2, 3, 4, 5, 7, 10, 33, 50, 99, 100):
        assert everything(client, users["alice"], limit) == reference, f"limit {limit}"
    assert everything(client, users["alice"], 6, kind="expenses") == [r for r in reference if r[0] == "expense"]
    assert everything(client, users["alice"], 6, kind="payments") == [r for r in reference if r[0] == "payment"]
    flat_only = [r for r in reference if r in everything(client, users["alice"], 100, space_id=flat)]
    assert everything(client, users["alice"], 4, space_id=flat) == flat_only


def test_an_expense_marker_and_a_payment_marker_at_the_same_moment_do_not_lose_or_repeat_rows(client, users, spaces):
    """The delicate case: a payment and an expense take the very same moment (midnight), with ties on both sides."""
    flat = spaces["flat"]["id"]
    mine = {"alice": (100, ACCEPTED)}
    expenses = [make_expense(flat, "alice", f"E{n}", dt.date(2026, 11, 7), shares=mine) for n in range(3)]
    payments = [make_payment(flat, "bob", "alice", at(7)) for _ in range(3)]
    expected = [("payment", p) for p in reversed(payments)] + [("expense", e) for e in reversed(expenses)]

    for limit in (1, 2, 3, 4, 5, 6):
        assert everything(client, users["alice"], limit) == expected, f"limit {limit}"


# --- A marker is opaque, and cannot be used to see more than the viewer may ---------------------------------


def test_a_marker_from_one_person_works_for_another_but_shows_only_their_own_rows(client, users, spaces):
    flat = spaces["flat"]["id"]
    make_payment(flat, "bob", "carol", at(4, 10))  # alice may not see this one
    make_payment(flat, "alice", "bob", at(3, 10))
    marker = f"{_micros(at(9))}.0.1"

    assert [row["from_user"]["username"] for row in ask(client, users["alice"], before=marker)["items"]] == ["alice"]
    assert len(ask(client, users["carol"], before=marker)["items"]) == 1


def test_epoch_is_what_the_marker_counts_from():
    assert _micros(EPOCH) == 0 and _micros(EPOCH + dt.timedelta(seconds=1, microseconds=5)) == 1_000_005
