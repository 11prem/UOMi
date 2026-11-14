"""Expenses: add, edit, delete, accept or reject a share, the detail page, paging, and the cards they send."""

from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from app.database import SessionLocal, utcnow
from app.models.expense_split import ExpenseShare
from app.models.notification import Notification, NotificationType
from app.models.reminder import Reminder
from app.services.reminder_service import process_due_reminders
from tests.helpers import auth, create_space, db_all, error_code, register

TODAY = utcnow().date()


@pytest.fixture
def users(client):
    return {name: register(client, name) for name in ("alice", "bob", "carol", "alex")}


@pytest.fixture
def space(client, users):
    """'Flat': alice (owner), bob and carol. Alex is a registered person who is not in it."""
    return create_space(client, users["alice"], "Flat", ["bob", "carol"])


def body(**overrides) -> dict:
    """A ₹300 dinner paid by alice, split equally three ways. Override any field."""
    payload = {
        "description": "Dinner",
        "amount_minor": 30000,
        "paid_by": "alice",
        "split_type": "equal",
        "shares": [{"username": "alice"}, {"username": "bob"}, {"username": "carol"}],
        "date": TODAY.isoformat(),
    }
    payload.update(overrides)
    return payload


def add(client, tokens, space_id, **overrides):
    return client.post(f"/spaces/{space_id}/expenses", json=body(**overrides), headers=auth(tokens))


def add_ok(client, tokens, space_id, **overrides) -> dict:
    response = add(client, tokens, space_id, **overrides)
    assert response.status_code == 201, response.text
    return response.json()


def shares_of(expense: dict) -> dict:
    return {s["user"]["username"]: (s["amount_minor"], s["status"]) for s in expense["shares"]}


def answer(client, tokens, expense_id, verdict):
    return client.post(f"/expenses/{expense_id}/{verdict}", headers=auth(tokens))


def cards(client, tokens, type=None) -> list[dict]:
    items = client.get("/notifications", headers=auth(tokens)).json()["items"]
    return [c for c in items if type is None or c["type"] == type]


def space_page(client, tokens, space_id) -> dict:
    return client.get(f"/spaces/{space_id}", headers=auth(tokens)).json()


def nothing_saved(client, users, space_id) -> None:
    """A refused expense leaves no expense and no card behind."""
    assert client.get(f"/spaces/{space_id}/expenses", headers=auth(users["alice"])).json()["items"] == []
    assert cards(client, users["bob"], "expense_share") == []


# --- Add an expense ----------------------------------------------------------------------------------


def test_the_server_works_out_every_share(client, users, space):
    expense = add_ok(client, users["alice"], space["id"], amount_minor=10000)

    assert expense["description"] == "Dinner"
    assert expense["amount_minor"] == 10000
    assert expense["split_type"] == "equal"
    assert expense["paid_by"] == {"username": "alice", "name": "Alice"}
    assert expense["created_by"] == {"username": "alice", "name": "Alice"}
    assert {k: v for k, v in expense["space"].items() if k != "created_at"} == {
        "id": space["id"],
        "name": "Flat",
        "icon": "trip",
        "currency": "INR",
        "owner_username": "alice",
    }
    assert [(m["username"], m["name"], m["position"]) for m in expense["members"]] == [
        ("alice", "Alice", 1),
        ("bob", "Bob", 2),
        ("carol", "Carol", 3),
    ]
    assert expense["disputed"] is False
    assert [s["user"]["username"] for s in expense["shares"]] == ["alice", "bob", "carol"]
    assert [s["amount_minor"] for s in expense["shares"]] == [3334, 3333, 3333]  # leftover unit to the first person


def test_the_payer_is_accepted_at_once_and_everyone_else_is_asked(client, users, space):
    expense = add_ok(client, users["alice"], space["id"])

    assert shares_of(expense) == {
        "alice": (10000, "accepted"),
        "bob": (10000, "pending"),
        "carol": (10000, "pending"),
    }
    assert expense["shares"][0]["responded_at"] is not None
    assert expense["shares"][1]["responded_at"] is None


