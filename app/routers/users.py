"""User endpoints: the signed-in person's own profile, and people search for the Add People page."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.user import UserMe, UserSearchResult
from app.services import user_service
from app.utils.rate_limit import HOUR, MINUTE, enforce, search_ip_limit
from app.utils.validators import parse_full_phone

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserMe)
def read_me(current_user: User = Depends(get_current_user)) -> User:
    """Who am I: the username, name, phone and default currency of the signed-in user."""
    return current_user


@router.get("/search", response_model=list[UserSearchResult], dependencies=[Depends(search_ip_limit)])
def search_users(
    q: Annotated[str, Query(min_length=1, max_length=50, description="Username, or a full phone number")],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[UserSearchResult]:
    """Add People page, live search: the app sends one request per pause in typing (300 ms).

    Searching is limited per address and per user. Looking someone up by a complete phone number is
    limited much harder, because that is the lookup that can reveal who is registered: a person adding
    friends needs a handful of these, a script testing numbers needs thousands.
    """
    enforce(f"search:user:{current_user.username}", settings.SEARCH_MAX_PER_USER_PER_MINUTE, MINUTE)
    if parse_full_phone(q) is not None:
        enforce(
            f"phone-lookup:user:{current_user.username}",
            settings.PHONE_LOOKUPS_PER_USER_PER_HOUR,
            HOUR,
            message="You have looked up a lot of phone numbers. Please try again later.",
        )
    return user_service.search_users(db, current_user.username, q)
