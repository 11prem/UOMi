"""Push notifications (task 1.8): registering phones, the queue written with every card, and the worker that sends from it."""

import logging
from datetime import timedelta

import pytest
from sqlalchemy import delete, select, update

from app.config import settings
from app.database import SessionLocal, utcnow
from app.models.device_token import DeviceToken
from app.models.expense_split import ExpenseShare, ShareStatus
from app.models.notification import Notification, NotificationType
from app.models.push_delivery import PushDelivery
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.services import notification_service, push_service
from app.services.push_service import ConsoleSender, PushResult, deliver_pending
from app.services.reminder_service import process_due_reminders
from tests.helpers import PASSWORD, add_expense, auth, create_space, db_all, db_exec, error_code, register, reset_token
from tests.test_phase2_security import production_settings


@pytest.fixture
def users(client):
    return {name: register(client, name) for name in ("alice", "bob")}


@pytest.fixture
def push_on(client, monkeypatch):
    """Pushes switched on AFTER the client exists, so the app's start-up did not start a worker thread on the test database."""
    monkeypatch.setattr(settings, "PUSH_ENABLED", True)


class FakeSender:
    """Records every push and answers from a list of results (an exception in the list is raised). SENT when it runs out."""

    def __init__(self, *results):
        self.results = list(results)
        self.sent: list[tuple] = []

    def send(self, token, platform, title, body, data):
        self.sent.append((token, platform, title, body, data))
        result = self.results.pop(0) if self.results else PushResult.SENT
        if isinstance(result, Exception):
            raise result
        return result


def put_device(client, tokens, token="phone-1", platform="android"):
    return client.put("/users/me/devices", json={"token": token, "platform": platform}, headers=auth(tokens))


def delete_device(client, tokens, token="phone-1"):
    return client.request("DELETE", "/users/me/devices", json={"token": token}, headers=auth(tokens))


def card_for(username: str, message="Alice added you to ‘Flat’", **fields) -> int:
    with SessionLocal() as db:
        card = notification_service.create_notification(
            db, username=username, type=NotificationType.SPACE_ADDED, message=message, space_name=fields.pop("space_name", "Flat"), **fields
        )
        db.commit()
        return card.id


def deliver(sender, now=None) -> dict:
    with SessionLocal() as db:
        return deliver_pending(db, sender, now)


def queue() -> list[PushDelivery]:
    return db_all(select(PushDelivery).order_by(PushDelivery.id))


def devices_of(username: str) -> list[str]:
    return sorted(db_all(select(DeviceToken.token).where(DeviceToken.username == username)))


ZEROS = {"sent": 0, "dropped": 0, "retried": 0, "invalid_devices": 0}


# --- Registering a phone (1.8.1) ----------------------------------------------------------------------


def test_a_phone_is_registered_to_the_person_and_their_sign_in(client, users):
    assert put_device(client, users["alice"], "phone-1", "ios").status_code == 204

    [device] = db_all(select(DeviceToken))
    assert (device.username, device.token, device.platform) == ("alice", "phone-1", "ios")
    assert device.session_id == db_all(select(RefreshToken.id).where(RefreshToken.username == "alice"))[0]


def test_registering_again_refreshes_the_phone_and_does_not_add_a_second_row(client, users):
    put_device(client, users["alice"])
    old = utcnow() - timedelta(days=30)
    db_exec(update(DeviceToken).values(last_seen_at=old))

    assert put_device(client, users["alice"], "phone-1", "web").status_code == 204

    [device] = db_all(select(DeviceToken))
    assert device.last_seen_at > old and device.platform == "web"


def test_one_person_can_have_several_phones(client, users):
    for number in (1, 2, 3):
        put_device(client, users["alice"], f"phone-{number}")
    put_device(client, users["bob"], "phone-9")

    assert devices_of("alice") == ["phone-1", "phone-2", "phone-3"] and devices_of("bob") == ["phone-9"]


def test_at_most_ten_phones_are_kept_and_the_one_seen_longest_ago_goes(client, users):
    for number in range(11):
        assert put_device(client, users["alice"], f"phone-{number:02d}").status_code == 204

    kept = devices_of("alice")
    assert len(kept) == 10 and "phone-00" not in kept and "phone-10" in kept