def test_the_creator_who_did_not_pay_is_accepted_too_so_no_card_waits_on_them(client, users, space):
    expense = add_ok(client, users["bob"], space["id"], paid_by="alice")

    assert expense["created_by"]["username"] == "bob"
    assert shares_of(expense) == {
        "alice": (10000, "accepted"),  # the payer
        "bob": (10000, "accepted"),  # the creator
        "carol": (10000, "pending"),
    }
    assert len(cards(client, users["carol"], "expense_share")) == 1
    assert cards(client, users["alice"]) == [] and cards(client, users["bob"], "expense_share") == []


def test_everyone_who_must_answer_gets_a_card_saved_with_the_expense(client, users, space):
    expense = add_ok(client, users["alice"], space["id"])

    for name in ("bob", "carol"):
        [card] = cards(client, users[name], "expense_share")
        assert card["message"] == "Alice added ‘Dinner’ — your share is ₹100"
        assert card["needs_answer"] is True
        assert card["read"] is False
        assert card["ref_id"] == expense["id"]
        assert (card["space_id"], card["space_name"]) == (space["id"], "Flat")
    assert cards(client, users["alice"]) == []  # the creator is not asked about their own expense


def test_the_payer_does_not_have_to_be_in_the_split(client, users, space):
    add_ok(client, users["alice"], space["id"], shares=[{"username": "bob"}, {"username": "carol"}])

    assert space_page(client, users["alice"], space["id"])["balance_minor"] == 30000  # both of them owe all of it
    assert space_page(client, users["bob"], space["id"])["balance_minor"] == -15000


def test_a_new_expense_changes_the_balances(client, users, space):
    add_ok(client, users["alice"], space["id"])

    assert space_page(client, users["alice"], space["id"])["balance_minor"] == 20000
    assert space_page(client, users["bob"], space["id"])["balance_minor"] == -10000
    assert space_page(client, users["carol"], space["id"])["balance_minor"] == -10000


@pytest.mark.parametrize(
    "amount, split_type, typed, expected",
    [
        (10000, "exact", [40, "60.00"], [4000, 6000]),
        (10001, "percent", [50, 25, 25], [5001, 2500, 2500]),
        (10000, "percent", ["33.33", "33.33", "33.34"], [3333, 3333, 3334]),
        (30000, "shares", [2, 1, 1], [15000, 7500, 7500]),
        (10000, "shares", [None, None, None], [3334, 3333, 3333]),  # nothing typed means 1 share each
    ],
)
def test_every_split_type_gives_the_amounts_the_app_shows(client, users, space, amount, split_type, typed, expected):
    people = ["alice", "bob", "carol"][: len(typed)]
    shares = [{"username": u, "input": i} for u, i in zip(people, typed)]

    expense = add_ok(client, users["alice"], space["id"], amount_minor=amount, split_type=split_type, shares=shares)

    assert [s["amount_minor"] for s in expense["shares"]] == expected
    assert sum(expected) == amount


def test_what_was_typed_comes_back_for_the_edit_screen(client, users, space):
    shares = [{"username": "alice", "input": "33.33"}, {"username": "bob", "input": 66.67}]
    expense = add_ok(client, users["alice"], space["id"], split_type="percent", shares=shares)

    assert [s["input"] for s in expense["shares"]] == [33.33, 66.67]
    equal = add_ok(client, users["alice"], space["id"])
    assert [s["input"] for s in equal["shares"]] == [None, None, None]


def test_the_description_is_tidied(client, users, space):
    assert add_ok(client, users["alice"], space["id"], description=" Late dinner ")["description"] == "Late dinner"


