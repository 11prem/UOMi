"""User endpoints: the signed-in person's own profile, and people search for the Add People page."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.user import UserMe, UserSearchResult
from app.services import user_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserMe)
def read_me(current_user: User = Depends(get_current_user)) -> User:
    """Who am I: the username, name, phone and default currency of the signed-in user."""
    return current_user


@router.get("/search", response_model=list[UserSearchResult])
def search_users(
    q: Annotated[str, Query(min_length=1, max_length=50, description="Username, or a full phone number")],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[UserSearchResult]:
    """Add People page, live search: the app sends one request per pause in typing (300 ms)."""
    return user_service.search_users(db, current_user.username, q)
