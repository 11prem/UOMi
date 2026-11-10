"""User endpoints: the signed-in person's own profile, and people search for the Add People page."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.export import DataExport
from app.schemas.user import DeleteAccountRequest, UserMe, UserSearchResult, UserUpdate
from app.services import account_service, export_service, user_service
from app.utils.rate_limit import HOUR, MINUTE, enforce, search_ip_limit
from app.utils.validators import parse_full_phone

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserMe)
def read_me(current_user: User = Depends(get_current_user)) -> User:
    """Who am I: the username, name, phone and default currency of the signed-in user."""
    return current_user


@router.get("/me/export", response_model=DataExport)
def export_me(response: Response, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> DataExport:
    """Export my data: a JSON file of the profile, the spaces (with expenses, shares and payments) and the notifications."""
    enforce(
        f"export:user:{current_user.username}",
        settings.EXPORT_MAX_PER_USER_PER_HOUR,
        HOUR,
        message="You have exported your data a lot. Please try again later.",
    )
    response.headers["Content-Disposition"] = f'attachment; filename="uomi-export-{current_user.username}.json"'
    return export_service.build_export(db, current_user)


@router.patch("/me", response_model=UserMe)
def update_me(data: UserUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> User:
    """Profile, Edit and the preferences: the name, the default currency and the notifications switch."""
    return user_service.update_me(db, current_user, data)


@router.post("/me/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(data: DeleteAccountRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Response:
    """Profile, Delete my account: asks for the password again. Refused (403) until the person is settled up in every
    space (`not_settled`) and while they own a space with other people in it (`owns_shared_space`); both name the spaces.
    The account is anonymised, not erased: see services/account_service.py."""
    account_service.delete_account(db, current_user, data.password)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
