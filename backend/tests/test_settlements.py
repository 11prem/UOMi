"""Settle up: who can be paid, recording a payment, the receiver's answer, cancelling, and the cards they send."""

import pytest
from sqlalchemy import delete

from app.database import SessionLocal
from app.models.expense_split import ShareStatus
from app.models.group_member import SpaceMember
from app.models.notification import Notification, NotificationType
from tests.helpers import add_expense, auth, create_space, db_exec, error_code, register


@pytest.fixture
def users(client):
    return {name: register(client, name) for name in ("alice", "bob", "carol", "alex")}


@pytest.fixture
def space(client, users):
    """'Flat': alice, bob and carol, where bob owes alice ₹100 (a ₹200 dinner alice paid, split with bob)."""
    flat = create_space(client, users["alice"], "Flat", ["bob", "carol"])
    add_expense(flat["id"], "alice", "Dinner", {"alice": ("100", ShareStatus.ACCEPTED), "bob": ("100", ShareStatus.PENDING)})
    return flat


def pay(client, tokens, space_id, to="alice", amount=4000):
    return client.post(
        f"/spaces/{space_id}/settlements", json={"to_username": to, "amount_minor": amount}, headers=auth(tokens)
    )


def pay_ok(client, tokens, space_id, to="alice", amount=4000) -> dict:
    response = pay(client, tokens, space_id, to, amount)
    assert response.status_code == 201, response.text
    return response.json()


def decide(client, tokens, settlement_id, verdict):
    return client.post(f"/settlements/{settlement_id}/{verdict}", headers=auth(tokens))


def payees(client, tokens, space_id) -> list[dict]:
    response = client.get(f"/spaces/{space_id}/payees", headers=auth(tokens))
    assert response.status_code == 200, response.text
    return response.json()


def cards(client, tokens, type=None) -> list[dict]:
    items = client.get("/notifications", headers=auth(tokens)).json()["items"]
    return [c for c in items if type is None or c["type"] == type]


def balance(client, tokens, space_id) -> int:
    return client.get(f"/spaces/{space_id}", headers=auth(tokens)).json()["balance_minor"]


# --- Who can be paid (1.4.1) -------------------------------------------------------------------------


def test_payees_are_the_people_the_viewer_owes_with_the_most_that_can_be_recorded(client, users, space):
    assert payees(client, users["bob"], space["id"]) == [
        {"user": {"username": "alice", "name": "Alice"}, "owed_minor": 10000, "max_minor": 10000}
    ]


def test_someone_who_is_owed_money_has_nobody_to_pay(client, users, space):
    assert payees(client, users["alice"], space["id"]) == []
    assert payees(client, users["carol"], space["id"]) == []


def test_waiting_payments_are_taken_off_what_can_still_be_recorded(client, users, space):
    pay_ok(client, users["bob"], space["id"], amount=6000)

    [alice] = payees(client, users["bob"], space["id"])

    assert (alice["owed_minor"], alice["max_minor"]) == (10000, 4000)  # still owes ₹100 until alice confirms


def test_a_payee_whose_whole_debt_is_already_recorded_is_left_out(client, users, space):
    pay_ok(client, users["bob"], space["id"], amount=10000)

    assert payees(client, users["bob"], space["id"]) == []


def test_only_people_in_the_space_can_ask_who_to_pay(client, users, space):
    assert client.get(f"/spaces/{space['id']}/payees", headers=auth(users["alex"])).status_code == 404
    assert client.get("/spaces/9999/payees", headers=auth(users["bob"])).status_code == 404


# --- Record a payment (1.4.2) ------------------------------------------------------------------------


def test_recording_a_payment_makes_it_pending_and_asks_the_receiver(client, users, space):
    settlement = pay_ok(client, users["bob"], space["id"])

    assert settlement["status"] == "pending"
    assert settlement["amount_minor"] == 4000
    assert settlement["from_user"] == {"username": "bob", "name": "Bob"}
    assert settlement["to_user"] == {"username": "alice", "name": "Alice"}
    assert settlement["answered_at"] is None
    assert settlement["space"]["name"] == "Flat"
    [card] = cards(client, users["alice"], "payment_to_confirm")
    assert card["message"] == "Bob says they paid you ₹40"
    assert (card["needs_answer"], card["read"], card["ref_id"]) == (True, False, settlement["id"])
    assert (card["space_id"], card["space_name"]) == (space["id"], "Flat")
    assert cards(client, users["bob"], "payment_to_confirm") == []


