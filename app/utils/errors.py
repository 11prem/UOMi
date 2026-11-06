"""One shape for every API error, so the app can switch on `code` instead of parsing text."""

from typing import Any

from fastapi import HTTPException

BEARER_HEADERS = {"WWW-Authenticate": "Bearer"}


def api_error(
    status_code: int,
    code: str,
    message: str,
    headers: dict[str, str] | None = None,
    **extra: Any,
) -> HTTPException:
    """Build an HTTPException whose body is {"detail": {"code": ..., "message": ..., **extra}}.

    `code` is stable and meant for the app (e.g. "session_expired"); `message` is for people.
    Usage: `raise api_error(409, "username_taken", "That username is already taken.")`
    """
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message, **extra},
        headers=headers,
    )
