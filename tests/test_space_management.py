"""Space management (task 1.2, specs § 10 and § 10.1): rename, currency, add people, remove, leave, delete."""

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.models.expense import Expense
from app.models.expense_split import ExpenseShare, ShareStatus
from app.models.group import Space
from app.models.group_member import SpaceMember
from app.models.notification import Notification, NotificationType
from app.models.payment import Settlement, SettlementStatus
from app.models.reminder import Reminder
from app.models.user import User
from tests.helpers import add_expense, add_settlement, auth, create_space, db_all, error_code, register

ACCEPTED, PENDING, REJECTED = ShareStatus.ACCEPTED, ShareStatus.PENDING, ShareStatus.REJECTED
CONFIRMED = SettlementStatus.CONFIRMED


@pytest.fixture
def users(client):
    return {name: register(client, name) for name in ("alice", "bob", "carol", "alex")}


@pytest.fixture
def space(client, users):
    """'Flat': alice (the owner), bob and carol. Alex is registered but is not in it."""
    return create_space(client, users["alice"], "Flat", ["bob", "carol"])


def patch(client, tokens, space_id, **body):
    return client.patch(f"/spaces/{space_id}", json=body, headers=auth(tokens))


def add_people(client, tokens, space_id, *names):
    return client.post(f"/spaces/{space_id}/members", json={"usernames": list(names)}, headers=auth(tokens))


def remove(client, tokens, space_id, name):
    return client.delete(f"/spaces/{space_id}/members/{name}", headers=auth(tokens))


def leave(client, tokens, space_id):
    return client.post(f"/spaces/{space_id}/leave", headers=auth(tokens))


def delete(client, tokens, space_id):
    return client.delete(f"/spaces/{space_id}", headers=auth(tokens))


def page(client, tokens, space_id):
    return client.get(f"/spaces/{space_id}", headers=auth(tokens))


def member_names(detail: dict) -> list[str]:
    return [m["username"] for m in detail["members"]]


def cards(client, tokens, type=None) -> list[dict]:
    items = client.get("/notifications", headers=auth(tokens)).json()["items"]
    return [c for c in items if type is None or c["type"] == type]


def owes(space_id, debtor="bob", creditor="alice", amount="100"):
    """`debtor` owes `creditor` the amount in this space (an accepted share of a bill the creditor paid)."""
    add_expense(space_id, creditor, "Dinner", {creditor: (amount, ACCEPTED), debtor: (amount, ACCEPTED)})


def settle(space_id, payer="bob", payee="alice", amount="100"):
    add_settlement(space_id, payer, payee, amount, CONFIRMED)


def forbidden_reason(response) -> str:
    assert response.status_code == 403, response.text
    assert error_code(response) == "forbidden"
    return response.json()["detail"]["reason"]


# --- Rename and icon (1.2.1) --------------------------------------------------------------------------------


def test_any_member_can_rename_the_space_and_change_its_icon(client, users, space):
    response = patch(client, users["bob"], space["id"], name="  Flat 4B ", icon="home")  # bob is not the owner

    assert response.status_code == 200
    body = response.json()
    assert (body["name"], body["icon"], body["currency"]) == ("Flat 4B", "home", "INR")  # the name is tidied
    assert page(client, users["carol"], space["id"]).json()["name"] == "Flat 4B"


def test_a_field_left_out_or_null_is_left_alone(client, users, space):
    assert patch(client, users["alice"], space["id"], icon="food").json()["name"] == "Flat"
    assert patch(client, users["alice"], space["id"], name=None, icon=None, currency=None).json()["icon"] == "food"
    assert patch(client, users["alice"], space["id"]).status_code == 200  # nothing to change is not an error


@pytest.mark.parametrize(
    "body, field",
    [
        ({"name": "n" * 31}, "name"),
        ({"name": "   "}, "name"),
        ({"name": ""}, "name"),
        ({"icon": "rocket"}, "icon"),
        ({"icon": "TRIP"}, "icon"),
        ({"currency": "XYZ"}, "currency"),
        ({"currency": "inr"}, "currency"),
    ],
)
def test_the_same_limits_as_creating_apply(client, users, space, body, field):
    response = patch(client, users["alice"], space["id"], **body)
    assert response.status_code == 422 and error_code(response) == "validation_error"
    assert field in [f["field"] for f in response.json()["detail"]["fields"]]
    assert page(client, users["alice"], space["id"]).json()["name"] == "Flat"  # nothing changed