@pytest.mark.parametrize("platform", ["android", "ios", "web"])
def test_the_three_platforms_are_accepted(client, users, platform):
    assert put_device(client, users["alice"], "phone-1", platform).status_code == 204


@pytest.mark.parametrize(
    "body",
    [
        {"token": "phone-1", "platform": "windows"},
        {"token": "phone-1"},
        {"platform": "android"},
        {"token": "", "platform": "android"},
        {"token": "t" * 256, "platform": "android"},
        {"token": "ph" + chr(0) + "one", "platform": "android"},
        {"token": "phone-1", "platform": "android", "username": "bob"},
        {"token": 5, "platform": "android"},
    ],
)
def test_a_bad_registration_is_refused_and_nothing_is_saved(client, users, body):
    response = client.put("/users/me/devices", json=body, headers=auth(users["alice"]))

    assert response.status_code == 422 and error_code(response) == "validation_error"
    assert db_all(select(DeviceToken)) == []


def test_a_token_of_255_characters_is_fine(client, users):
    assert put_device(client, users["alice"], "t" * 255).status_code == 204


def test_both_endpoints_need_a_sign_in(client):
    assert client.put("/users/me/devices", json={"token": "phone-1", "platform": "android"}).status_code == 401
    assert client.request("DELETE", "/users/me/devices", json={"token": "phone-1"}).status_code == 401


def test_a_phone_that_changes_hands_moves_to_the_new_owner_and_nothing_queued_for_the_old_one_reaches_it(client, users, push_on):
    put_device(client, users["alice"], "shared-phone")
    card_for("alice")
    assert len(queue()) == 1

    put_device(client, users["bob"], "shared-phone")

    assert devices_of("alice") == [] and devices_of("bob") == ["shared-phone"]
    assert queue() == []  # alice's card can no longer be sent to what is now bob's phone


def test_removing_a_phone_forgets_it_and_what_was_queued_for_it(client, users, push_on):
    put_device(client, users["alice"], "phone-1")
    put_device(client, users["alice"], "phone-2")
    card_for("alice")
    assert len(queue()) == 2

    assert delete_device(client, users["alice"], "phone-1").status_code == 204

    assert devices_of("alice") == ["phone-2"] and len(queue()) == 1


def test_removing_is_always_204_and_cannot_remove_somebody_elses_phone(client, users):
    put_device(client, users["bob"], "bobs-phone")

    assert delete_device(client, users["alice"], "never-heard-of-it").status_code == 204
    assert delete_device(client, users["alice"], "bobs-phone").status_code == 204

    assert devices_of("bob") == ["bobs-phone"]


def test_removing_needs_a_token(client, users):
    assert client.request("DELETE", "/users/me/devices", json={"token": ""}, headers=auth(users["alice"])).status_code == 422
    assert client.request("DELETE", "/users/me/devices", json={}, headers=auth(users["alice"])).status_code == 422


def test_registering_is_limited_per_person_per_minute(client, users):
    assert [put_device(client, users["alice"]).status_code for _ in range(60)] == [204] * 60
    limited = put_device(client, users["alice"])

    assert limited.status_code == 429 and error_code(limited) == "too_many_requests"
    assert put_device(client, users["bob"]).status_code == 204  # the limit is alice's alone


# --- A phone goes when its sign-in does ---------------------------------------------------------------


def test_signing_out_removes_the_phone(client, users):
    put_device(client, users["alice"])

    assert client.post("/auth/logout", headers=auth(users["alice"])).status_code == 204

    assert db_all(select(DeviceToken)) == []


def test_signing_out_one_phone_leaves_the_others(client, users):
    second = client.post("/auth/login", json={"username": "alice", "password": PASSWORD}).json()
    put_device(client, users["alice"], "phone-1")
    put_device(client, second, "phone-2")

    client.post("/auth/logout", headers=auth(users["alice"]))

    assert devices_of("alice") == ["phone-2"]