def test_a_pending_payment_changes_no_balance(client, users, space):
    pay_ok(client, users["bob"], space["id"])

    assert balance(client, users["bob"], space["id"]) == -10000
    assert balance(client, users["alice"], space["id"]) == 10000


def test_a_payment_shows_on_the_space_page(client, users, space):
    settlement = pay_ok(client, users["bob"], space["id"])

    [row] = client.get(f"/spaces/{space['id']}", headers=auth(users["carol"])).json()["settlements"]

    assert (row["id"], row["status"], row["amount_minor"]) == (settlement["id"], "pending", 4000)


def test_the_most_you_can_record_is_what_you_owe(client, users, space):
    response = pay(client, users["bob"], space["id"], amount=10001)

    assert response.status_code == 422
    assert error_code(response) == "validation_error"
    [problem] = response.json()["detail"]["fields"]
    assert problem == {"field": "amount_minor", "message": "The most you can record is ₹100"}
    assert cards(client, users["alice"]) == []


def test_the_same_debt_cannot_be_recorded_twice(client, users, space):
    pay_ok(client, users["bob"], space["id"], amount=6000)

    too_much = pay(client, users["bob"], space["id"], amount=5000)  # ₹60 + ₹50 is more than the ₹100 owed

    assert too_much.status_code == 422
    assert too_much.json()["detail"]["fields"][0]["message"] == "The most you can record is ₹40"
    assert pay(client, users["bob"], space["id"], amount=4000).status_code == 201  # exactly what is left
    assert pay(client, users["bob"], space["id"], amount=1).status_code == 422  # nothing is left
    assert len(cards(client, users["alice"], "payment_to_confirm")) == 2


def test_a_rejected_or_cancelled_payment_frees_the_amount_again(client, users, space):
    first = pay_ok(client, users["bob"], space["id"], amount=10000)
    decide(client, users["alice"], first["id"], "reject")

    assert payees(client, users["bob"], space["id"])[0]["max_minor"] == 10000
    second = pay_ok(client, users["bob"], space["id"], amount=10000)
    client.post(f"/settlements/{second['id']}/cancel", headers=auth(users["bob"]))
    assert payees(client, users["bob"], space["id"])[0]["max_minor"] == 10000


def test_you_cannot_pay_someone_you_owe_nothing(client, users, space):
    response = pay(client, users["alice"], space["id"], to="bob")  # bob owes alice, not the other way round

    assert response.status_code == 403
    assert error_code(response) == "forbidden"
    assert response.json()["detail"]["reason"] == "owes_nothing"
    assert response.json()["detail"]["message"] == "You don’t owe Bob anything in this space"
    assert pay(client, users["bob"], space["id"], to="carol").json()["detail"]["reason"] == "owes_nothing"


@pytest.mark.parametrize("to", ["bob", "nobody.here", "alex"])
def test_you_cannot_pay_yourself_a_stranger_or_someone_outside_the_space(client, users, space, to):
    response = pay(client, users["bob"], space["id"], to=to)

    assert response.status_code == 404
    assert error_code(response) == "person_not_found"


@pytest.mark.parametrize("amount", [0, -5, 100.5, "40", True, 1_000_000_000])
def test_a_request_the_app_would_refuse_is_refused_by_the_api(client, users, space, amount):
    response = pay(client, users["bob"], space["id"], amount=amount)

    assert response.status_code == 422
    assert error_code(response) == "validation_error"
    assert "amount_minor" in [f["field"] for f in response.json()["detail"]["fields"]]


def test_a_badly_formed_username_is_refused(client, users, space):
    response = pay(client, users["bob"], space["id"], to="Al!ce")

    assert response.status_code == 422
    assert "to_username" in [f["field"] for f in response.json()["detail"]["fields"]]


def test_only_people_in_the_space_can_record_a_payment(client, users, space):
    response = pay(client, users["alex"], space["id"], to="alice")

    assert response.status_code == 404
    assert error_code(response) == "space_not_found"