REFUSED = [
    ("empty description", {"description": " "}, "description"),
    ("description over 50", {"description": "x" * 51}, "description"),
    ("zero amount", {"amount_minor": 0}, "amount_minor"),
    ("negative amount", {"amount_minor": -5}, "amount_minor"),
    ("over the limit", {"amount_minor": 1_000_000_000}, "amount_minor"),
    ("fractional minor units", {"amount_minor": 100.5}, "amount_minor"),
    ("unknown split type", {"split_type": "item"}, "split_type"),
    ("nobody in the split", {"shares": []}, "shares"),
    ("not a date", {"date": "yesterday"}, "date"),
    ("typed value with 3 decimals", {"shares": [{"username": "alice", "input": "1.005"}]}, "shares.0.input"),
    ("negative typed value", {"shares": [{"username": "alice", "input": -1}]}, "shares.0.input"),
    ("payer is not in the space", {"paid_by": "alex"}, "paid_by"),
    ("someone outside the space", {"shares": [{"username": "alice"}, {"username": "alex"}]}, "shares"),
    ("the same person twice", {"shares": [{"username": "bob"}, {"username": "bob"}]}, "shares"),
    ("a date past tomorrow", {"date": (TODAY + timedelta(days=2)).isoformat()}, "date"),
    (
        "exact amounts that do not add up",
        {"split_type": "exact", "shares": [{"username": "alice", "input": 100}, {"username": "bob", "input": 100}]},
        "shares",
    ),
    (
        "percent that is not 100",
        {"split_type": "percent", "shares": [{"username": "alice", "input": 50}, {"username": "bob", "input": 40}]},
        "shares",
    ),
    (
        "half a share",
        {"split_type": "shares", "shares": [{"username": "alice", "input": "1.5"}, {"username": "bob", "input": 1}]},
        "shares",
    ),
    (
        "zero shares",
        {"split_type": "shares", "shares": [{"username": "alice", "input": 0}, {"username": "bob", "input": 1}]},
        "shares",
    ),
    ("someone would owe nothing", {"amount_minor": 2}, "shares"),
]


@pytest.mark.parametrize("overrides, field", [(o, f) for _, o, f in REFUSED], ids=[n for n, _, _ in REFUSED])
def test_a_request_the_app_would_refuse_is_refused_by_the_api(client, users, space, overrides, field):
    response = add(client, users["alice"], space["id"], **overrides)

    assert response.status_code == 422, response.text
    assert error_code(response) == "validation_error"
    assert field in [f["field"] for f in response.json()["detail"]["fields"]]
    nothing_saved(client, users, space["id"])


def test_a_date_a_day_ahead_of_utc_is_allowed_because_of_time_zones(client, users, space):
    expense = add_ok(client, users["alice"], space["id"], date=(TODAY + timedelta(days=1)).isoformat())
    assert expense["date"] == (TODAY + timedelta(days=1)).isoformat()


def test_the_biggest_allowed_amount_is_accepted(client, users, space):
    expense = add_ok(client, users["alice"], space["id"], amount_minor=999_999_999)
    assert sum(s["amount_minor"] for s in expense["shares"]) == 999_999_999


def test_someone_outside_the_space_cannot_add_an_expense(client, users, space):
    response = add(client, users["alex"], space["id"], paid_by="alex", shares=[{"username": "alex"}])
    assert response.status_code == 404
    assert error_code(response) == "space_not_found"  # the same answer as a space that does not exist
    assert add(client, users["alice"], 9999).status_code == 404


def test_you_must_be_signed_in(client, space):
    response = client.post(f"/spaces/{space['id']}/expenses", json=body())
    assert response.status_code == 401
    assert error_code(response) == "not_authenticated"


# --- Expense detail ----------------------------------------------------------------------------------


def test_expense_detail_shows_who_paid_and_each_persons_answer(client, users, space):
    expense = add_ok(client, users["alice"], space["id"])
    answer(client, users["bob"], expense["id"], "accept")

    detail = client.get(f"/expenses/{expense['id']}", headers=auth(users["carol"])).json()

    assert detail["id"] == expense["id"]
    assert detail["paid_by"]["name"] == "Alice"
    assert shares_of(detail) == {"alice": (10000, "accepted"), "bob": (10000, "accepted"), "carol": (10000, "pending")}
    assert [s["user"]["name"] for s in detail["shares"]] == ["Alice", "Bob", "Carol"]


def test_only_people_in_the_space_can_open_an_expense(client, users, space):
    expense = add_ok(client, users["alice"], space["id"])
    response = client.get(f"/expenses/{expense['id']}", headers=auth(users["alex"]))
    assert response.status_code == 404
    assert error_code(response) == "expense_not_found"
    assert client.get("/expenses/9999", headers=auth(users["alice"])).status_code == 404


