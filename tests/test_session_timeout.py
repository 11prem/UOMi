"""The sign-in session: signed out after SESSION_IDLE_TIMEOUT_MINUTES of inactivity."""

from datetime import timedelta

import jwt
from sqlalchemy import select, update

from app.config import settings
from app.database import utcnow
from app.models.refresh_token import RefreshToken
from tests.helpers import auth, db_all, db_exec, error_code, register

IDLE = settings.SESSION_IDLE_TIMEOUT_MINUTES


def set_last_activity(minutes_ago: int) -> None:
    db_exec(update(RefreshToken).values(last_activity_at=utcnow() - timedelta(minutes=minutes_ago)))


def test_idle_session_is_signed_out(client):
    tokens = register(client, "alice")
    set_last_activity(IDLE + 1)

    response = client.get("/spaces", headers=auth(tokens))
    assert response.status_code == 401
    assert error_code(response) == "session_expired"
    assert "inactivity" in response.json()["detail"]["message"]
    assert db_all(select(RefreshToken)) == []  # the session is gone for good

    again = client.get("/spaces", headers=auth(tokens))
    assert again.status_code == 401 and error_code(again) == "session_expired"


def test_activity_inside_the_window_keeps_the_session_alive(client):
    tokens = register(client, "alice")
    set_last_activity(IDLE - 1)

    assert client.get("/spaces", headers=auth(tokens)).status_code == 200
    session = db_all(select(RefreshToken))[0]
    assert utcnow() - session.last_activity_at < timedelta(seconds=30)  # the timer was restarted


def test_an_idle_session_cannot_be_revived_by_refreshing(client):
    tokens = register(client, "alice")
    set_last_activity(IDLE + 1)

    response = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert response.status_code == 401
    assert error_code(response) == "session_expired"
    assert db_all(select(RefreshToken)) == []


def test_refreshing_inside_the_window_counts_as_activity(client):
    tokens = register(client, "alice")
    set_last_activity(IDLE - 1)

    response = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert response.status_code == 200
    session = db_all(select(RefreshToken))[0]
    assert utcnow() - session.last_activity_at < timedelta(seconds=30)


def test_session_ends_at_its_absolute_limit_even_when_active(client):
    tokens = register(client, "alice")
    db_exec(update(RefreshToken).values(expires_at=utcnow() - timedelta(seconds=1)))

    response = client.get("/spaces", headers=auth(tokens))
    assert response.status_code == 401
    assert error_code(response) == "session_expired"


def test_an_expired_access_token_asks_for_a_refresh_not_a_login(client):
    tokens = register(client, "alice")
    session = db_all(select(RefreshToken))[0]
    expired = jwt.encode(
        {
            "sub": "alice",
            "sid": session.id,
            "purpose": "access",
            "iat": utcnow() - timedelta(minutes=20),
            "exp": utcnow() - timedelta(minutes=5),
        },
        settings.SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )
    response = client.get("/spaces", headers={"Authorization": f"Bearer {expired}"})
    assert response.status_code == 401
    assert error_code(response) == "token_expired"

    refreshed = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).json()
    assert client.get("/spaces", headers=auth(refreshed)).status_code == 200
