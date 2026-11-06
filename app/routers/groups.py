"""Space endpoints: Home page list, create-space flow (Group Name + Add People), Group page."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.group import SpaceCreate, SpaceDetailOut, SpaceListOut
from app.services import group_service
from app.utils.validators import MAX_ID

router = APIRouter(prefix="/spaces", tags=["spaces"])


@router.get("", response_model=SpaceListOut)
def list_spaces(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> SpaceListOut:
    """Home page: overall balance per currency and the spaces, latest activity first."""
    return group_service.list_spaces(db, current_user)


@router.post("", response_model=SpaceDetailOut, status_code=status.HTTP_201_CREATED)
def create_space(
    data: SpaceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SpaceDetailOut:
    """Add People page, tick to create -> 201 + the new space (Group page)."""
    space = group_service.create_space(db, current_user, data)
    return group_service.get_space_detail(db, current_user, space.id)


@router.get("/{space_id}", response_model=SpaceDetailOut)
def get_space(
    space_id: Annotated[int, Path(ge=1, le=MAX_ID)],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SpaceDetailOut:
    """Home page, tap a space card -> Group page: expenses, payments and who owes whom."""
    return group_service.get_space_detail(db, current_user, space_id)
