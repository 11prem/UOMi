"""One shape for every API error, so the app can switch on `code` instead of parsing text."""

from typing import Any

from fastapi import HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

BEARER_HEADERS = {"WWW-Authenticate": "Bearer"}

# Framework errors (no route, wrong method) arrive with a plain-text detail; these give them a code.
_HTTP_CODES = {404: "not_found", 405: "method_not_allowed"}


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


async def http_error_handler(request: Request, exc: StarletteHTTPException) -> Response:
    """Errors raised by api_error() already have the envelope; Starlette's own 404/405 get it here."""
    if not isinstance(exc.detail, dict):
        exc = api_error(
            exc.status_code, _HTTP_CODES.get(exc.status_code, "http_error"), str(exc.detail), headers=exc.headers
        )
    return await http_exception_handler(request, exc)


async def validation_error_handler(request: Request, exc: RequestValidationError) -> Response:
    """422 with one {field, message} per problem. Only `loc` and `msg` are used, so the input is never echoed."""
    fields = [
        {
            "field": ".".join(str(part) for part in (error["loc"][1:] or error["loc"])),
            "message": error["msg"].removeprefix("Value error, "),
        }
        for error in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={"detail": {"code": "validation_error", "message": "Some fields are invalid.", "fields": fields}},
    )


async def unhandled_error_handler(request: Request, exc: Exception) -> Response:
    """Any other crash: JSON instead of a plain-text 500, with nothing about the cause."""
    return JSONResponse(
        status_code=500,
        content={
            "detail": {"code": "internal_error", "message": "Something went wrong on our side. Please try again."}
        },
    )