def test_you_must_be_signed_in(client, space):
    assert client.post(f"/spaces/{space['id']}/settlements", json={"to_username": "alice", "amount_minor": 100}).status_code == 401
    assert client.get(f"/spaces/{space['id']}/payees").status_code == 401
    assert client.post("/settlements/1/confirm").status_code == 401


def test_someone_who_left_can_still_be_paid_what_is_owed_them(client, users, space):
    db_exec(delete(SpaceMember).where(SpaceMember.space_id == space["id"], SpaceMember.username == "alice"))

    assert [p["user"]["username"] for p in payees(client, users["bob"], space["id"])] == ["alice"]
    assert pay(client, users["bob"], space["id"], to="alice", amount=2500).status_code == 201
    # ... but a person who left and is owed nothing is simply not found
    assert pay(client, users["bob"], space["id"], to="carol").status_code == 403
    db_exec(delete(SpaceMember).where(SpaceMember.space_id == space["id"], SpaceMember.username == "carol"))
    assert error_code(pay(client, users["bob"], space["id"], to="carol")) == "person_not_found"


# --- Confirm or reject (1.4.3) -----------------------------------------------------------------------


def test_confirming_changes_the_balances_and_tells_the_payer(client, users, space):
    settlement = pay_ok(client, users["bob"], space["id"])

    result = decide(client, users["alice"], settlement["id"], "confirm")

    assert result.status_code == 200
    assert result.json()["status"] == "confirmed"
    assert result.json()["answered_at"] is not None
    assert balance(client, users["bob"], space["id"]) == -6000
    assert balance(client, users["alice"], space["id"]) == 6000
    [card] = cards(client, users["bob"], "payment_answered")
    assert card["message"] == "Alice confirmed your ₹40 payment"
    assert (card["needs_answer"], card["ref_id"]) == (False, settlement["id"])
    [question] = cards(client, users["alice"], "payment_to_confirm")
    assert (question["needs_answer"], question["read"]) == (False, True)  # the question is answered


def test_rejecting_changes_no_balance_and_tells_the_payer(client, users, space):
    settlement = pay_ok(client, users["bob"], space["id"])

    result = decide(client, users["alice"], settlement["id"], "reject")

    assert result.json()["status"] == "rejected"
    assert balance(client, users["bob"], space["id"]) == -10000
    assert cards(client, users["bob"], "payment_answered")[0]["message"] == "Alice rejected your ₹40 payment"


def test_paying_in_full_settles_the_pair(client, users, space):
    settlement = pay_ok(client, users["bob"], space["id"], amount=10000)
    decide(client, users["alice"], settlement["id"], "confirm")

    page = client.get(f"/spaces/{space['id']}", headers=auth(users["bob"])).json()

    assert page["balance_minor"] == 0
    assert page["pairwise"] == []
    assert payees(client, users["bob"], space["id"]) == []


@pytest.mark.parametrize("who", ["bob", "carol"])
def test_only_the_receiver_can_answer(client, users, space, who):
    settlement = pay_ok(client, users["bob"], space["id"])

    for verdict in ("confirm", "reject"):
        response = decide(client, users[who], settlement["id"], verdict)
        assert response.status_code == 403
        assert error_code(response) == "forbidden"
        assert response.json()["detail"]["reason"] == "not_payee"

    assert client.get(f"/settlements/{settlement['id']}", headers=auth(users["alice"])).json()["status"] == "pending"
    assert cards(client, users["bob"], "payment_answered") == []


def test_someone_outside_the_space_cannot_answer(client, users, space):
    settlement = pay_ok(client, users["bob"], space["id"])

    response = decide(client, users["alex"], settlement["id"], "confirm")

    assert response.status_code == 404
    assert error_code(response) == "settlement_not_found"


@pytest.mark.parametrize("first, second", [("confirm", "confirm"), ("confirm", "reject"), ("reject", "confirm")])
def test_a_payment_can_only_be_answered_once(client, users, space, first, second):
    settlement = pay_ok(client, users["bob"], space["id"])
    decide(client, users["alice"], settlement["id"], first)

    again = decide(client, users["alice"], settlement["id"], second)

    assert again.status_code == 403
    assert again.json()["detail"]["reason"] == "already_answered"
    assert len(cards(client, users["bob"], "payment_answered")) == 1


# --- Cancel (1.4.4) ----------------------------------------------------------------------------------