def test_a_name_of_exactly_thirty_characters_is_fine(client, users, space):
    assert patch(client, users["alice"], space["id"], name="n" * 30).status_code == 200


def test_someone_outside_the_space_cannot_edit_it(client, users, space):
    response = patch(client, users["alex"], space["id"], name="Mine now")
    assert response.status_code == 404 and error_code(response) == "space_not_found"  # the space does not exist for them
    assert patch(client, users["alice"], 99999, name="x").status_code == 404
    assert page(client, users["alice"], space["id"]).json()["name"] == "Flat"


def test_every_space_management_call_needs_a_sign_in_and_a_sane_id(client, users, space):
    sid = space["id"]
    assert [client.patch(f"/spaces/{sid}", json={}).status_code, client.delete(f"/spaces/{sid}").status_code,
            client.post(f"/spaces/{sid}/leave").status_code, client.post(f"/spaces/{sid}/members", json={"usernames": ["alex"]}).status_code,
            client.delete(f"/spaces/{sid}/members/bob").status_code] == [401] * 5
    for path in ("/spaces/0", "/spaces/99999999999", "/spaces/abc"):
        assert client.patch(path, json={}, headers=auth(users["alice"])).status_code == 422
        assert client.delete(path, headers=auth(users["alice"])).status_code == 422


# --- The currency (1.2.2) ------------------------------------------------------------------------------------


def test_the_owner_can_change_the_currency_before_any_expense(client, users, space):
    response = patch(client, users["alice"], space["id"], currency="USD")
    assert response.status_code == 200 and response.json()["currency"] == "USD"
    assert page(client, users["bob"], space["id"]).json()["currency"] == "USD"


def test_only_the_owner_can_change_the_currency(client, users, space):
    response = patch(client, users["bob"], space["id"], currency="USD")

    assert forbidden_reason(response) == "not_owner"
    assert response.json()["detail"]["message"] == "Only the owner can change the currency"
    assert page(client, users["alice"], space["id"]).json()["currency"] == "INR"


def test_naming_the_current_currency_is_not_a_change_so_any_member_may(client, users, space):
    assert patch(client, users["bob"], space["id"], currency="INR", name="Flat 4B").status_code == 200


def test_after_the_first_expense_the_currency_is_locked_with_a_specific_error(client, users, space):
    owes(space["id"])

    response = patch(client, users["alice"], space["id"], currency="USD")

    assert forbidden_reason(response) == "has_expenses"
    assert response.json()["detail"]["message"] == "Can’t change after expenses are added"
    assert page(client, users["alice"], space["id"]).json()["currency"] == "INR"


def test_the_currency_is_free_again_when_the_expenses_are_gone(client, users, space):
    expense = client.post(
        f"/spaces/{space['id']}/expenses",
        json={"description": "Tea", "amount_minor": 1000, "paid_by": "alice", "split_type": "equal",
              "shares": [{"username": "alice"}, {"username": "bob"}], "date": "2026-01-01"},
        headers=auth(users["alice"]),
    ).json()
    assert forbidden_reason(patch(client, users["alice"], space["id"], currency="USD")) == "has_expenses"

    client.delete(f"/expenses/{expense['id']}", headers=auth(users["alice"]))

    assert patch(client, users["alice"], space["id"], currency="USD").status_code == 200


def test_a_refused_currency_change_changes_nothing_else_in_the_same_request(client, users, space):
    owes(space["id"])

    response = patch(client, users["alice"], space["id"], name="Renamed", icon="car", currency="USD")

    assert response.status_code == 403
    after = page(client, users["alice"], space["id"]).json()
    assert (after["name"], after["icon"], after["currency"]) == ("Flat", "trip", "INR")


def test_renaming_still_works_after_expenses_exist(client, users, space):
    owes(space["id"])
    assert patch(client, users["bob"], space["id"], name="Flat 4B").status_code == 200


# --- Add people (1.2.3) ------------------------------------------------------------------------------------


