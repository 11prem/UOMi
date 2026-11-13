"""FcmSender (task 1.8.2), against a fake transport. It has not been run against the real FCM: see the module's note."""

import logging

import pytest

from app.config import settings
from app.services import fcm_sender
from app.services.fcm_sender import FcmSender, build_fcm_sender, result_of
from app.services.push_service import PushResult

DATA = {"type": "space_added", "notification_id": "7"}


class FakePost:
    """Stands in for the HTTP call: records it, then answers with (status, body) or raises."""

    def __init__(self, status=200, body=None, error=None):
        self.answer = (status, body if body is not None else {"name": "projects/demo/messages/1"})
        self.error = error
        self.calls: list[tuple[str, dict, dict]] = []

    def __call__(self, url, headers, body):
        self.calls.append((url, headers, body))
        if self.error:
            raise self.error
        return self.answer


def sender(post: FakePost) -> FcmSender:
    return FcmSender("demo-project", lambda: "an-access-token", post)


def error_body(status: str, message: str = "", *codes: str) -> dict:
    return {"error": {"code": 0, "status": status, "message": message, "details": [{"errorCode": code} for code in codes]}}


def test_a_push_is_one_request_to_the_projects_send_url_with_the_bearer_token():
    post = FakePost()

    result = sender(post).send("a-device-token", "android", "Flat", "Alice added you to ‘Flat’", DATA)

    assert result is PushResult.SENT
    [(url, headers, body)] = post.calls
    assert url == "https://fcm.googleapis.com/v1/projects/demo-project/messages:send"
    assert headers == {"Authorization": "Bearer an-access-token"}
    message = body["message"]
    assert message["token"] == "a-device-token"
    assert message["notification"] == {"title": "Flat", "body": "Alice added you to ‘Flat’"}
    assert message["data"] == DATA and all(isinstance(v, str) for v in message["data"].values())  # FCM wants strings


def test_android_gets_high_priority_and_ios_gets_the_apns_headers():
    android, ios, web = FakePost(), FakePost(), FakePost()

    sender(android).send("t", "android", "x", "y", DATA)
    sender(ios).send("t", "ios", "x", "y", DATA)
    sender(web).send("t", "web", "x", "y", DATA)

    assert android.calls[0][2]["message"]["android"] == {"priority": "HIGH"} and "apns" not in android.calls[0][2]["message"]
    assert ios.calls[0][2]["message"]["apns"]["headers"] == {"apns-priority": "10"} and "android" not in ios.calls[0][2]["message"]
    assert "android" not in web.calls[0][2]["message"] and "apns" not in web.calls[0][2]["message"]


@pytest.mark.parametrize("status", [200, 201, 204])
def test_any_2xx_is_sent(status):
    assert result_of(status, {}) is PushResult.SENT


@pytest.mark.parametrize(
    "status, body",
    [
        (404, error_body("NOT_FOUND", "Requested entity was not found.", "UNREGISTERED")),
        (404, {}),
        (403, error_body("PERMISSION_DENIED", "", "SENDER_ID_MISMATCH")),
        (400, error_body("INVALID_ARGUMENT", "The registration token is not a valid FCM registration token")),
        (200 + 200, error_body("NOT_FOUND")),
    ],
)
def test_a_dead_token_says_so_and_the_phone_is_forgotten(status, body):
    assert result_of(status, body) is PushResult.INVALID_TOKEN


@pytest.mark.parametrize(
    "status, body",
    [
        (429, error_body("RESOURCE_EXHAUSTED", "Quota exceeded")),
        (500, error_body("INTERNAL", "Internal error")),
        (503, error_body("UNAVAILABLE", "The service is unavailable")),
        (401, error_body("UNAUTHENTICATED", "Request had invalid authentication credentials")),
        (403, error_body("PERMISSION_DENIED", "Permission denied")),
        (400, error_body("INVALID_ARGUMENT", "Message data too long")),  # a bad payload is not a dead token
        (502, {}),
        (500, "not even json"),
    ],
)
def test_everything_else_is_a_temporary_failure_and_the_phone_is_kept(status, body):
    assert result_of(status, body) is PushResult.RETRY


def test_a_network_error_or_timeout_is_a_temporary_failure(caplog):
    with caplog.at_level(logging.ERROR, logger="app.services.fcm_sender"):
        result = sender(FakePost(error=TimeoutError("timed out"))).send("t", "android", "x", "y", DATA)

    assert result is PushResult.RETRY and "FCM request failed" in caplog.text


def test_a_failure_to_get_an_access_token_is_a_temporary_failure():
    def broken_token() -> str:
        raise OSError("no network")

    assert FcmSender("demo-project", broken_token, FakePost()).send("t", "android", "x", "y", DATA) is PushResult.RETRY


def test_the_real_sender_needs_its_settings(monkeypatch):
    monkeypatch.setattr(settings, "FIREBASE_PROJECT_ID", "demo-project")
    monkeypatch.setattr(settings, "FIREBASE_CREDENTIALS_FILE", "")

    with pytest.raises(RuntimeError, match="FIREBASE_CREDENTIALS_FILE"):
        build_fcm_sender()


def test_without_the_google_packages_it_says_what_to_install(monkeypatch):
    import builtins

    real_import = builtins.__import__

    def refuse_google(name, *args, **kwargs):
        if name.startswith("google"):
            raise ImportError(name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", refuse_google)

    with pytest.raises(RuntimeError, match="google-auth"):
        fcm_sender._service_account_token("firebase.json")
