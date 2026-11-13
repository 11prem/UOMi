"""Delete my account (tasks 1.7.1 and 1.7.2): the person is anonymised, other people's records stay correct.

The rule being tested (Appendix B, B.6):
  * the row stays as "Deleted user", the username is retired, the phone number is free again;
  * refused until the person is settled up everywhere, and while they own a space that has other people in it;
  * a space only they are in goes with them; payments waiting on them are taken back;
  * the password is asked for again, and wrong guesses count like wrong sign-ins.
"""

import pytest
from sqlalchemy import select

from app.config import settings
from app.database import SessionLocal, utcnow
from app.models.expense import Expense
from app.models.expense_split import ExpenseShare, ShareStatus
from app.models.group import Space
from app.models.group_member import SpaceMember
from app.models.login_attempt import LoginAttempt
from app.models.notification import Notification, NotificationType
from app.models.password_reset import PasswordReset
from app.models.pending_signup import PendingSignup
from app.models.payment import Settlement, SettlementStatus
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.services.account_service import DELETED_NAME
from tests import helpers
from tests.helpers import PASSWORD, PHONES, add_expense, add_settlement, auth, create_space, db_all, error_code, register, start_signup


@pytest.fixture
def users(client):
    return {name: register(client, name) for name in ("alice", "bob", "carol", "alex")}


def delete_me(client, tokens, password=PASSWORD):
    return client.post("/users/me/delete", json={"password": password}, headers=auth(tokens))


def row(username: str) -> User:
    with SessionLocal() as db:
        return db.get(User, username)


def settle_up(space_id: int, debtor="bob", creditor="alice", amount="100"):
    add_settlement(space_id, debtor, creditor, amount, SettlementStatus.CONFIRMED)


@pytest.fixture
def flat(client, users):
    """'Flat' (alice owns it, with bob and carol). Alice paid a ₹200 dinner split with bob, so bob owes alice ₹100."""
    space = create_space(client, users["alice"], "Flat", ["bob", "carol"])
    add_expense(space["id"], "alice", "Dinner", {"alice": ("100", ShareStatus.ACCEPTED), "bob": ("100", ShareStatus.ACCEPTED)})
    return space


# --- What happens to the account ------------------------------------------------------------------


def test_deleting_the_account_ends_every_way_back_in(client, users):
    second_device = client.post("/auth/login", json={"username": "carol", "password": PASSWORD}).json()

    response = delete_me(client, users["carol"])

    assert response.status_code == 204 and response.content == b""
    for tokens in (users["carol"], second_device):
        assert client.get("/users/me", headers=auth(tokens)).status_code == 401  # the access tokens stop working
        refreshed = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
        assert refreshed.status_code == 401  # and the sessions behind them are gone
    login = client.post("/auth/login", json={"username": "carol", "password": PASSWORD})
    assert login.status_code == 401 and error_code(login) == "invalid_credentials"  # the same answer as for no such account
    assert db_all(select(RefreshToken).where(RefreshToken.username == "carol")) == []


def test_the_row_is_anonymised_and_nothing_personal_is_left(client, users):
    before = row("carol")
    assert before.phone == "+919876543213" and before.deleted_at is None

    delete_me(client, users["carol"])

    after = row("carol")
    assert (after.username, after.name, after.phone, after.notifications_on) == ("carol", DELETED_NAME, None, False)
    assert after.deleted_at is not None
    assert after.password_hash != before.password_hash
    from app.utils import security
    assert not security.verify_password(PASSWORD, after.password_hash)


def test_their_cards_sessions_and_reset_records_are_removed(client, users):
    create_space(client, users["alice"], "Flat", ["carol"])  # gives carol a card
    client.post("/auth/forgot", json={"username": "carol"})
    assert db_all(select(Notification).where(Notification.username == "carol")) and db_all(select(PasswordReset))

    delete_me(client, users["carol"])

    assert db_all(select(Notification).where(Notification.username == "carol")) == []
    assert db_all(select(PasswordReset).where(PasswordReset.username == "carol")) == []
    assert db_all(select(LoginAttempt).where(LoginAttempt.username == "carol")) == []


