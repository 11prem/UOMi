"""Expense endpoints (task 1.3): add, edit, delete, the tick and the cross, the detail screen and the paged list."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.expense_split import ShareStatus
from app.models.user import User
from app.schemas.expense import ExpenseDetailOut, ExpenseListOut, ExpenseWrite
from app.services import expense_service
from app.utils.validators import MAX_ID

router = APIRouter(tags=["expenses"])

SpaceId = Annotated[int, Path(ge=1, le=MAX_ID)]
ExpenseId = Annotated[int, Path(ge=1, le=MAX_ID)]


@router.get("/spaces/{space_id}/expenses", response_model=ExpenseListOut)
def list_expenses(
    space_id: SpaceId,
    before: Annotated[int | None, Query(ge=1, le=MAX_ID)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ExpenseListOut:
    """Every expense of a space, newest first. Pass the previous page's `next_before` as `before`."""
    return expense_service.list_expenses(db, current_user, space_id, before, limit)


@router.post("/spaces/{space_id}/expenses", response_model=ExpenseDetailOut, status_code=status.HTTP_201_CREATED)
def create_expense(
    space_id: SpaceId,
    data: ExpenseWrite,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ExpenseDetailOut:
    """Add expense. The server works out every share; everyone but the payer and the creator is asked."""
    return expense_service.create_expense(db, current_user, space_id, data)


@router.get("/expenses/{expense_id}", response_model=ExpenseDetailOut)
def get_expense(
    expense_id: ExpenseId, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> ExpenseDetailOut:
    """The expense screen: who paid, the split and each person's answer."""
    return expense_service.get_expense(db, current_user, expense_id)


@router.put("/expenses/{expense_id}", response_model=ExpenseDetailOut)
def update_expense(
    expense_id: ExpenseId,
    data: ExpenseWrite,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ExpenseDetailOut:
    """Edit (creator only). Every answer is reset and everyone in the split is asked again."""
    return expense_service.update_expense(db, current_user, expense_id, data)


@router.delete("/expenses/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expense(
    expense_id: ExpenseId, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> Response:
    """Delete (creator only). Balances recalculate and the cards about it go."""
    expense_service.delete_expense(db, current_user, expense_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/expenses/{expense_id}/accept", response_model=ExpenseDetailOut)
def accept_share(
    expense_id: ExpenseId, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> ExpenseDetailOut:
    """The tick on your own share."""
    return expense_service.answer_share(db, current_user, expense_id, ShareStatus.ACCEPTED)


@router.post("/expenses/{expense_id}/reject", response_model=ExpenseDetailOut)
def reject_share(
    expense_id: ExpenseId, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> ExpenseDetailOut:
    """The cross on your own share. The expense becomes disputed and its creator is told."""
    return expense_service.answer_share(db, current_user, expense_id, ShareStatus.REJECTED)