def test_a_password_reset_removes_every_phone(client, users):
    put_device(client, users["alice"], "phone-1")
    token = reset_token(client, "alice")

    done = client.post("/auth/reset", json={"reset_token": token, "new_password": "brand-new-pass1", "confirm_password": "brand-new-pass1"})

    assert done.status_code == 200 and devices_of("alice") == []


def test_an_idle_sign_out_removes_the_phone(client, users):
    put_device(client, users["alice"])
    db_exec(update(RefreshToken).values(last_activity_at=utcnow() - timedelta(hours=2)))

    assert client.get("/users/me", headers=auth(users["alice"])).status_code == 401

    assert db_all(select(DeviceToken)) == []


def test_deleting_the_account_removes_the_phones_and_what_was_queued(client, users, push_on):
    put_device(client, users["alice"])
    card_for("alice")
    assert len(queue()) == 1

    assert client.post("/users/me/delete", json={"password": PASSWORD}, headers=auth(users["alice"])).status_code == 204

    assert db_all(select(DeviceToken)) == [] and queue() == []


# --- The queue is written with the card (1.8.2, 1.8.4) --------------------------------------------------


def test_every_card_queues_one_push_for_each_of_the_owners_phones(client, users, push_on):
    put_device(client, users["alice"], "phone-1")
    put_device(client, users["alice"], "phone-2")
    put_device(client, users["bob"], "bobs-phone")

    card_id = card_for("alice")

    assert [(d.notification_id, d.attempts) for d in queue()] == [(card_id, 0), (card_id, 0)]
    assert sorted(db_all(select(DeviceToken.token).join(PushDelivery, PushDelivery.device_token_id == DeviceToken.id))) == ["phone-1", "phone-2"]


def test_a_person_with_no_phone_queues_nothing(client, users, push_on):
    card_for("alice")

    assert queue() == [] and len(db_all(select(Notification))) == 1  # the card itself is still made


def test_the_notifications_switch_stops_the_queueing_and_turning_it_on_starts_it_again(client, users, push_on):
    put_device(client, users["alice"])
    client.patch("/users/me", json={"notifications_on": False}, headers=auth(users["alice"]))
    card_for("alice")
    assert queue() == []

    client.patch("/users/me", json={"notifications_on": True}, headers=auth(users["alice"]))
    card_for("alice")
    assert len(queue()) == 1


def test_nothing_is_queued_while_push_is_switched_off(client, users, monkeypatch):
    put_device(client, users["alice"])
    monkeypatch.setattr(settings, "PUSH_ENABLED", False)

    card_for("alice")

    assert queue() == []


def test_nothing_is_queued_for_a_deleted_account(client, users, push_on):
    put_device(client, users["alice"])
    db_exec(update(User).where(User.username == "alice").values(deleted_at=utcnow()))

    card_for("alice")

    assert queue() == []


def test_the_card_and_its_pushes_are_saved_together_or_not_at_all(client, users, push_on):
    put_device(client, users["alice"])
    with SessionLocal() as db:
        notification_service.create_notification(db, username="alice", type=NotificationType.SPACE_ADDED, message="x", space_name="Flat")
        db.rollback()  # whatever made the card failed

    assert queue() == [] and db_all(select(Notification)) == []


def test_a_new_space_pushes_to_the_person_who_was_added(client, users, push_on):
    put_device(client, users["bob"], "bobs-phone")
    space = create_space(client, users["alice"], "Trip", ["bob"])
    sender = FakeSender()

    assert deliver(sender) == {**ZEROS, "sent": 1}

    [(token, platform, title, body, data)] = sender.sent
    assert (token, platform, title, body) == ("bobs-phone", "android", "Trip", "Alice added you to ‘Trip’")
    assert data["type"] == "space_added" and data["space_id"] == str(space["id"])
    assert alices_phone_got_nothing(sender)


def alices_phone_got_nothing(sender) -> bool:
    return all(token != "alices-phone" for token, *_ in sender.sent)