def test_any_member_can_add_people_who_are_in_at_once_and_are_told(client, users, space):
    response = add_people(client, users["bob"], space["id"], "alex")  # bob is not the owner

    assert response.status_code == 200
    assert member_names(response.json()) == ["alice", "bob", "carol", "alex"]
    assert [m["position"] for m in response.json()["members"]] == [1, 2, 3, 4]
    [card] = cards(client, users["alex"], "space_added")
    assert card["message"] == "Bob added you to ‘Flat’" and card["needs_answer"] is False  # no accept step
    assert (card["space_id"], card["space_name"]) == (space["id"], "Flat")
    assert page(client, users["alex"], space["id"]).status_code == 200  # a member straight away


def test_several_people_are_added_in_the_order_given_and_repeats_are_dropped(client, users, space):
    other = register(client, "bobby")

    response = add_people(client, users["alice"], space["id"], "bobby", "ALEX", "bobby")

    assert member_names(response.json()) == ["alice", "bob", "carol", "bobby", "alex"]
    assert len(cards(client, other, "space_added")) == 1  # told once, not twice


def test_adding_someone_who_is_already_in_is_refused_and_nothing_is_added(client, users, space):
    response = add_people(client, users["alice"], space["id"], "alex", "bob")

    assert response.status_code == 409 and error_code(response) == "already_member"
    assert response.json()["detail"]["usernames"] == ["bob"]
    assert member_names(page(client, users["alice"], space["id"]).json()) == ["alice", "bob", "carol"]  # alex was not added
    assert cards(client, users["alex"], "space_added") == []


def test_adding_someone_who_does_not_exist_is_refused_and_nothing_is_added(client, users, space):
    response = add_people(client, users["alice"], space["id"], "alex", "ghost.user")

    assert response.status_code == 422 and error_code(response) == "unknown_usernames"
    assert response.json()["detail"]["usernames"] == ["ghost.user"]
    assert member_names(page(client, users["alice"], space["id"]).json()) == ["alice", "bob", "carol"]


@pytest.mark.parametrize("body", [{"usernames": []}, {"usernames": ["a"]}, {"usernames": ["Al!ce"]}, {}, {"usernames": ["u%02d" % n for n in range(50)]}])
def test_the_request_must_be_a_sensible_list(client, users, space, body):
    response = client.post(f"/spaces/{space['id']}/members", json=body, headers=auth(users["alice"]))
    assert response.status_code == 422 and error_code(response) == "validation_error"


def test_someone_outside_the_space_cannot_add_people(client, users, space):
    response = add_people(client, users["alex"], space["id"], "alex")
    assert response.status_code == 404 and error_code(response) == "space_not_found"


def fill(space_id: int, count: int) -> list[str]:
    """Put `count` more people straight into the space, so the limit can be tested without 49 sign-ups."""
    names = []
    with SessionLocal() as db:
        position = max(db.scalars(select(SpaceMember.position).where(SpaceMember.space_id == space_id)))
        for n in range(count):
            name = f"filler{n:02d}"
            db.add(User(username=name, name=name.title(), phone=f"+9190000{n:05d}", password_hash="x"))
            db.flush()
            db.add(SpaceMember(space_id=space_id, username=name, position=position + 1 + n))
            names.append(name)
        db.commit()
    return names


def test_a_space_holds_fifty_people_and_the_fifty_first_is_refused(client, users, space):
    fill(space["id"], 46)  # alice, bob and carol, and 46 more: 49 people
    assert add_people(client, users["alice"], space["id"], "alex").status_code == 200  # the 50th

    other = register(client, "bobby")
    response = add_people(client, users["alice"], space["id"], "bobby")  # the 51st

    assert response.status_code == 409 and error_code(response) == "space_full"
    assert response.json()["detail"]["message"] == "A space holds at most 50 people."
    assert cards(client, other, "space_added") == []
    assert len(page(client, users["alice"], space["id"]).json()["members"]) == 50


def test_a_request_that_would_go_past_fifty_adds_none_of_them(client, users, space):
    fill(space["id"], 46)  # 49 people
    register(client, "bobby")

    response = add_people(client, users["alice"], space["id"], "alex", "bobby")  # two more would make 51

    assert response.status_code == 409 and error_code(response) == "space_full"
    assert len(page(client, users["alice"], space["id"]).json()["members"]) == 49


# --- Remove a member (1.2.4) -------------------------------------------------------------------------------


