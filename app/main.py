"""FastAPI entry point. Run with:  uvicorn app.main:app --reload"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

import app.models  # noqa: F401  (imports every model so Base.metadata knows all tables)
from app.config import check_production_settings, settings
from app.routers import auth, groups, notifications, users
from app.services.reminder_scheduler import start_scheduler, stop_scheduler
from app.utils.errors import http_error_handler, unhandled_error_handler, validation_error_handler
from app.utils.log_redaction import install_access_log_redaction
from app.utils.middleware import SafeErrorsMiddleware, SecurityHeadersMiddleware


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.REMINDERS_ENABLED:
        start_scheduler()
    yield
    stop_scheduler()


def create_app() -> FastAPI:
    """Build the API. In production this refuses to start with unsafe settings and has no /docs page."""
    check_production_settings()  # raises in production when a setting is unsafe, does nothing elsewhere
    docs_on = not settings.is_production

    application = FastAPI(
        title=settings.APP_NAME,
        debug=settings.DEBUG,
        lifespan=lifespan,
        docs_url="/docs" if docs_on else None,
        redoc_url="/redoc" if docs_on else None,
        openapi_url="/openapi.json" if docs_on else None,
    )

    # Each add_middleware call wraps everything added before it, so the LAST one added is the outermost.
    # A crash is turned into the JSON 500 by the innermost one, so CORS (outside it) still adds its headers
    # to that 500; the headers middleware is outermost and so covers every reply, including CORS preflights.
    application.add_middleware(SafeErrorsMiddleware)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=False,  # tokens travel in the Authorization header, not cookies
        allow_methods=["*"],
        allow_headers=["Authorization", "Content-Type"],
        expose_headers=["Retry-After"],
    )
    application.add_middleware(SecurityHeadersMiddleware)

    application.add_exception_handler(RequestValidationError, validation_error_handler)
    application.add_exception_handler(StarletteHTTPException, http_error_handler)
    application.add_exception_handler(Exception, unhandled_error_handler)

    for router_module in (auth, users, groups, notifications):
        application.include_router(router_module.router)

    @application.get("/health", tags=["meta"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    install_access_log_redaction()  # keep search terms (phone numbers) out of the access log
    return application


app = create_app()