def test_a_reminder_makes_a_card_and_a_push(client, users, push_on):
    put_device(client, users["bob"], "bobs-phone")
    space = create_space(client, users["alice"], "Flat", ["bob"])
    add_expense(space["id"], "alice", "Dinner", {"alice": ("50", ShareStatus.ACCEPTED), "bob": ("50", ShareStatus.ACCEPTED)})
    db_exec(update(ExpenseShare).where(ExpenseShare.username == "bob").values(responded_at=utcnow() - timedelta(days=4)))
    db_exec(delete(PushDelivery))  # forget the push for "you were added"; only the reminder's counts here

    with SessionLocal() as db:
        assert process_due_reminders(db) == 1

    [reminder] = db_all(select(Notification).where(Notification.type == NotificationType.REMINDER))
    assert reminder.username == "bob"
    assert [d.notification_id for d in queue()] == [reminder.id]  # the reminder takes the same path as every other card


def test_a_slow_or_failing_push_service_cannot_touch_a_request(client, users, push_on, monkeypatch):
    """Requests only write rows. The sender is not even looked at until the worker runs."""
    put_device(client, users["bob"])
    monkeypatch.setattr(push_service, "get_sender", lambda: (_ for _ in ()).throw(AssertionError("a request reached the sender")))

    response = client.post("/spaces", json={"name": "Trip", "icon": "trip", "usernames": ["bob"]}, headers=auth(users["alice"]))

    assert response.status_code == 201 and len(queue()) == 1


# --- What is sent -------------------------------------------------------------------------------------


def card_object(**fields) -> Notification:
    values = dict(id=7, username="alice", type=NotificationType.PAYMENT_TO_CONFIRM, message="Bob paid you ₹40", space_id=3, space_name="Flat", ref_id=12)
    values.update(fields)
    return Notification(**values)


def test_the_push_carries_the_cards_own_text_and_says_which_screen_a_tap_opens():
    title, body, data = push_service.payload(card_object())

    assert (title, body) == ("Flat", "Bob paid you ₹40")
    assert data == {"type": "payment_to_confirm", "notification_id": "7", "space_id": "3", "ref_id": "12"}


def test_a_card_with_no_space_or_reference_leaves_those_out_and_is_titled_uomi():
    title, body, data = push_service.payload(card_object(space_id=None, space_name=None, ref_id=None))

    assert (title, body) == ("UOMi", "Bob paid you ₹40") and data == {"type": "payment_to_confirm", "notification_id": "7"}


def test_the_lock_screen_can_be_told_to_show_no_names_or_amounts(monkeypatch):
    monkeypatch.setattr(settings, "PUSH_SHOW_DETAILS", False)

    title, body, data = push_service.payload(card_object())

    assert (title, body) == ("UOMi", "You have a new notification")
    assert "Bob" not in title + body + str(data) and "40" not in title + body  # the tap still knows where to go
    assert data["notification_id"] == "7" and data["space_id"] == "3"


# --- The worker (1.8.3) -------------------------------------------------------------------------------


def test_a_push_that_was_sent_is_removed_from_the_queue(client, users, push_on):
    put_device(client, users["alice"])
    card_for("alice")
    sender = FakeSender()

    assert deliver(sender) == {**ZEROS, "sent": 1}

    assert queue() == [] and len(sender.sent) == 1
    assert deliver(sender) == ZEROS and len(sender.sent) == 1  # nothing is sent twice


def test_a_push_is_not_sent_before_it_is_due(client, users, push_on):
    put_device(client, users["alice"])
    card_for("alice")
    db_exec(update(PushDelivery).values(next_attempt_at=utcnow() + timedelta(minutes=5)))
    sender = FakeSender()

    assert deliver(sender) == ZEROS and sender.sent == [] and len(queue()) == 1


def test_a_run_sends_at_most_a_batch_oldest_first(client, users, push_on, monkeypatch):
    monkeypatch.setattr(push_service, "BATCH", 3)
    put_device(client, users["alice"])
    for number in range(5):
        card_for("alice", message=f"card {number}")
    sender = FakeSender()

    assert deliver(sender)["sent"] == 3
    assert [body for _, _, _, body, _ in sender.sent] == ["card 0", "card 1", "card 2"]
    assert deliver(sender)["sent"] == 2 and queue() == []