@pytest.mark.parametrize("path", ["/expenses/0", "/expenses/99999999999", "/expenses/abc"])
def test_a_bad_expense_id_is_a_validation_error(client, users, path):
    assert client.get(path, headers=auth(users["alice"])).status_code == 422


# --- The tick and the cross --------------------------------------------------------------------------


def test_accepting_clears_the_card_and_tells_nobody(client, users, space):
    expense = add_ok(client, users["alice"], space["id"])

    result = answer(client, users["bob"], expense["id"], "accept")

    assert result.status_code == 200
    assert shares_of(result.json())["bob"] == (10000, "accepted")
    assert result.json()["shares"][1]["responded_at"] is not None
    [card] = cards(client, users["bob"], "expense_share")
    assert (card["needs_answer"], card["read"]) == (False, True)
    assert cards(client, users["alice"]) == []


def test_rejecting_tells_the_creator_and_disputes_the_expense(client, users, space):
    expense = add_ok(client, users["alice"], space["id"])
    answer(client, users["bob"], expense["id"], "accept")

    result = answer(client, users["carol"], expense["id"], "reject")

    assert shares_of(result.json())["carol"] == (10000, "rejected")
    assert result.json()["disputed"] is True
    [card] = cards(client, users["alice"])
    assert card["type"] == "share_rejected"
    assert card["message"] == "Carol rejected their ₹100 share of ‘Dinner’"
    assert card["ref_id"] == expense["id"]
    assert (card["needs_answer"], card["space_name"]) == (False, "Flat")
    assert cards(client, users["carol"], "expense_share")[0]["needs_answer"] is False  # the question is answered


def test_a_disputed_expense_stays_visible_but_stops_counting(client, users, space):
    expense = add_ok(client, users["alice"], space["id"])
    answer(client, users["carol"], expense["id"], "reject")

    page = space_page(client, users["bob"], space["id"])
    assert page["balance_minor"] == 0
    assert page["pairwise"] == []
    assert [(e["id"], e["disputed"], e["my_share_status"]) for e in page["expenses"]] == [(expense["id"], True, "pending")]
    assert space_page(client, users["alice"], space["id"])["balance_minor"] == 0


def test_changing_your_mind_lifts_the_dispute(client, users, space):
    expense = add_ok(client, users["alice"], space["id"])
    answer(client, users["carol"], expense["id"], "reject")

    result = answer(client, users["carol"], expense["id"], "accept")

    assert result.json()["disputed"] is False
    assert space_page(client, users["alice"], space["id"])["balance_minor"] == 20000
    assert len(cards(client, users["alice"], "share_rejected")) == 1  # accepting adds no card


def test_rejecting_again_after_changing_your_mind_tells_the_creator_again(client, users, space):
    expense = add_ok(client, users["alice"], space["id"])
    for verdict in ("reject", "accept", "reject"):
        answer(client, users["carol"], expense["id"], verdict)

    assert len(cards(client, users["alice"], "share_rejected")) == 2


def test_giving_the_same_answer_again_changes_nothing(client, users, space):
    expense = add_ok(client, users["alice"], space["id"])

    first = answer(client, users["carol"], expense["id"], "reject").json()["shares"][2]["responded_at"]
    again = answer(client, users["carol"], expense["id"], "reject")

    assert again.status_code == 200
    assert again.json()["shares"][2]["responded_at"] == first
    assert len(cards(client, users["alice"], "share_rejected")) == 1


def test_only_the_person_whose_share_it_is_can_answer(client, users, space):
    expense = add_ok(client, users["alice"], space["id"], shares=[{"username": "alice"}, {"username": "bob"}])

    outsider_in_space = answer(client, users["carol"], expense["id"], "reject")  # a member, but not in this split
    assert outsider_in_space.status_code == 403
    assert error_code(outsider_in_space) == "forbidden"
    assert outsider_in_space.json()["detail"]["reason"] == "not_your_share"

    assert answer(client, users["alex"], expense["id"], "reject").status_code == 404  # not in the space at all
    assert cards(client, users["alice"]) == []
    assert shares_of(client.get(f"/expenses/{expense['id']}", headers=auth(users["bob"])).json())["bob"][1] == "pending"


