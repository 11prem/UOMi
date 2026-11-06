"""Find people for the Add People page."""

import pytest

from tests.helpers import PHONES, auth, create_space, register


@pytest.fixture
def people(client):
    """alice, bob, bobby, carol and alex are signed up. alice and bob share a space (they are friends)."""
    tokens = {name: register(client, name) for name in PHONES}
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


def test_a_half_typed_phone_number_finds_nobody(client, people):
    assert usernames(search(client, people["alice"], "98765")) == []
    assert usernames(search(client, people["alice"], "9876543")) == []


def test_a_complete_phone_number_finds_exactly_that_person(client, people):
    assert usernames(search(client, people["alice"], PHONES["carol"])) == ["carol"]
    assert usernames(search(client, people["alice"], "+91 98765 43213")) == ["carol"]


def test_is_friend_is_reported(client, people):
    by_phone = search(client, people["alice"], PHONES["bob"]).json()
    assert by_phone == [{"username": "bob", "name": "Bob", "is_friend": True}]
    stranger = search(client, people["alice"], PHONES["carol"]).json()
    assert stranger[0]["is_friend"] is False


def test_results_never_include_the_phone_number(client, people):
    for row in search(client, people["alice"], "bob").json():
        assert set(row) == {"username", "name", "is_friend"}


def test_at_most_ten_rows(client):
    tokens = register(client, "alice")
    for i in range(12):
        register(client, f"user{i:02d}", phone=f"90000000{i:02d}")
    assert len(usernames(search(client, tokens, "user"))) == 10


def test_wildcard_characters_are_matched_literally(client, people):
    # "b_b" must not behave like the pattern b?b, which would match bob
    assert usernames(search(client, people["alice"], "b_b")) == []
    assert usernames(search(client, people["alice"], "b%")) == []


def test_search_needs_a_signed_in_user(client, people):
    assert client.get("/users/search", params={"q": "bob"}).status_code == 401