def test_a_dead_token_forgets_the_phone_and_what_was_queued_for_it(client, users, push_on):
    put_device(client, users["alice"], "dead-phone")
    put_device(client, users["alice"], "live-phone")
    card_for("alice")
    card_for("alice", message="second")
    sender = FakeSender(PushResult.INVALID_TOKEN)  # the first push to the first phone says the token is dead

    stats = deliver(sender)

    assert stats["invalid_devices"] == 1 and devices_of("alice") == ["live-phone"]
    assert [token for token, *_ in sender.sent][0] == "dead-phone"
    assert all(token == "live-phone" for token in [t for t, *_ in sender.sent][1:])  # the dead one is never tried again
    assert queue() == [] and stats["sent"] == 2  # the live phone got both cards


def test_a_temporary_failure_is_retried_after_30_seconds_then_60_and_then_given_up(client, users, push_on, monkeypatch):
    monkeypatch.setattr(settings, "PUSH_MAX_ATTEMPTS", 3)
    put_device(client, users["alice"])
    card_for("alice")
    sender = FakeSender(PushResult.RETRY, PushResult.RETRY, PushResult.RETRY)
    start = utcnow()

    assert deliver(sender, start) == {**ZEROS, "retried": 1}
    [waiting] = queue()
    assert waiting.attempts == 1 and abs((waiting.next_attempt_at - (start + timedelta(seconds=30))).total_seconds()) < 1

    assert deliver(sender, start + timedelta(seconds=29)) == ZEROS and len(sender.sent) == 1  # not due yet

    second = start + timedelta(seconds=31)
    assert deliver(sender, second) == {**ZEROS, "retried": 1}
    [waiting] = queue()
    assert waiting.attempts == 2 and abs((waiting.next_attempt_at - (second + timedelta(seconds=60))).total_seconds()) < 1

    assert deliver(sender, second + timedelta(seconds=61)) == {**ZEROS, "dropped": 1}  # the third failure is the last
    assert queue() == [] and len(sender.sent) == 3 and devices_of("alice") == ["phone-1"]  # the phone itself is kept


def test_a_retry_that_works_ends_the_wait(client, users, push_on):
    put_device(client, users["alice"])
    card_for("alice")
    sender = FakeSender(PushResult.RETRY, PushResult.SENT)
    start = utcnow()

    deliver(sender, start)
    assert deliver(sender, start + timedelta(seconds=31)) == {**ZEROS, "sent": 1} and queue() == []


def test_a_sender_that_crashes_counts_as_a_temporary_failure_and_does_not_stop_the_rest(client, users, push_on, caplog):
    put_device(client, users["alice"], "phone-1")
    put_device(client, users["alice"], "phone-2")
    card_for("alice")
    sender = FakeSender(RuntimeError("provider down"))

    with caplog.at_level(logging.ERROR, logger="app.services.push_service"):
        stats = deliver(sender)

    assert stats == {**ZEROS, "retried": 1, "sent": 1} and "provider down" in caplog.text
    assert [d.attempts for d in queue()] == [1]  # the one that crashed waits; the other went out


def test_a_phone_that_changed_hands_after_queueing_is_not_sent_the_old_owners_card(client, users, push_on):
    put_device(client, users["alice"])
    card_for("alice")
    db_exec(update(DeviceToken).values(username="bob"))  # moved without the registration path clearing the queue
    sender = FakeSender()

    assert deliver(sender) == {**ZEROS, "dropped": 1} and sender.sent == [] and queue() == []


def test_switching_notifications_off_after_queueing_drops_what_is_waiting(client, users, push_on):
    put_device(client, users["alice"])
    card_for("alice")
    client.patch("/users/me", json={"notifications_on": False}, headers=auth(users["alice"]))
    sender = FakeSender()

    assert deliver(sender) == {**ZEROS, "dropped": 1} and sender.sent == []


def test_a_deleted_account_after_queueing_drops_what_is_waiting(client, users, push_on):
    put_device(client, users["alice"])
    card_for("alice")
    db_exec(update(User).where(User.username == "alice").values(deleted_at=utcnow()))
    sender = FakeSender()

    assert deliver(sender) == {**ZEROS, "dropped": 1} and sender.sent == []


