"""GET /users/me: the signed-in person's own profile."""

from tests.helpers import auth, error_code, register


def test_users_me(client):
    alice = register(client, "alice")
    register(client, "bob")

    response = client.get("/users/me", headers=auth(alice))
    assert response.status_code == 200
    # exactly these five: the phone is the caller's own, and nothing like password_hash leaks
    assert response.json() == {"username": "alice", "name": "Alice", "phone": "+919876543210", "currency": "INR", "notifications_on": True}


def test_users_me_needs_a_token(client):
    response = client.get("/users/me")
    assert response.status_code == 401
    assert error_code(response) == "not_authenticated"