def test_the_owner_removes_a_settled_up_member(client, users, space):
    response = remove(client, users["alice"], space["id"], "bob")

    assert response.status_code == 204 and response.content == b""
    assert member_names(page(client, users["alice"], space["id"]).json()) == ["alice", "carol"]
    assert page(client, users["bob"], space["id"]).status_code == 404  # the space is gone for him
    assert space["id"] not in [s["id"] for s in client.get("/spaces", headers=auth(users["bob"])).json()["spaces"]]


def test_only_the_owner_can_remove_people(client, users, space):
    response = remove(client, users["bob"], space["id"], "carol")

    assert forbidden_reason(response) == "not_owner"
    assert member_names(page(client, users["alice"], space["id"]).json()) == ["alice", "bob", "carol"]


def test_the_owner_cannot_be_removed(client, users, space):
    response = remove(client, users["alice"], space["id"], "alice")
    assert forbidden_reason(response) == "owner_cannot_be_removed"


@pytest.mark.parametrize("name", ["alex", "nobody.here", "!!", "ALEX", "x" * 50])
def test_removing_someone_who_is_not_in_the_space_is_not_found(client, users, space, name):
    response = remove(client, users["alice"], space["id"], name)
    assert response.status_code == 404 and error_code(response) == "member_not_found"


def test_someone_outside_the_space_cannot_remove_anyone(client, users, space):
    response = remove(client, users["alex"], space["id"], "bob")
    assert response.status_code == 404 and error_code(response) == "space_not_found"


def test_a_member_with_a_balance_cannot_be_removed_until_settled_up(client, users, space):
    owes(space["id"])  # bob owes alice

    refused = remove(client, users["alice"], space["id"], "bob")

    assert forbidden_reason(refused) == "not_settled"
    assert refused.json()["detail"]["message"] == "Settle up first"
    assert "bob" in member_names(page(client, users["alice"], space["id"]).json())

    settle(space["id"])  # bob pays alice back and she confirms
    assert remove(client, users["alice"], space["id"], "bob").status_code == 204


def test_a_balance_between_two_other_people_does_not_block_removing_a_third(client, users, space):
    owes(space["id"], debtor="bob", creditor="carol")  # bob owes carol; alice is square with everyone
    register(client, "bobby")
    add_people(client, users["alice"], space["id"], "bobby")

    assert remove(client, users["alice"], space["id"], "bobby").status_code == 204  # bobby is square, bob and carol are not
    assert forbidden_reason(remove(client, users["alice"], space["id"], "carol")) == "not_settled"  # carol is owed


def test_a_payment_still_waiting_for_an_answer_does_not_block_removal_and_stays_answerable(client, users, space):
    """Settled on paper (the balance is 0) but a payment is pending: nobody is stuck, so it does not block (Appendix B, B.10)."""
    add_settlement(space["id"], "bob", "alice", "100", SettlementStatus.PENDING)

    assert remove(client, users["alice"], space["id"], "bob").status_code == 204

    payment = db_all(select(Settlement))[0]
    assert payment.status == SettlementStatus.PENDING  # left as it was
    assert client.post(f"/settlements/{payment.id}/reject", headers=auth(users["alice"])).status_code == 200  # the receiver can answer it


def test_a_share_nobody_has_answered_does_not_block_removal_either(client, users, space):
    """A person who has paid everything but never tapped a share must not be stuck: only they could answer it."""
    add_expense(space["id"], "alice", "Dinner", {"alice": ("100", ACCEPTED), "bob": ("100", PENDING), "carol": ("100", REJECTED)})

    assert remove(client, users["alice"], space["id"], "bob").status_code == 204
    assert remove(client, users["alice"], space["id"], "carol").status_code == 204

    expense = db_all(select(Expense))[0]
    assert {s.username: s.status for s in db_all(select(ExpenseShare).where(ExpenseShare.expense_id == expense.id))} == {
        "alice": ACCEPTED, "bob": PENDING, "carol": REJECTED,  # the shares are left exactly as they were
    }


def test_paying_up_is_enough_even_if_the_share_was_never_answered(client, users, space):
    """The ordinary flow: bob owes, pays, alice confirms. His share still says pending, and he can leave."""
    add_expense(space["id"], "alice", "Dinner", {"alice": ("100", ACCEPTED), "bob": ("100", PENDING)})
    assert forbidden_reason(leave(client, users["bob"], space["id"])) == "not_settled"  # he still owes
    settle(space["id"])

    assert leave(client, users["bob"], space["id"]).status_code == 204


