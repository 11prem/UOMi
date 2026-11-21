"""User endpoints: the signed-in person's own profile, and people search for the Add People page."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.export import AccountExport
from app.schemas.user import ExportRequest, UserMe, UserSearchResult, UserUpdate
from app.services import auth_service, export_service, user_service
from app.utils.rate_limit import HOUR, MINUTE, enforce, search_ip_limit

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserMe)
def read_me(current_user: User = Depends(get_current_user)) -> User:
    """Who am I: the username, name, email and phone of the signed-in user."""
    return current_user


@router.post("/me/export", response_model=AccountExport)
def export_me(
    data: ExportRequest, response: Response, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> AccountExport:
    """Export my data: a JSON file of the profile, the spaces with their members, every expense with its shares, every payment, and the notifications.
    Asks for the password again (403 `wrong_password`, counted like a failed sign-in), so a stolen sign-in cannot download it."""
    enforce(
        f"export:user:{current_user.username}",
        settings.EXPORT_MAX_PER_USER_PER_HOUR,
        HOUR,
        message="You have exported your data a lot. Please try again later.",
    )
    auth_service.confirm_password(db, current_user, data.password)
    db.commit()  # the wrong-password count (or its reset) is kept
    response.headers["Content-Disposition"] = f'attachment; filename="uomi-export-{current_user.username}.json"'
    return export_service.build_export(db, current_user)


@router.patch("/me", response_model=UserMe)
def update_me(data: UserUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> User:
    """Profile, Edit: the name."""
    return user_service.update_me(db, current_user, data)


@router.get("/search", response_model=list[UserSearchResult], dependencies=[Depends(search_ip_limit)])
def search_users(
    q: Annotated[str, Query(min_length=1, max_length=50, description="Username")],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[UserSearchResult]:
    """Add People page, live search: the app sends one request per pause in typing (300 ms).

    Searching is by username only, and is limited per address and per user.
    """
    enforce(f"search:user:{current_user.username}", settings.SEARCH_MAX_PER_USER_PER_MINUTE, MINUTE)
    return user_service.search_users(db, current_user.id, q)