def test_a_card_that_is_deleted_takes_its_queued_pushes_with_it(client, users, push_on):
    put_device(client, users["alice"])
    card_for("alice")

    db_exec(delete(Notification))

    assert queue() == []


def test_the_scheduled_job_sends_with_its_own_session_and_says_so(client, users, push_on, caplog):
    put_device(client, users["alice"])
    card_for("alice")

    with caplog.at_level(logging.INFO, logger="app.services.push_service"):
        push_service.run_push_job()

    assert queue() == [] and "Push worker: 1 sent" in caplog.text
    assert "[push to android device …hone-1] Flat: Alice added you to ‘Flat’" in caplog.text  # what the console sender writes


def test_the_scheduled_job_is_silent_when_nothing_is_due(client, users, push_on, caplog):
    with caplog.at_level(logging.INFO, logger="app.services.push_service"):
        push_service.run_push_job()

    assert "Push worker" not in caplog.text


def test_an_unknown_push_backend_is_logged_and_does_not_crash_the_job(client, users, push_on, monkeypatch, caplog):
    monkeypatch.setattr(settings, "PUSH_BACKEND", "carrier-pigeon")
    put_device(client, users["alice"])
    card_for("alice")

    with caplog.at_level(logging.ERROR, logger="app.services.push_service"):
        push_service.run_push_job()  # does not raise

    assert "cannot start" in caplog.text and len(queue()) == 1  # the push waits for a working sender
    with pytest.raises(RuntimeError, match="carrier-pigeon"):
        push_service.get_sender()


def test_the_console_sender_logs_and_says_sent(caplog):
    with caplog.at_level(logging.INFO, logger="app.services.push_service"):
        result = ConsoleSender().send("a-token-ending-tttttt", "ios", "Flat", "hello", {"type": "reminder"})

    assert result is PushResult.SENT and "[push to ios device …tttttt] Flat: hello {'type': 'reminder'}" in caplog.text


# --- Production -------------------------------------------------------------------------------------


def test_production_will_not_start_with_the_console_push_backend_while_push_is_on():
    refused = production_settings(PUSH_BACKEND="console", PUSH_ENABLED=True).production_problems()  # the tests turn push off by default
    assert any("PUSH_BACKEND" in problem for problem in refused)
    assert production_settings(PUSH_BACKEND="console", PUSH_ENABLED=False).production_problems() == []
    assert production_settings(PUSH_ENABLED=True).production_problems() == []  # fcm, configured: fine


def test_production_needs_the_firebase_settings_for_fcm_and_a_known_backend():
    for missing in ({"FIREBASE_PROJECT_ID": ""}, {"FIREBASE_CREDENTIALS_FILE": ""}):
        problems = production_settings(PUSH_ENABLED=True, **missing).production_problems()
        assert any("FIREBASE" in problem for problem in problems), missing
    assert any("carrier-pigeon" in problem for problem in production_settings(PUSH_ENABLED=True, PUSH_BACKEND="carrier-pigeon").production_problems())


def test_the_fcm_backend_is_built_once_and_needs_its_settings(monkeypatch):
    monkeypatch.setattr(settings, "PUSH_BACKEND", "fcm")
    monkeypatch.setattr(settings, "FIREBASE_PROJECT_ID", "")
    monkeypatch.setattr(settings, "FIREBASE_CREDENTIALS_FILE", "")
    with pytest.raises(RuntimeError, match="FIREBASE_PROJECT_ID"):
        push_service.get_sender()

    from app.services import fcm_sender

    built = []
    monkeypatch.setattr(fcm_sender, "build_fcm_sender", lambda: built.append(1) or FakeSender())
    monkeypatch.setattr(push_service, "_fcm", None)
    monkeypatch.setattr(settings, "FIREBASE_PROJECT_ID", "demo-project")
    monkeypatch.setattr(settings, "FIREBASE_CREDENTIALS_FILE", "firebase.json")
    first, second = push_service.get_sender(), push_service.get_sender()

    assert first is second and built == [1]  # the credentials and their token are not rebuilt on every run of the worker