@pytest.mark.parametrize("who", ["alice", "bob"])
def test_your_own_share_is_accepted_automatically(client, users, space, who):
    expense = add_ok(client, users["bob"], space["id"], paid_by="alice")  # alice paid, bob created it

    response = answer(client, users[who], expense["id"], "reject")

    assert response.status_code == 403
    assert response.json()["detail"]["reason"] == "own_share"
    assert shares_of(client.get(f"/expenses/{expense['id']}", headers=auth(users["bob"])).json())[who][1] == "accepted"


# --- Edit ---------------------------------------------------------------------------------------------


def test_only_the_creator_can_edit(client, users, space):
    expense = add_ok(client, users["alice"], space["id"])

    response = client.put(f"/expenses/{expense['id']}", json=body(description="Lunch"), headers=auth(users["bob"]))

    assert response.status_code == 403
    assert response.json()["detail"]["reason"] == "not_creator"
    assert client.get(f"/expenses/{expense['id']}", headers=auth(users["bob"])).json()["description"] == "Dinner"
    assert client.put(f"/expenses/{expense['id']}", json=body(), headers=auth(users["alex"])).status_code == 404


def test_editing_resets_every_answer_and_asks_everyone_again(client, users, space):
    expense = add_ok(client, users["alice"], space["id"])
    answer(client, users["bob"], expense["id"], "accept")
    answer(client, users["carol"], expense["id"], "reject")

    response = client.put(
        f"/expenses/{expense['id']}", json=body(amount_minor=60000, description="Big dinner"), headers=auth(users["alice"])
    )

    assert response.status_code == 200, response.text
    edited = response.json()
    assert edited["id"] == expense["id"]
    assert edited["description"] == "Big dinner"
    assert shares_of(edited) == {"alice": (20000, "accepted"), "bob": (20000, "pending"), "carol": (20000, "pending")}
    assert edited["disputed"] is False  # the creator's edit ends the dispute
    for name in ("bob", "carol"):
        [card] = cards(client, users[name], "expense_share")  # the old card is replaced, not repeated
        assert card["message"] == "Alice added ‘Big dinner’ — your share is ₹200"
        assert (card["needs_answer"], card["read"], card["ref_id"]) == (True, False, expense["id"])
    assert space_page(client, users["alice"], space["id"])["balance_minor"] == 40000


def test_an_edit_can_change_the_payer_the_people_and_the_split_type(client, users, space):
    expense = add_ok(client, users["alice"], space["id"])

    shares = [{"username": "alice", "input": 100}, {"username": "bob", "input": 200}]
    edited = client.put(
        f"/expenses/{expense['id']}",
        json=body(paid_by="bob", split_type="exact", shares=shares),
        headers=auth(users["alice"]),
    ).json()

    assert edited["split_type"] == "exact"
    assert edited["paid_by"]["username"] == "bob"
    assert edited["created_by"]["username"] == "alice"  # an edit does not change who added it
    assert shares_of(edited) == {"alice": (10000, "accepted"), "bob": (20000, "accepted")}
    assert cards(client, users["carol"], "expense_share") == []  # carol is out of the split, her old card is gone
    assert cards(client, users["bob"], "expense_share") == []  # bob paid, so there is nothing to answer


def test_an_edit_moves_updated_at_and_keeps_the_rest_of_the_history(client, users, space):
    expense = add_ok(client, users["alice"], space["id"])
    answer(client, users["carol"], expense["id"], "reject")

    edited = client.put(f"/expenses/{expense['id']}", json=body(), headers=auth(users["alice"])).json()

    assert edited["updated_at"] > expense["updated_at"]
    assert edited["created_at"] == expense["created_at"]
    assert len(cards(client, users["alice"], "share_rejected")) == 1  # what carol said stays in alice's history


