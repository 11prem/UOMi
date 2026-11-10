"""Space endpoints: Home page list, create-space flow (Group Name + Add People), Group page."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.group import AddMembersRequest, SpaceCreate, SpaceDetailOut, SpaceListOut, SpaceUpdate
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


@router.patch("/{space_id}", response_model=SpaceDetailOut)
def update_space(
    space_id: Annotated[int, Path(ge=1, le=MAX_ID)],
    data: SpaceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SpaceDetailOut:
    """Space settings, Edit: rename and icon (any member), currency (the owner, before the first expense)."""
    return group_service.update_space(db, current_user, space_id, data)


@router.delete("/{space_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_space(
    space_id: Annotated[int, Path(ge=1, le=MAX_ID)],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Delete space (the owner only, when everyone is settled up). The other members are told."""
    group_service.delete_space(db, current_user, space_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{space_id}/members", response_model=SpaceDetailOut)
def add_members(
    space_id: Annotated[int, Path(ge=1, le=MAX_ID)],
    data: AddMembersRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SpaceDetailOut:
    """Add people (any member). They are in at once and told, with no accept step. At most 50 people."""
    return group_service.add_members(db, current_user, space_id, data)


@router.delete("/{space_id}/members/{username}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    space_id: Annotated[int, Path(ge=1, le=MAX_ID)],
    username: Annotated[str, Path(min_length=1, max_length=50)],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Remove a member (the owner only, when that member is settled up in the space)."""
    group_service.remove_member(db, current_user, space_id, username)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{space_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
def leave_space(
    space_id: Annotated[int, Path(ge=1, le=MAX_ID)],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Leave the space (any member except the owner, when they are settled up)."""
    group_service.leave_space(db, current_user, space_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