def test_a_removed_member_leaves_their_history_behind(client, users, space):
    owes(space["id"])  # bob owes alice...
    settle(space["id"])  # ...and has paid it
    remove(client, users["alice"], space["id"], "bob")

    detail = page(client, users["alice"], space["id"]).json()

    assert [e["description"] for e in detail["expenses"]] == ["Dinner"]
    assert detail["expenses"][0]["paid_by"]["username"] == "alice"
    assert [(s["from_user"]["username"], s["status"]) for s in detail["settlements"]] == [("bob", "confirmed")]
    assert detail["balance_minor"] == 0 and detail["pairwise"] == []


def test_a_removed_member_can_be_added_again(client, users, space):
    remove(client, users["alice"], space["id"], "bob")

    response = add_people(client, users["alice"], space["id"], "bob")

    assert response.status_code == 200
    assert member_names(response.json()) == ["alice", "carol", "bob"]
    assert [m["position"] for m in response.json()["members"]] == [1, 3, 4]  # the next free place, not a reused one


# --- Leave (1.2.5) -----------------------------------------------------------------------------------------


def test_a_settled_up_member_can_leave(client, users, space):
    response = leave(client, users["bob"], space["id"])

    assert response.status_code == 204 and response.content == b""
    assert member_names(page(client, users["alice"], space["id"]).json()) == ["alice", "carol"]
    assert page(client, users["bob"], space["id"]).status_code == 404
    assert client.get("/spaces", headers=auth(users["bob"])).json()["spaces"] == []


def test_the_owner_cannot_leave(client, users, space):
    response = leave(client, users["alice"], space["id"])

    assert forbidden_reason(response) == "owner_cannot_leave"
    assert response.json()["detail"]["message"] == "The owner can’t leave. Settle up and delete the space instead."
    assert page(client, users["alice"], space["id"]).status_code == 200


def test_a_member_with_a_balance_cannot_leave(client, users, space):
    owes(space["id"], debtor="bob", creditor="alice")

    owing = leave(client, users["bob"], space["id"])  # bob owes
    owed = leave(client, users["alice"], space["id"])  # alice is owed, and she is the owner anyway
    carol = leave(client, users["carol"], space["id"])  # carol is square

    assert forbidden_reason(owing) == "not_settled" and owing.json()["detail"]["message"] == "Settle up first"
    assert forbidden_reason(owed) == "owner_cannot_leave"
    assert carol.status_code == 204


def test_someone_outside_the_space_cannot_leave_it(client, users, space):
    response = leave(client, users["alex"], space["id"])
    assert response.status_code == 404 and error_code(response) == "space_not_found"


def test_leaving_twice_is_not_found_the_second_time(client, users, space):
    assert leave(client, users["bob"], space["id"]).status_code == 204
    assert leave(client, users["bob"], space["id"]).status_code == 404


# --- Delete (1.2.6) ----------------------------------------------------------------------------------------


def test_the_owner_deletes_a_settled_up_space_and_everything_in_it_goes(client, users, space):
    owes(space["id"])
    settle(space["id"])
    other = create_space(client, users["alice"], "Trip", ["bob"])
    owes(other["id"], "bob", "alice", "50")  # a different space with money in it, which must survive
    expense = db_all(select(Expense).where(Expense.space_id == space["id"]))[0]
    with SessionLocal() as db:  # a reminder on one of the shares, which goes with the shares
        share = db.scalar(select(ExpenseShare).where(ExpenseShare.expense_id == expense.id, ExpenseShare.username == "bob"))
        db.add(Reminder(expense_share_id=share.id, reminder_day=3))
        db.commit()

    response = delete(client, users["alice"], space["id"])

    assert response.status_code == 204 and response.content == b""
    for tokens in ("alice", "bob", "carol"):
        assert page(client, users[tokens], space["id"]).status_code == 404
    assert db_all(select(Space).where(Space.id == space["id"])) == []
    assert db_all(select(SpaceMember).where(SpaceMember.space_id == space["id"])) == []
    assert db_all(select(Expense).where(Expense.space_id == space["id"])) == []
    assert db_all(select(Settlement).where(Settlement.space_id == space["id"])) == []
    assert db_all(select(ExpenseShare).where(ExpenseShare.expense_id == expense.id)) == []
    assert db_all(select(Reminder)) == []
    assert len(db_all(select(Expense).where(Expense.space_id == other["id"]))) == 1  # the other space is untouched
    assert page(client, users["bob"], other["id"]).status_code == 200


