"""Find people for the Add People page."""

import pytest

from tests.helpers import EMAILS, auth, create_space, register


@pytest.fixture
def people(client):
    """alice, bob, bobby, carol and alex are signed up. alice and bob share a space (they are friends)."""
    tokens = {name: register(client, name) for name in EMAILS}
    create_space(client, tokens["alice"], "Trip", ["bob"])
    return tokens


def search(client, tokens, q):
    return client.get("/users/search", params={"q": q}, headers=auth(tokens))


def usernames(response) -> list[str]:
    assert response.status_code == 200, response.text
    return [row["username"] for row in response.json()]


def test_friends_match_from_the_first_letter(client, people):
    assert usernames(search(client, people["alice"], "b")) == ["bob"]  # bobby is not a friend yet
    assert usernames(search(client, people["alice"], "bo")) == ["bob"]


def test_everyone_matches_from_three_letters_and_friends_come_first(client, people):
    assert usernames(search(client, people["alice"], "bob")) == ["bob", "bobby"]
    assert usernames(search(client, people["alice"], "ale")) == ["alex"]


def test_you_never_find_yourself(client, people):
    assert usernames(search(client, people["alice"], "alice")) == []


def test_an_email_address_finds_nobody(client, people):
    # people are found by username only: not by a whole address, and not by the part before the '@'
    assert usernames(search(client, people["alice"], EMAILS["carol"])) == []
    assert usernames(search(client, people["alice"], "carol@")) == []
    assert usernames(search(client, people["alice"], "@example.com")) == []


def test_is_friend_is_reported(client, people):
    friend = search(client, people["alice"], "bob").json()
    assert friend[0] == {"username": "bob", "name": "Bob", "is_friend": True}
    stranger = search(client, people["alice"], "car").json()
    assert stranger == [{"username": "carol", "name": "Carol", "is_friend": False}]


def test_results_never_include_an_email_address(client, people):
    for row in search(client, people["alice"], "bob").json():
        assert set(row) == {"username", "name", "is_friend"}


def test_at_most_ten_rows(client):
    tokens = register(client, "alice")
    for i in range(12):
        register(client, f"user{i:02d}", email=f"user{i:02d}@example.com")
    assert len(usernames(search(client, tokens, "user"))) == 10


def test_wildcard_characters_are_matched_literally(client, people):
    # "b_b" must not behave like the pattern b?b, which would match bob
    assert usernames(search(client, people["alice"], "b_b")) == []
    assert usernames(search(client, people["alice"], "b%")) == []


def test_search_needs_a_signed_in_user(client, people):
    assert client.get("/users/search", params={"q": "bob"}).status_code == 401
