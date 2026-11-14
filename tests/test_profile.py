"""Profile and preferences (task 1.6): the name, the default currency and the notifications switch."""

import pytest

from tests.helpers import auth, create_space, error_code, register


@pytest.fixture
def users(client):
    return {name: register(client, name) for name in ("alice", "bob")}


def update(client, tokens, **body):
    return client.patch("/users/me", json=body, headers=auth(tokens))


def me(client, tokens) -> dict:
    return client.get("/users/me", headers=auth(tokens)).json()


def test_a_new_account_starts_with_the_notifications_on_and_the_default_currency(client, users):
    assert (me(client, users["alice"])["notifications_on"], me(client, users["alice"])["currency"]) == (True, "INR")


def test_the_name_can_be_changed_and_is_tidied(client, users):
    response = update(client, users["alice"], name="  Alice   Rao ")

    assert response.status_code == 200
    assert response.json() == {"username": "alice", "name": "Alice Rao", "phone": "+919876543210", "currency": "INR", "notifications_on": True}
    assert me(client, users["alice"])["name"] == "Alice Rao"


def test_other_people_see_the_new_name_everywhere(client, users):
    space = create_space(client, users["alice"], "Flat", ["bob"])
    update(client, users["alice"], name="Alice Rao")

    page = client.get(f"/spaces/{space['id']}", headers=auth(users["bob"])).json()

    assert [m["name"] for m in page["members"]] == ["Alice Rao", "Bob"]


def test_a_name_of_fifty_characters_is_fine_and_fifty_one_is_not(client, users):
    assert update(client, users["alice"], name="n" * 50).status_code == 200
    response = update(client, users["alice"], name="n" * 51)
    assert response.status_code == 422 and [f["field"] for f in response.json()["detail"]["fields"]] == ["name"]


@pytest.mark.parametrize("name", ["", "   ", "Al" + chr(0) + "ice"])
def test_an_empty_or_unstorable_name_is_refused(client, users, name):
    assert update(client, users["alice"], name=name).status_code == 422
    assert me(client, users["alice"])["name"] == "Alice"


@pytest.mark.parametrize("field, value", [("username", "alice2"), ("phone", "+919876543299"), ("password_hash", "x"), ("theme", "dark")])
def test_the_username_the_phone_and_anything_else_cannot_be_set_here(client, users, field, value):
    response = update(client, users["alice"], **{field: value})

    assert response.status_code == 422 and error_code(response) == "validation_error"
    assert [f["field"] for f in response.json()["detail"]["fields"]] == [field]
    assert me(client, users["alice"])["username"] == "alice"


def test_the_default_currency_is_changed_and_feeds_a_new_space(client, users):
    assert update(client, users["alice"], currency="USD").json()["currency"] == "USD"

    omitted = client.post("/spaces", json={"name": "Trip", "icon": "trip", "usernames": ["bob"]}, headers=auth(users["alice"]))
    explicit = client.post("/spaces", json={"name": "Flat", "icon": "home", "currency": "EUR", "usernames": ["bob"]}, headers=auth(users["alice"]))

    assert omitted.json()["currency"] == "USD"  # the new default, when none is picked
    assert explicit.json()["currency"] == "EUR"  # a picked one wins
    other = client.post("/spaces", json={"name": "Trip", "icon": "trip", "usernames": ["alice"]}, headers=auth(users["bob"]))
    assert other.json()["currency"] == "INR"  # nobody else's default changed


def test_changing_the_default_does_not_touch_the_spaces_that_exist(client, users):
    space = create_space(client, users["alice"], "Flat", [])
    update(client, users["alice"], currency="USD")
    assert client.get(f"/spaces/{space['id']}", headers=auth(users["alice"])).json()["currency"] == "INR"


@pytest.mark.parametrize("currency", ["XYZ", "usd", "", "US", 5])
def test_an_unknown_currency_is_refused(client, users, currency):
    response = update(client, users["alice"], currency=currency)
    assert response.status_code == 422 and "currency" in [f["field"] for f in response.json()["detail"]["fields"]]
    assert me(client, users["alice"])["currency"] == "INR"


def test_the_notifications_switch_is_stored_per_person(client, users):
    assert update(client, users["alice"], notifications_on=False).json()["notifications_on"] is False

    assert me(client, users["alice"])["notifications_on"] is False
    assert me(client, users["bob"])["notifications_on"] is True
    assert update(client, users["alice"], notifications_on=True).json()["notifications_on"] is True


@pytest.mark.parametrize("value", ["false", 0, 1, "yes", None])
def test_the_switch_must_be_a_real_true_or_false(client, users, value):
    response = update(client, users["alice"], notifications_on=value)
    if value is None:  # null means "leave it"
        assert response.status_code == 200 and response.json()["notifications_on"] is True
    else:
        assert response.status_code == 422 and [f["field"] for f in response.json()["detail"]["fields"]] == ["notifications_on"]


def test_a_field_left_out_or_null_is_left_alone_and_everything_can_go_in_one_request(client, users):
    assert update(client, users["alice"]).status_code == 200  # nothing to change is not an error
    update(client, users["alice"], name=None, currency=None, notifications_on=None)
    assert me(client, users["alice"]) == {"username": "alice", "name": "Alice", "phone": "+919876543210", "currency": "INR", "notifications_on": True}

    changed = update(client, users["alice"], name="Alice Rao", currency="GBP", notifications_on=False).json()
    assert (changed["name"], changed["currency"], changed["notifications_on"]) == ("Alice Rao", "GBP", False)


def test_one_bad_field_changes_nothing(client, users):
    response = update(client, users["alice"], name="Alice Rao", currency="XYZ")

    assert response.status_code == 422
    assert (me(client, users["alice"])["name"], me(client, users["alice"])["currency"]) == ("Alice", "INR")


def test_you_must_be_signed_in(client):
    response = client.patch("/users/me", json={"name": "x"})
    assert response.status_code == 401 and error_code(response) == "not_authenticated"
