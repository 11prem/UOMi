"""The notification cards: paging, unread count, and marking them read."""

from sqlalchemy import delete

from app.database import SessionLocal
from app.models.group import Space
from app.models.notification import Notification, NotificationType
from tests.helpers import auth, create_space, db_exec, error_code, register


def insert_cards(username: str, count: int) -> None:
    with SessionLocal() as session:
        for i in range(count):
            session.add(
                Notification(username=username, type=NotificationType.REMINDER, message=f"Card {i + 1}")
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
    assert [c["message"] for c in first["items"]] == [f"Card {n}" for n in range(25, 15, -1)]
    assert first["next_before"] == first["items"][-1]["id"]

    second = page(client, alice, limit=10, before=first["next_before"])
    assert [c["message"] for c in second["items"]] == [f"Card {n}" for n in range(15, 5, -1)]

    third = page(client, alice, limit=10, before=second["next_before"])
    assert [c["message"] for c in third["items"]] == [f"Card {n}" for n in range(5, 0, -1)]
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


def test_list_has_unread_count_and_new_fields(client):
    alice = register(client, "alice")
    bob = register(client, "bob")
    space = create_space(client, alice, "Goa Trip", ["bob"])

    result = page(client, bob)
    assert set(result) == {"items", "next_before", "unread_count"}
    assert result["unread_count"] == 1

    card = result["items"][0]
    # exactly these keys: no title, body or is_read any more
    assert set(card) == {
        "id", "type", "message", "space_id", "space_name", "ref_id", "needs_answer", "read", "created_at",
    }  # fmt: skip
    assert card["type"] == "space_added"
    assert card["message"] == "Alice added you to ‘Goa Trip’"
    assert (card["space_id"], card["space_name"], card["ref_id"]) == (space["id"], "Goa Trip", None)
    assert card["needs_answer"] is False
    assert card["read"] is False
    assert card["created_at"].endswith("Z")


def unread_count(client, tokens):
    response = client.get("/notifications/unread-count", headers=auth(tokens))
    assert response.status_code == 200, response.text
    assert set(response.json()) == {"unread_count"}
    return response.json()["unread_count"]


def test_unread_count_endpoint(client):
    alice = register(client, "alice")
    bob = register(client, "bob")
    insert_cards("alice", 3)
    insert_cards("bob", 2)

    assert unread_count(client, alice) == 3  # only the caller's cards
    assert unread_count(client, bob) == 2
    assert unread_count(client, alice) == page(client, alice, limit=1)["unread_count"]  # one source for both

    card_id = page(client, alice)["items"][0]["id"]
    client.patch(f"/notifications/{card_id}", json={"read": True}, headers=auth(alice))
    assert unread_count(client, alice) == 2  # read cards drop out

    assert client.get("/notifications/unread-count").status_code == 401


def test_read_all(client):
    alice = register(client, "alice")
    bob = register(client, "bob")
    insert_cards("alice", 3)
    insert_cards("bob", 2)
    assert page(client, alice, limit=2)["unread_count"] == 3  # counts every card, not just this page

    response = client.patch("/notifications/read-all", headers=auth(alice))
    assert response.status_code == 200 and response.json() == {"updated_count": 3}

    result = page(client, alice)
    assert result["unread_count"] == 0
    assert all(card["read"] for card in result["items"])
    assert page(client, bob)["unread_count"] == 2  # bob's cards are untouched


def test_read_all_with_nothing_unread_updates_zero(client):
    alice = register(client, "alice")
    response = client.patch("/notifications/read-all", headers=auth(alice))
    assert response.status_code == 200 and response.json() == {"updated_count": 0}

    insert_cards("alice", 1)
    client.patch("/notifications/read-all", headers=auth(alice))
    again = client.patch("/notifications/read-all", headers=auth(alice))
    assert again.json() == {"updated_count": 0}  # already-read cards are not counted again


def test_read_all_is_patch_only(client):
    alice = register(client, "alice")
    response = client.post("/notifications/read-all", headers=auth(alice))
    assert response.status_code == 405 and error_code(response) == "method_not_allowed"


def test_patch_read_field(client):
    alice = register(client, "alice")
    insert_cards("alice", 1)
    card_id = page(client, alice)["items"][0]["id"]

    response = client.patch(f"/notifications/{card_id}", json={"read": True}, headers=auth(alice))
    assert response.status_code == 200 and response.json()["read"] is True
    assert page(client, alice)["unread_count"] == 0

    # the old field name is gone: `read` is required
    old = client.patch(f"/notifications/{card_id}", json={"is_read": False}, headers=auth(alice))
    assert old.status_code == 422
    assert page(client, alice)["items"][0]["read"] is True

    unread = client.patch(f"/notifications/{card_id}", json={"read": False}, headers=auth(alice))
    assert unread.json()["read"] is False


def test_space_deleted_notification_survives_space_delete(client):
    alice = register(client, "alice")
    bob = register(client, "bob")
    space = create_space(client, alice, "Goa Trip", ["bob"])
    with SessionLocal() as session:
        session.add(
            Notification(
                username="bob",
                type=NotificationType.SPACE_DELETED,
                message="Alice deleted Goa Trip",
                space_id=space["id"],
                space_name="Goa Trip",
            )
        )
        session.commit()

    db_exec(delete(Space).where(Space.id == space["id"]))

    cards = {card["type"]: card for card in page(client, bob)["items"]}
    assert set(cards) == {"space_added", "space_deleted"}  # both cards outlive the space
    assert cards["space_deleted"]["space_id"] is None
    assert cards["space_deleted"]["space_name"] == "Goa Trip"


def test_someone_elses_card_is_not_found(client):
    alice = register(client, "alice")
    bob = register(client, "bob")
    insert_cards("alice", 1)
    card_id = page(client, alice)["items"][0]["id"]

    response = client.patch(f"/notifications/{card_id}", json={"read": True}, headers=auth(bob))
    assert response.status_code == 404 and error_code(response) == "notification_not_found"
    assert page(client, alice)["items"][0]["read"] is False  # untouched


def test_notifications_need_a_signed_in_user(client):
    assert client.get("/notifications").status_code == 401
    assert client.patch("/notifications/1", json={"read": True}).status_code == 401
    assert client.get("/notifications/unread-count").status_code == 401
    assert client.patch("/notifications/read-all").status_code == 401
