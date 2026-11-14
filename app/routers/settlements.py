"""Settle-up endpoints (task 1.4): who can be paid, record a payment, and the answers to it."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.payment import SettlementStatus
from app.models.user import User
from app.schemas.settlement import PayeeOut, SettlementCreate, SettlementDetailOut
from app.services import settlement_service
from app.utils.validators import MAX_ID

router = APIRouter(tags=["settlements"])

SpaceId = Annotated[int, Path(ge=1, le=MAX_ID)]
SettlementId = Annotated[int, Path(ge=1, le=MAX_ID)]


@router.get("/spaces/{space_id}/payees", response_model=list[PayeeOut])
def list_payees(
    space_id: SpaceId, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> list[PayeeOut]:
    """The people the viewer owes in this space, with what is owed and the most that can be recorded now."""
    return settlement_service.list_payees(db, current_user, space_id)


@router.post(
    "/spaces/{space_id}/settlements", response_model=SettlementDetailOut, status_code=status.HTTP_201_CREATED
)
def create_settlement(
    space_id: SpaceId,
    data: SettlementCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SettlementDetailOut:
    """Record a payment made outside the app. It is pending until the receiver answers."""
    return settlement_service.create_settlement(db, current_user, space_id, data)


@router.get("/settlements/{settlement_id}", response_model=SettlementDetailOut)
def get_settlement(
    settlement_id: SettlementId, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> SettlementDetailOut:
    """The payment screen: status and when it was answered."""
    return settlement_service.get_settlement(db, current_user, settlement_id)


@router.post("/settlements/{settlement_id}/confirm", response_model=SettlementDetailOut)
def confirm_settlement(
    settlement_id: SettlementId, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> SettlementDetailOut:
    """The receiver says the money arrived. Only a confirmed payment changes a balance."""
    return settlement_service.answer_settlement(db, current_user, settlement_id, SettlementStatus.CONFIRMED)


@router.post("/settlements/{settlement_id}/reject", response_model=SettlementDetailOut)
def reject_settlement(
    settlement_id: SettlementId, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> SettlementDetailOut:
    """The receiver says it did not happen."""
    return settlement_service.answer_settlement(db, current_user, settlement_id, SettlementStatus.REJECTED)


@router.post("/settlements/{settlement_id}/cancel", response_model=SettlementDetailOut)
def cancel_settlement(
    settlement_id: SettlementId, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> SettlementDetailOut:
    """The payer takes back a payment nobody has answered yet."""
    return settlement_service.cancel_settlement(db, current_user, settlement_id)
