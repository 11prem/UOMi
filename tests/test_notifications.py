"""The notification cards: paging and marking them read."""

from app.database import SessionLocal
from app.models.notification import Notification, NotificationType
from tests.helpers import auth, error_code, register


def insert_cards(username: str, count: int) -> None:
    with SessionLocal() as session:
        for i in range(count):
            session.add(
                Notification(username=username, type=NotificationType.PAYMENT_REMINDER, title=f"Card {i + 1}")
            )
        session.commit()


def page(client, tokens, **params):
    response = client.get("/notifications", params=params, headers=auth(tokens))
    assert response.status_code == 200, response.text
    return response.json()


def test_pages_run_newest_first_until_the_last_one(client):
    alice = register(client, "alice")
    insert_cards("alice", 25)

    first = page(client, alice, limit=10)
    assert [c["title"] for c in first["items"]] == [f"Card {n}" for n in range(25, 15, -1)]
    assert first["next_before"] == first["items"][-1]["id"]

    second = page(client, alice, limit=10, before=first["next_before"])
    assert [c["title"] for c in second["items"]] == [f"Card {n}" for n in range(15, 5, -1)]

    third = page(client, alice, limit=10, before=second["next_before"])
    assert [c["title"] for c in third["items"]] == [f"Card {n}" for n in range(5, 0, -1)]
    assert third["next_before"] is None  # that was the last page


def test_exactly_one_full_page_has_no_next_page(client):
    alice = register(client, "alice")
    insert_cards("alice", 10)
    result = page(client, alice, limit=10)
    assert len(result["items"]) == 10 and result["next_before"] is None


def test_default_page_size_is_twenty(client):
    alice = register(client, "alice")
    insert_cards("alice", 25)
    result = page(client, alice)
    assert len(result["items"]) == 20 and result["next_before"] is not None


def test_page_size_has_a_limit(client):
    alice = register(client, "alice")
    assert client.get("/notifications", params={"limit": 51}, headers=auth(alice)).status_code == 422
    assert client.get("/notifications", params={"limit": 0}, headers=auth(alice)).status_code == 422


def test_you_only_see_your_own_cards(client):
    alice = register(client, "alice")
    bob = register(client, "bob")
    insert_cards("alice", 3)
    assert len(page(client, alice)["items"]) == 3
    assert page(client, bob)["items"] == []


def test_mark_a_card_read_and_unread(client):
    alice = register(client, "alice")
    insert_cards("alice", 1)
    card = page(client, alice)["items"][0]
    assert card["is_read"] is False

    read = client.patch(f"/notifications/{card['id']}", json={"is_read": True}, headers=auth(alice))
    assert read.status_code == 200 and read.json()["is_read"] is True
    assert page(client, alice)["items"][0]["is_read"] is True

    unread = client.patch(f"/notifications/{card['id']}", json={"is_read": False}, headers=auth(alice))
    assert unread.json()["is_read"] is False


def test_someone_elses_card_is_not_found(client):
    alice = register(client, "alice")
    bob = register(client, "bob")
    insert_cards("alice", 1)
    card_id = page(client, alice)["items"][0]["id"]

    response = client.patch(f"/notifications/{card_id}", json={"is_read": True}, headers=auth(bob))
    assert response.status_code == 404 and error_code(response) == "notification_not_found"
    assert page(client, alice)["items"][0]["is_read"] is False  # untouched


def test_notifications_need_a_signed_in_user(client):
    assert client.get("/notifications").status_code == 401
    assert client.patch("/notifications/1", json={"is_read": True}).status_code == 401

def unread_count(client, tokens):
    response = client.get(
        "/notifications/unread-count",
        headers=auth(tokens),
    )
    assert response.status_code == 200, response.text
    return response.json()["unread_count"]

def test_unread_count_is_correct_for_each_user(client):
    alice = register(client, "alice")
    bob = register(client, "bob")

    insert_cards("alice", 3)
    insert_cards("bob", 2)

    assert unread_count(client, alice) == 3
    assert unread_count(client, bob) == 2

def test_mark_all_notifications_as_read(client):
    alice = register(client, "alice")
    bob = register(client, "bob")

    insert_cards("alice", 3)
    insert_cards("bob", 2)

    response = client.patch(
        "/notifications/read-all",
        headers=auth(alice),
    )

    assert response.status_code == 200
    assert response.json()["updated_count"] == 3

    # Alice's notifications are now all read.
    assert unread_count(client, alice) == 0

    # Bob's notifications must remain untouched.
    assert unread_count(client, bob) == 2

    alice_cards = page(client, alice)["items"]
    assert all(card["is_read"] is True for card in alice_cards)


def test_mark_all_returns_zero_when_no_unread_notifications(client):
    alice = register(client, "alice")

    response = client.patch(
        "/notifications/read-all",
        headers=auth(alice),
    )

    assert response.status_code == 200
    assert response.json()["updated_count"] == 0
    assert unread_count(client, alice) == 0