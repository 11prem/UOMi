"""FcmSender (task 1.8.2): sends one push through Firebase Cloud Messaging, using its HTTP v1 API.

HONEST STATUS: this is built and tested against a fake transport only (`tests/test_fcm_sender.py`). It has not been run
against the real service, because that needs the Firebase project (task 0.6) and its service-account file. Before relying
on it, send one real push to a real phone (task 6.4) and check the answers for a dead token and for a temporary failure.

Needs two packages that are not in requirements.txt yet: `google-auth` and `requests` (for the service-account token).
They are imported only when PUSH_BACKEND=fcm, so nothing else needs them.

How answers map to what the worker does (see push_service.PushResult):
  * 2xx                                  -> SENT
  * the token is dead (404, UNREGISTERED, SENDER_ID_MISMATCH, or 400 naming the registration token) -> INVALID_TOKEN,
    so the worker forgets the phone
  * everything else (429, 5xx, a refused credential, a network error, a timeout) -> RETRY: tried again later, then given up
"""

import logging
from collections.abc import Callable
from typing import Any

from app.config import settings
from app.services.push_service import PushResult

logger = logging.getLogger(__name__)

SEND_URL = "https://fcm.googleapis.com/v1/projects/{project}/messages:send"
SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
TIMEOUT_SECONDS = 10  # a slow call holds up the worker only, never a request

Post = Callable[[str, dict[str, str], dict[str, Any]], tuple[int, dict[str, Any]]]  # (url, headers, json) -> (status, json)


class FcmSender:
    def __init__(self, project_id: str, access_token: Callable[[], str], post: Post):
        self._url = SEND_URL.format(project=project_id)
        self._access_token = access_token
        self._post = post

    def send(self, token: str, platform: str, title: str, body: str, data: dict[str, str]) -> PushResult:
        message: dict[str, Any] = {"token": token, "notification": {"title": title, "body": body}, "data": data}
        if platform == "android":
            message["android"] = {"priority": "HIGH"}  # wake the phone for a card the person is waiting on
        elif platform == "ios":
            message["apns"] = {"headers": {"apns-priority": "10"}, "payload": {"aps": {"sound": "default"}}}
        try:
            status, payload = self._post(self._url, {"Authorization": f"Bearer {self._access_token()}"}, {"message": message})
        except Exception:
            logger.exception("FCM request failed")
            return PushResult.RETRY
        return result_of(status, payload)


def result_of(status: int, payload: dict[str, Any]) -> PushResult:
    """What an FCM answer means for the worker."""
    if 200 <= status < 300:
        return PushResult.SENT
    error = payload.get("error", {}) if isinstance(payload, dict) else {}
    error = error if isinstance(error, dict) else {}
    details = [d.get("errorCode") for d in error.get("details", []) if isinstance(d, dict)]
    message = str(error.get("message", ""))
    token_is_dead = (
        status == 404
        or error.get("status") == "NOT_FOUND"
        or "UNREGISTERED" in details
        or "SENDER_ID_MISMATCH" in details
        or (status == 400 and error.get("status") == "INVALID_ARGUMENT" and "registration token" in message.lower())
    )
    if token_is_dead:
        return PushResult.INVALID_TOKEN
    logger.warning("FCM answered %s %s: %s", status, error.get("status", ""), message[:200])
    return PushResult.RETRY


def _httpx_post(url: str, headers: dict[str, str], body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    import httpx  # a runtime dependency only when PUSH_BACKEND=fcm

    response = httpx.post(url, headers=headers, json=body, timeout=TIMEOUT_SECONDS)
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    return response.status_code, payload


def _service_account_token(credentials_file: str) -> Callable[[], str]:
    try:
        from google.auth.transport.requests import Request
        from google.oauth2 import service_account
    except ImportError as error:
        raise RuntimeError("PUSH_BACKEND=fcm needs the google-auth and requests packages: pip install google-auth requests") from error
    credentials = service_account.Credentials.from_service_account_file(credentials_file, scopes=[SCOPE])

    def token() -> str:
        if not credentials.valid:  # fetches a new access token when the last one has run out
            credentials.refresh(Request())
        return credentials.token

    return token


def build_fcm_sender() -> FcmSender:
    """The real sender, from FIREBASE_PROJECT_ID and FIREBASE_CREDENTIALS_FILE. Raises RuntimeError when not set up."""
    if not settings.FIREBASE_PROJECT_ID or not settings.FIREBASE_CREDENTIALS_FILE:
        raise RuntimeError("PUSH_BACKEND=fcm needs FIREBASE_PROJECT_ID and FIREBASE_CREDENTIALS_FILE (the Firebase project, task 0.6)")
    return FcmSender(settings.FIREBASE_PROJECT_ID, _service_account_token(settings.FIREBASE_CREDENTIALS_FILE), _httpx_post)
