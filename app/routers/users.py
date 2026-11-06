"""User endpoints: people search for the Add People page."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.user import UserSearchResult
from app.services import user_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/search", response_model=list[UserSearchResult])
def search_users(
    q: Annotated[str, Query(min_length=1, max_length=50, description="Username, or a full phone number")],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[UserSearchResult]:
    """Add People page, live search: the app sends one request per pause in typing (300 ms)."""
    return user_service.search_users(db, current_user.username, q)