def test_the_username_is_retired_and_the_phone_number_is_free_again(client, users):
    delete_me(client, users["carol"])
    helpers.rewind(PendingSignup, 60)  # the 30-second wait between texts to one number has passed

    assert client.get("/auth/check-username", params={"username": "carol"}).json()["available"] is False
    assert start_signup(client, "carol", "+919000000111").status_code == 409  # nobody can take the old username
    assert client.get("/auth/check-phone", params={"phone": PHONES["carol"]}).json()["available"] is True
    reused = register(client, "carol2", PHONES["carol"])  # the number belongs to a new account now
    assert client.get("/users/me", headers=auth(reused)).json()["phone"] == "+919876543213"
    assert row("carol").phone is None  # and the old row was not touched by that


def test_a_deleted_account_cannot_be_found_or_added(client, users):
    delete_me(client, users["carol"])

    assert client.get("/users/search", params={"q": "carol"}, headers=auth(users["alice"])).json() == []
    assert client.get("/users/search", params={"q": "+919876543213"}, headers=auth(users["alice"])).json() == []
    added = client.post("/spaces", json={"name": "Trip", "icon": "trip", "usernames": ["carol"]}, headers=auth(users["alice"]))
    assert added.status_code == 422 and error_code(added) == "unknown_usernames"
    space = create_space(client, users["alice"], "Flat", ["bob"])
    more = client.post(f"/spaces/{space['id']}/members", json={"usernames": ["carol"]}, headers=auth(users["alice"]))
    assert more.status_code == 422 and error_code(more) == "unknown_usernames"


def test_forgot_password_treats_a_deleted_account_like_one_that_never_existed(client, users):
    delete_me(client, users["carol"])
    helpers.OUTBOX.clear()

    deleted = client.post("/auth/forgot", json={"username": "carol"})
    never = client.post("/auth/forgot", json={"username": "nobody.here"})

    assert deleted.status_code == never.status_code == 202
    assert set(deleted.json()) == set(never.json())
    assert helpers.OUTBOX == []  # nothing was texted, and the old number was not given away


def test_an_old_reset_code_cannot_bring_a_deleted_account_back(client, users):
    started = client.post("/auth/forgot", json={"username": "carol"})
    verified = client.post("/auth/verify-otp", json={"reset_id": started.json()["reset_id"], "code": helpers.last_code(PHONES["carol"])})
    token = verified.json()["reset_token"]
    delete_me(client, users["carol"])

    reset = client.post("/auth/reset", json={"reset_token": token, "new_password": "brand-new-pass1", "confirm_password": "brand-new-pass1"})

    assert reset.status_code in (400, 401, 410, 422)
    assert client.post("/auth/login", json={"username": "carol", "password": "brand-new-pass1"}).status_code == 401


# --- Asking for the password ----------------------------------------------------------------------


def test_the_password_is_asked_for_again(client, users):
    wrong = delete_me(client, users["carol"], "not-the-password")

    assert wrong.status_code == 403 and error_code(wrong) == "forbidden" and wrong.json()["detail"]["reason"] == "wrong_password"
    assert client.get("/users/me", headers=auth(users["carol"])).status_code == 200  # nothing happened
    assert row("carol").deleted_at is None
    assert delete_me(client, users["carol"], "").status_code == 403


def test_the_request_must_carry_a_password_and_nothing_else(client, users):
    assert client.post("/users/me/delete", json={}, headers=auth(users["carol"])).status_code == 422
    assert client.post("/users/me/delete", json={"password": PASSWORD, "force": True}, headers=auth(users["carol"])).status_code == 422
    assert client.post("/users/me/delete", json={"password": "x" * 129}, headers=auth(users["carol"])).status_code == 422
    assert row("carol").deleted_at is None


def test_you_must_be_signed_in_to_delete(client, users):
    response = client.post("/users/me/delete", json={"password": PASSWORD})
    assert response.status_code == 401 and error_code(response) == "not_authenticated"


