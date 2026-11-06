"""Sign up, sign in, refresh and logout."""

from app.config import settings
from tests.helpers import PASSWORD, PHONES, auth, error_code, register, register_payload

LOGIN_MAX = settings.LOGIN_MAX_ATTEMPTS


def login(client, username="alice", password=PASSWORD):
    return client.post("/auth/login", json={"username": username, "password": password})


# --- Sign up -----------------------------------------------------------------


def test_register_returns_tokens_and_the_timeouts(client):
    tokens = register(client, "alice")
    assert tokens["token_type"] == "bearer"
    assert tokens["expires_in"] == settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    assert tokens["idle_timeout_seconds"] == settings.SESSION_IDLE_TIMEOUT_MINUTES * 60
    assert client.get("/spaces", headers=auth(tokens)).status_code == 200


def test_register_cleans_up_username_and_phone(client):
    response = client.post(
        "/auth/register", json=register_payload(username="  Alice ", phone="+91 98765-43210")
    )
    assert response.status_code == 201
    assert login(client, "alice").status_code == 200
    # the cleaned-up phone is what is stored, so the plain number is now taken
    again = client.post("/auth/register", json=register_payload(username="alice2"))
    assert again.status_code == 409 and error_code(again) == "phone_taken"


def test_duplicate_username_is_409(client):
    register(client, "alice")
    response = client.post("/auth/register", json=register_payload(username="ALICE", phone=PHONES["bob"]))
    assert response.status_code == 409
    assert error_code(response) == "username_taken"


def test_duplicate_phone_is_409(client):
    register(client, "alice")
    response = client.post("/auth/register", json=register_payload(username="bob"))
    assert response.status_code == 409
    assert error_code(response) == "phone_taken"


def test_register_rejects_bad_input(client):
    bad_payloads = [
        register_payload(confirm_password="different-password"),  # passwords do not match
        register_payload(password="short", confirm_password="short"),  # too short
        register_payload(username="a b"),  # space in the username
        register_payload(username="ab"),  # too short
        register_payload(phone="12345"),  # not a phone number
        register_payload(name="   "),  # empty name
    ]
    for payload in bad_payloads:
        assert client.post("/auth/register", json=payload).status_code == 422, payload


# --- Sign in -----------------------------------------------------------------


def test_login_works_and_is_case_insensitive_on_username(client):
    register(client, "alice")
    response = login(client, " ALICE ")
    assert response.status_code == 200
    assert {"access_token", "refresh_token"} <= response.json().keys()


def test_wrong_username_and_wrong_password_look_the_same(client):
    register(client, "alice")
    wrong_password = login(client, "alice", "wrong-password")
    unknown_user = login(client, "nobody", "wrong-password")
    assert wrong_password.status_code == unknown_user.status_code == 401
    assert wrong_password.json() == unknown_user.json()
    assert error_code(wrong_password) == "invalid_credentials"


def test_too_many_failures_lock_the_account_for_a_while(client):
    register(client, "alice")
    for _ in range(LOGIN_MAX):
        assert login(client, "alice", "wrong-password").status_code == 401
    blocked = login(client, "alice", PASSWORD)  # even the right password is refused now
    assert blocked.status_code == 429
    assert error_code(blocked) == "too_many_attempts"
    assert int(blocked.headers["Retry-After"]) > 0


def test_lockout_looks_the_same_for_unknown_usernames(client):
    for _ in range(LOGIN_MAX):
        assert login(client, "ghost", "wrong-password").status_code == 401
    assert login(client, "ghost", "wrong-password").status_code == 429


def test_a_successful_login_clears_earlier_failures(client):
    register(client, "alice")
    for _ in range(LOGIN_MAX - 1):
        login(client, "alice", "wrong-password")
    assert login(client, "alice").status_code == 200
    for _ in range(LOGIN_MAX - 1):  # the counter started again from zero
        assert login(client, "alice", "wrong-password").status_code == 401


# --- Tokens and sessions -----------------------------------------------------


def test_protected_endpoints_need_a_valid_token(client):
    missing = client.get("/spaces")
    assert missing.status_code == 401 and error_code(missing) == "not_authenticated"
    garbage = client.get("/spaces", headers={"Authorization": "Bearer garbage"})
    assert garbage.status_code == 401 and error_code(garbage) == "invalid_token"


def test_refresh_gives_new_tokens_and_retires_the_old_refresh_token(client):
    tokens = register(client, "alice")
    response = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert response.status_code == 200
    new_tokens = response.json()
    assert new_tokens["refresh_token"] != tokens["refresh_token"]
    assert client.get("/spaces", headers=auth(new_tokens)).status_code == 200

    reused = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert reused.status_code == 401 and error_code(reused) == "invalid_refresh_token"


def test_logout_ends_the_session_everywhere_it_was_used(client):
    register(client, "alice")
    tokens = login(client).json()
    assert client.post("/auth/logout", headers=auth(tokens)).status_code == 204

    after = client.get("/spaces", headers=auth(tokens))
    assert after.status_code == 401 and error_code(after) == "session_expired"
    refresh = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refresh.status_code == 401


def test_logging_out_one_device_leaves_the_other_signed_in(client):
    first = register(client, "alice")
    second = login(client).json()
    client.post("/auth/logout", headers=auth(first))
    assert client.get("/spaces", headers=auth(second)).status_code == 200
