"""FastAPI entry point. Run with:  uvicorn app.main:app --reload"""

from fastapi import FastAPI

import app.models  # noqa: F401  (imports every model so Base.metadata knows all tables)
from app.config import settings
from app.routers import auth, groups, notifications, users

app = FastAPI(title=settings.APP_NAME, debug=settings.DEBUG)

for _router_module in (auth, users, groups, notifications):
    app.include_router(_router_module.router)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}