def test_wrong_passwords_here_lock_the_account_like_wrong_sign_ins(client, users):
    """A stolen session must not be a way to guess the password without limit."""
    for _ in range(settings.LOGIN_MAX_ATTEMPTS):
        assert delete_me(client, users["carol"], "guess").status_code == 403

    locked = delete_me(client, users["carol"], PASSWORD)  # even the right one is refused while locked

    assert locked.status_code == 429 and error_code(locked) == "too_many_attempts"
    assert client.post("/auth/login", json={"username": "carol", "password": PASSWORD}).status_code == 429  # same lock
    assert row("carol").deleted_at is None


def test_a_right_password_that_is_refused_does_not_count_towards_a_lockout(client, users, flat):
    for _ in range(settings.LOGIN_MAX_ATTEMPTS + 2):  # bob owes money, so each of these is refused for that reason
        response = delete_me(client, users["bob"])
        assert response.status_code == 403 and response.json()["detail"]["reason"] == "not_settled"
    assert db_all(select(LoginAttempt).where(LoginAttempt.username == "bob")) == []


# --- When it is refused ---------------------------------------------------------------------------


def test_someone_who_owes_or_is_owed_must_settle_up_first(client, users, flat):
    for who in ("bob", "alice"):  # the one who owes and the one who is owed
        response = delete_me(client, users[who])
        assert response.status_code == 403
        assert response.json()["detail"]["reason"] == "not_settled"
        assert response.json()["detail"]["spaces"] == [{"id": flat["id"], "name": "Flat"}]
        assert row(who).deleted_at is None


def test_it_names_every_space_that_is_not_settled(client, users, flat):
    other = create_space(client, users["alice"], "Trip", ["bob"])
    add_expense(other["id"], "bob", "Taxi", {"bob": ("50", ShareStatus.ACCEPTED), "alice": ("50", ShareStatus.ACCEPTED)})

    response = delete_me(client, users["bob"])

    assert [s["name"] for s in response.json()["detail"]["spaces"]] == ["Flat", "Trip"]


def test_a_payment_still_waiting_for_an_answer_does_not_settle_the_debt(client, users, flat):
    add_settlement(flat["id"], "bob", "alice", "100", SettlementStatus.PENDING)

    assert delete_me(client, users["bob"]).status_code == 403  # only a confirmed payment counts, as everywhere else


def test_once_settled_up_the_person_can_delete(client, users, flat):
    settle_up(flat["id"])

    assert delete_me(client, users["bob"]).status_code == 204
    assert row("bob").deleted_at is not None


def test_the_owner_of_a_space_with_other_people_in_it_must_deal_with_it_first(client, users, flat):
    settle_up(flat["id"])

    response = delete_me(client, users["alice"])

    assert response.status_code == 403 and response.json()["detail"]["reason"] == "owns_shared_space"
    assert response.json()["detail"]["spaces"] == [{"id": flat["id"], "name": "Flat"}]
    assert row("alice").deleted_at is None
    assert db_all(select(Space).where(Space.id == flat["id"]))  # nothing was deleted on the way


def test_the_owner_can_delete_after_removing_the_others(client, users, flat):
    settle_up(flat["id"])
    for other in ("bob", "carol"):
        assert client.delete(f"/spaces/{flat['id']}/members/{other}", headers=auth(users["alice"])).status_code == 204

    assert delete_me(client, users["alice"]).status_code == 204


def test_a_space_only_they_are_in_goes_with_the_account(client, users):
    solo = create_space(client, users["alice"], "Solo")
    add_expense(solo["id"], "alice", "Books", {"alice": ("40", ShareStatus.ACCEPTED)})

    assert delete_me(client, users["alice"]).status_code == 204

    assert db_all(select(Space).where(Space.id == solo["id"])) == []
    assert db_all(select(Expense).where(Expense.space_id == solo["id"])) == []
    assert db_all(select(SpaceMember).where(SpaceMember.username == "alice")) == []