def test_a_refused_edit_changes_nothing(client, users, space):
    expense = add_ok(client, users["alice"], space["id"])

    response = client.put(f"/expenses/{expense['id']}", json=body(amount_minor=0), headers=auth(users["alice"]))
    outsider = client.put(
        f"/expenses/{expense['id']}", json=body(shares=[{"username": "alex"}]), headers=auth(users["alice"])
    )

    assert response.status_code == outsider.status_code == 422
    unchanged = client.get(f"/expenses/{expense['id']}", headers=auth(users["alice"])).json()
    assert unchanged["amount_minor"] == 30000
    assert shares_of(unchanged)["bob"] == (10000, "pending")
    assert len(cards(client, users["bob"], "expense_share")) == 1


# --- Delete -------------------------------------------------------------------------------------------


def test_only_the_creator_can_delete(client, users, space):
    expense = add_ok(client, users["alice"], space["id"])

    response = client.delete(f"/expenses/{expense['id']}", headers=auth(users["bob"]))

    assert response.status_code == 403
    assert response.json()["detail"]["reason"] == "not_creator"
    assert client.get(f"/expenses/{expense['id']}", headers=auth(users["bob"])).status_code == 200
    assert client.delete(f"/expenses/{expense['id']}", headers=auth(users["alex"])).status_code == 404


def test_deleting_recalculates_balances_and_leaves_no_card_asking_about_it(client, users, space):
    expense = add_ok(client, users["alice"], space["id"])
    answer(client, users["carol"], expense["id"], "reject")

    response = client.delete(f"/expenses/{expense['id']}", headers=auth(users["alice"]))

    assert response.status_code == 204
    assert response.content == b""
    assert client.get(f"/expenses/{expense['id']}", headers=auth(users["alice"])).status_code == 404
    assert space_page(client, users["alice"], space["id"])["expenses"] == []
    assert space_page(client, users["bob"], space["id"])["balance_minor"] == 0
    for name in ("alice", "bob", "carol"):
        assert cards(client, users[name], "expense_share") == [] and cards(client, users[name], "share_rejected") == []
    assert db_all(select(ExpenseShare)) == []


def test_deleting_leaves_other_cards_that_happen_to_share_the_id(client, users, space):
    """`ref_id` is an expense id for share cards and a settlement id for payment cards."""
    expense = add_ok(client, users["alice"], space["id"])
    other = add_ok(client, users["alice"], space["id"], description="Taxi")
    with SessionLocal() as db:
        db.add(Notification(username="bob", type=NotificationType.PAYMENT_TO_CONFIRM, message="Payment", ref_id=expense["id"]))
        db.commit()

    client.delete(f"/expenses/{expense['id']}", headers=auth(users["alice"]))

    assert [c["type"] for c in cards(client, users["bob"], "payment_to_confirm")] == ["payment_to_confirm"]
    assert [c["ref_id"] for c in cards(client, users["bob"], "expense_share")] == [other["id"]]  # the other expense's card stays


def test_deleting_and_editing_take_the_reminder_log_with_them(client, users, space):
    expense = add_ok(client, users["alice"], space["id"])
    answer(client, users["bob"], expense["id"], "accept")
    with SessionLocal() as db:
        share = db.scalar(select(ExpenseShare).where(ExpenseShare.username == "bob"))
        db.add(Reminder(expense_share_id=share.id, reminder_day=3))
        db.commit()

    client.put(f"/expenses/{expense['id']}", json=body(), headers=auth(users["alice"]))
    assert db_all(select(Reminder)) == []  # answers were reset, so the reminder clock starts again

    answer(client, users["bob"], expense["id"], "accept")
    with SessionLocal() as db:
        share = db.scalar(select(ExpenseShare).where(ExpenseShare.username == "bob"))
        db.add(Reminder(expense_share_id=share.id, reminder_day=3))
        db.commit()
    client.delete(f"/expenses/{expense['id']}", headers=auth(users["alice"]))
    assert db_all(select(Reminder)) == []


# --- The list, page by page ---------------------------------------------------------------------------


def make_expenses(client, users, space_id, count) -> list[int]:
    return [add_ok(client, users["alice"], space_id, description=f"Bill {n}")["id"] for n in range(1, count + 1)]