def test_cancelling_takes_the_receivers_card_away(client, users, space):
    settlement = pay_ok(client, users["bob"], space["id"])

    result = client.post(f"/settlements/{settlement['id']}/cancel", headers=auth(users["bob"]))

    assert result.status_code == 200
    assert result.json()["status"] == "cancelled"
    assert result.json()["answered_at"] is not None
    assert cards(client, users["alice"], "payment_to_confirm") == []
    assert balance(client, users["bob"], space["id"]) == -10000


def test_only_the_person_who_recorded_it_can_cancel(client, users, space):
    settlement = pay_ok(client, users["bob"], space["id"])

    for who in ("alice", "carol"):
        response = client.post(f"/settlements/{settlement['id']}/cancel", headers=auth(users[who]))
        assert response.status_code == 403
        assert response.json()["detail"]["reason"] == "not_payer"
    assert client.post(f"/settlements/{settlement['id']}/cancel", headers=auth(users["alex"])).status_code == 404
    assert len(cards(client, users["alice"], "payment_to_confirm")) == 1


def test_a_confirmed_payment_cannot_be_cancelled(client, users, space):
    settlement = pay_ok(client, users["bob"], space["id"])
    decide(client, users["alice"], settlement["id"], "confirm")

    response = client.post(f"/settlements/{settlement['id']}/cancel", headers=auth(users["bob"]))

    assert response.status_code == 403
    assert response.json()["detail"]["reason"] == "not_pending"
    assert response.json()["detail"]["message"] == "Confirmed payments can’t be cancelled"
    assert balance(client, users["bob"], space["id"]) == -6000


@pytest.mark.parametrize("how", ["reject", "cancel"])
def test_only_a_pending_payment_can_be_cancelled(client, users, space, how):
    settlement = pay_ok(client, users["bob"], space["id"])
    if how == "reject":
        decide(client, users["alice"], settlement["id"], "reject")
    else:
        client.post(f"/settlements/{settlement['id']}/cancel", headers=auth(users["bob"]))

    response = client.post(f"/settlements/{settlement['id']}/cancel", headers=auth(users["bob"]))

    assert response.status_code == 403
    assert response.json()["detail"]["message"] == "Only pending payments can be cancelled"


def test_cancelling_removes_only_this_payments_card(client, users, space):
    settlement = pay_ok(client, users["bob"], space["id"])
    other = pay_ok(client, users["bob"], space["id"], amount=1000)
    with SessionLocal() as db:  # an expense card that happens to carry the same number in ref_id
        db.add(Notification(username="alice", type=NotificationType.EXPENSE_SHARE, message="Expense", ref_id=settlement["id"]))
        db.commit()

    client.post(f"/settlements/{settlement['id']}/cancel", headers=auth(users["bob"]))

    assert [c["ref_id"] for c in cards(client, users["alice"], "payment_to_confirm")] == [other["id"]]
    assert len(cards(client, users["alice"], "expense_share")) == 1


# --- The payment screen (1.4.5) ----------------------------------------------------------------------


def test_any_member_can_open_a_payment(client, users, space):
    settlement = pay_ok(client, users["bob"], space["id"])
    decide(client, users["alice"], settlement["id"], "confirm")

    for who in ("alice", "bob", "carol"):
        detail = client.get(f"/settlements/{settlement['id']}", headers=auth(users[who])).json()
        assert detail["id"] == settlement["id"]
        assert (detail["status"], detail["amount_minor"]) == ("confirmed", 4000)
        assert detail["answered_at"] is not None
        assert detail["space"]["currency"] == "INR"


def test_only_people_in_the_space_can_open_a_payment(client, users, space):
    settlement = pay_ok(client, users["bob"], space["id"])

    response = client.get(f"/settlements/{settlement['id']}", headers=auth(users["alex"]))

    assert response.status_code == 404
    assert error_code(response) == "settlement_not_found"
    assert client.get("/settlements/9999", headers=auth(users["bob"])).status_code == 404


@pytest.mark.parametrize("path", ["/settlements/0", "/settlements/99999999999", "/settlements/abc"])
def test_a_bad_settlement_id_is_a_validation_error(client, users, path):
    assert client.get(path, headers=auth(users["bob"])).status_code == 422