def test_the_other_members_are_told_and_the_card_still_reads(client, users, space):
    delete(client, users["alice"], space["id"])

    for name in ("bob", "carol"):
        [card] = cards(client, users[name], "space_deleted")
        assert card["message"] == "Alice deleted ‘Flat’"
        assert card["space_id"] is None and card["space_name"] == "Flat"  # the space is gone, the name was copied
        assert card["needs_answer"] is False
    assert cards(client, users["alice"], "space_deleted") == []  # the person who deleted it is not told


def test_every_older_card_about_the_space_still_displays(client, users, space):
    """The "added you" cards stay, with their text. A card that was still asking a question no longer asks."""
    expense = add_expense(space["id"], "alice", "Dinner", {"alice": ("100", ACCEPTED), "bob": ("100", PENDING), "carol": ("100", REJECTED)})
    with SessionLocal() as db:
        db.add(Notification(username="bob", type=NotificationType.EXPENSE_SHARE, message="Alice added ‘Dinner’ — your share is ₹100",
                            space_id=space["id"], space_name="Flat", ref_id=expense, needs_answer=True))
        db.commit()
    assert any(c["needs_answer"] for c in cards(client, users["bob"]))
    # the disputed bill is out of the balances, so the space counts as settled up
    delete(client, users["alice"], space["id"])

    bobs = cards(client, users["bob"])

    assert {c["type"] for c in bobs} == {"space_added", "expense_share", "space_deleted"}
    assert next(c for c in bobs if c["type"] == "space_added")["message"] == "Alice added you to ‘Flat’"
    assert all(c["space_id"] is None for c in bobs) and all(c["space_name"] == "Flat" for c in bobs)
    assert not any(c["needs_answer"] for c in bobs)  # nothing asks about an expense that is gone


def test_only_the_owner_can_delete_the_space(client, users, space):
    response = delete(client, users["bob"], space["id"])

    assert forbidden_reason(response) == "not_owner"
    assert response.json()["detail"]["message"] == "Only the owner can delete this space"
    assert page(client, users["alice"], space["id"]).status_code == 200
    assert cards(client, users["carol"], "space_deleted") == []


def test_the_space_cannot_be_deleted_until_everyone_is_settled_up(client, users, space):
    owes(space["id"], debtor="bob", creditor="carol")  # a balance that does not involve the owner at all

    refused = delete(client, users["alice"], space["id"])

    assert forbidden_reason(refused) == "not_settled"
    assert refused.json()["detail"]["message"] == "Everyone must be settled up first"
    assert page(client, users["alice"], space["id"]).status_code == 200  # nothing was deleted
    assert cards(client, users["bob"], "space_deleted") == []  # and nobody was told

    settle(space["id"], payer="bob", payee="carol")
    assert delete(client, users["alice"], space["id"]).status_code == 204


def test_someone_outside_the_space_cannot_delete_it(client, users, space):
    response = delete(client, users["alex"], space["id"])
    assert response.status_code == 404 and error_code(response) == "space_not_found"
    assert page(client, users["alice"], space["id"]).status_code == 200


def test_a_space_with_only_its_owner_can_be_deleted(client, users):
    lonely = create_space(client, users["alice"], "Alone", [])
    assert delete(client, users["alice"], lonely["id"]).status_code == 204


def test_deleting_twice_is_not_found_the_second_time(client, users, space):
    assert delete(client, users["alice"], space["id"]).status_code == 204
    assert delete(client, users["alice"], space["id"]).status_code == 404


# --- A space that has lost people is still a space ----------------------------------------------------------


def test_a_space_the_owner_is_alone_in_still_works(client, users, space):
    remove(client, users["alice"], space["id"], "bob")
    leave(client, users["carol"], space["id"])

    detail = page(client, users["alice"], space["id"]).json()

    assert member_names(detail) == ["alice"]
    assert patch(client, users["alice"], space["id"], name="Solo").status_code == 200
    assert add_people(client, users["alice"], space["id"], "bob").status_code == 200