# --- What other people see afterwards -------------------------------------------------------------


def test_the_others_keep_their_spaces_expenses_and_balances(client, users, flat):
    settle_up(flat["id"])
    before = client.get(f"/spaces/{flat['id']}", headers=auth(users["alice"])).json()
    assert delete_me(client, users["bob"]).status_code == 204

    page = client.get(f"/spaces/{flat['id']}", headers=auth(users["alice"])).json()

    assert [m["username"] for m in page["members"]] == ["alice", "carol"]  # bob left every space
    assert page["balance_minor"] == before["balance_minor"] == 0
    dinner = next(e for e in page["expenses"] if e["description"] == "Dinner")
    assert dinner["amount_minor"] == 20000
    detail = client.get(f"/expenses/{dinner['id']}", headers=auth(users["alice"])).json()
    assert {s["user"]["username"]: s["user"]["name"] for s in detail["shares"]}["bob"] == DELETED_NAME  # the old record names him so
    assert client.get(f"/spaces/{flat['id']}", headers=auth(users["bob"])).status_code == 401  # and he can no longer see it


def test_an_expense_they_paid_still_reads_in_the_others_list(client, users):
    space = create_space(client, users["alice"], "Flat", ["bob"])
    add_expense(space["id"], "bob", "Gas", {"alice": ("30", ShareStatus.ACCEPTED), "bob": ("30", ShareStatus.ACCEPTED)})
    settle_up(space["id"], debtor="alice", creditor="bob", amount="30")
    delete_me(client, users["bob"])

    page = client.get(f"/spaces/{space['id']}", headers=auth(users["alice"])).json()
    gas = next(e for e in page["expenses"] if e["description"] == "Gas")

    assert gas["paid_by"]["name"] == DELETED_NAME and gas["paid_by"]["username"] == "bob"


def test_payments_waiting_on_them_are_taken_back_and_the_card_asking_goes(client, users):
    """Nobody is left to answer these. (They can only exist when the debt behind them has gone away since.)"""
    space = create_space(client, users["alice"], "Flat", ["bob"])
    add_settlement(space["id"], "bob", "alice", "100", SettlementStatus.PENDING)
    with SessionLocal() as db:
        pending = db.scalar(select(Settlement.id))
        db.add(Notification(username="alice", type=NotificationType.PAYMENT_TO_CONFIRM, message="Bob paid", space_id=space["id"], ref_id=pending, needs_answer=True))
        db.commit()

    assert delete_me(client, users["bob"]).status_code == 204

    assert db_all(select(Settlement.status)) == [SettlementStatus.CANCELLED]
    assert db_all(select(Notification).where(Notification.type == NotificationType.PAYMENT_TO_CONFIRM)) == []


def test_an_unanswered_share_of_theirs_stays_as_it_is(client, users):
    """The same as leaving a space (B.10): the balance already counts it, and nobody is stuck."""
    space = create_space(client, users["alice"], "Flat", ["bob"])
    expense_id = add_expense(space["id"], "alice", "Lunch", {"alice": ("10", ShareStatus.ACCEPTED), "bob": ("10", ShareStatus.PENDING)})
    settle_up(space["id"], amount="10")

    assert delete_me(client, users["bob"]).status_code == 204

    statuses = {s.username: s.status for s in db_all(select(ExpenseShare).where(ExpenseShare.expense_id == expense_id))}
    assert statuses["bob"] == ShareStatus.PENDING


def test_deleting_twice_is_refused_the_second_time(client, users):
    assert delete_me(client, users["carol"]).status_code == 204
    assert delete_me(client, users["carol"]).status_code == 401  # the session is gone


def test_a_deleted_account_is_refused_even_when_a_session_somehow_survives(client, users):
    """The sessions are removed with the account; this is the second lock, in case one is ever left behind."""
    with SessionLocal() as db:
        db.get(User, "carol").deleted_at = utcnow()
        db.commit()

    response = client.get("/users/me", headers=auth(users["carol"]))

    assert response.status_code == 401 and error_code(response) == "invalid_token"
