"""Two small ASGI middlewares (Phase 2, task 2.8).

SafeErrorsMiddleware
    Turns a crash into the JSON `internal_error` reply. It sits INSIDE the CORS middleware, so the
    500 still carries the CORS headers: without that, a browser hides the real error behind a
    generic "blocked by CORS" failure. (Starlette's own 500 handler sits outside every middleware.)

SecurityHeadersMiddleware
    `Cache-Control: no-store` on every response to a request that carries a token, and on /auth/*
    (those responses hold tokens), so nothing sensitive is kept by a browser or a proxy.
    `Strict-Transport-Security` in production only, because a browser ignores it over plain HTTP.
"""

import logging

from starlette.datastructures import Headers, MutableHeaders
from starlette.requests import ClientDisconnect
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import settings
from app.utils.errors import internal_error_response

logger = logging.getLogger("uomi.errors")

HSTS = "max-age=63072000; includeSubDomains"  # two years


class SafeErrorsMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except ClientDisconnect:
            raise  # the client went away mid-request: nobody is left to answer, and it is not a server bug
        except Exception:
            # Log the path only: the query string can hold a phone number.
            logger.exception("Unhandled error on %s %s", scope.get("method"), scope.get("path"))
            if response_started:  # too late to change the reply
                raise
            await internal_error_response()(scope, receive, send)


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        has_token = "authorization" in Headers(scope=scope)
        sensitive = has_token or scope.get("path", "").startswith("/auth/")

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                if sensitive:
                    headers.setdefault("Cache-Control", "no-store")
                if settings.ENVIRONMENT == "production":
                    headers.setdefault("Strict-Transport-Security", HSTS)
            await send(message)

        await self.app(scope, receive, send_with_headers)