def test_the_list_pages_newest_first_until_the_last_one(client, users, space):
    ids = make_expenses(client, users, space["id"], 5)

    def page(**params):
        response = client.get(f"/spaces/{space['id']}/expenses", params=params, headers=auth(users["bob"]))
        assert response.status_code == 200, response.text
        return response.json()

    first = page(limit=2)
    assert [e["id"] for e in first["items"]] == [ids[4], ids[3]]
    assert first["next_before"] == ids[3]
    second = page(limit=2, before=first["next_before"])
    assert [e["id"] for e in second["items"]] == [ids[2], ids[1]]
    third = page(limit=2, before=second["next_before"])
    assert [e["id"] for e in third["items"]] == [ids[0]]
    assert third["next_before"] is None
    assert page(limit=5)["next_before"] is None  # exactly one full page has no next page


def test_a_space_with_more_than_fifty_expenses_is_fully_reachable(client, users, space):
    ids = make_expenses(client, users, space["id"], 53)

    assert len(space_page(client, users["alice"], space["id"])["expenses"]) == 50  # the space page shows the latest 50
    everything, before = [], None
    while True:
        params = {"limit": 100} if before is None else {"limit": 100, "before": before}
        result = client.get(f"/spaces/{space['id']}/expenses", params=params, headers=auth(users["alice"])).json()
        everything += [e["id"] for e in result["items"]]
        before = result["next_before"]
        if before is None:
            break
    assert everything == ids[::-1]


def test_each_list_row_shows_my_part_and_whether_it_is_disputed(client, users, space):
    expense = add_ok(client, users["alice"], space["id"])
    answer(client, users["carol"], expense["id"], "reject")

    [bob_row] = client.get(f"/spaces/{space['id']}/expenses", headers=auth(users["bob"])).json()["items"]
    [alice_row] = client.get(f"/spaces/{space['id']}/expenses", headers=auth(users["alice"])).json()["items"]

    assert (bob_row["my_share_minor"], bob_row["my_share_status"], bob_row["disputed"]) == (10000, "pending", True)
    assert (alice_row["my_share_minor"], alice_row["my_share_status"]) == (10000, "accepted")
    assert bob_row["paid_by"]["name"] == "Alice"


def test_the_list_is_only_for_people_in_the_space(client, users, space):
    assert client.get(f"/spaces/{space['id']}/expenses", headers=auth(users["alex"])).status_code == 404
    assert client.get("/spaces/9999/expenses", headers=auth(users["alice"])).status_code == 404


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}, {"before": 0}])
def test_the_list_has_limits(client, users, space, params):
    assert client.get(f"/spaces/{space['id']}/expenses", params=params, headers=auth(users["alice"])).status_code == 422


# --- Reminders work on expenses made through the API ---------------------------------------------------


def run_reminders(now: datetime) -> int:
    with SessionLocal() as db:
        return process_due_reminders(db, now)


def test_a_share_accepted_through_the_api_gets_the_day_three_reminder(client, users, space):
    expense = add_ok(client, users["alice"], space["id"], shares=[{"username": "alice"}, {"username": "bob"}], amount_minor=20000)
    answer(client, users["bob"], expense["id"], "accept")

    assert run_reminders(utcnow() + timedelta(days=2)) == 0
    assert run_reminders(utcnow() + timedelta(days=3, minutes=1)) == 1

    [card] = cards(client, users["bob"], "reminder")
    assert card["message"] == "You owe Alice ₹100. Flat · tap to settle up"


def test_a_pending_share_gets_no_reminder_until_it_is_accepted(client, users, space):
    add_ok(client, users["alice"], space["id"], shares=[{"username": "alice"}, {"username": "bob"}], amount_minor=20000)

    assert run_reminders(utcnow() + timedelta(days=30)) == 0


def test_the_creator_who_did_not_pay_is_reminded_to_pay_the_payer(client, users, space):
    add_ok(client, users["bob"], space["id"], paid_by="alice", shares=[{"username": "alice"}, {"username": "bob"}], amount_minor=20000)

    assert run_reminders(utcnow() + timedelta(days=3, minutes=1)) == 1

    assert [c["message"] for c in cards(client, users["bob"], "reminder")] == ["You owe Alice ₹100. Flat · tap to settle up"]
