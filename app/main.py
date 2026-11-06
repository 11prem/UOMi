"""FastAPI entry point. Run with:  uvicorn app.main:app --reload"""

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

import app.models  # noqa: F401  (imports every model so Base.metadata knows all tables)
from app.config import settings
from app.routers import auth, groups, notifications, users
from app.utils.errors import http_error_handler, unhandled_error_handler, validation_error_handler

app = FastAPI(title=settings.APP_NAME, debug=settings.DEBUG)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=False,  # tokens travel in the Authorization header, not cookies
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Retry-After"],
)
app.add_exception_handler(RequestValidationError, validation_error_handler)
app.add_exception_handler(StarletteHTTPException, http_error_handler)
app.add_exception_handler(Exception, unhandled_error_handler)

for _router_module in (auth, users, groups, notifications):
    app.include_router(_router_module.router)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}
