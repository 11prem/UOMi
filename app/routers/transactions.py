"""The Transactions page (task 1.5): the viewer's expenses and payments across all their spaces, page by page."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.transaction import TransactionListOut
from app.services import transaction_service
from app.utils.validators import MAX_ID

router = APIRouter(tags=["transactions"])


@router.get("/transactions", response_model=TransactionListOut)
def list_transactions(
    kind: Literal["all", "expenses", "payments"] = "all",
    space_id: Annotated[int | None, Query(ge=1, le=MAX_ID)] = None,
    before: Annotated[str | None, Query(max_length=60)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TransactionListOut:
    """Every expense in the viewer's spaces and every payment they are part of, newest first.

    `kind` filters, `space_id` narrows to one space (404 if the viewer is not in it). Pass the previous page's
    `next_before` as `before` to get the next page.
    """
    return transaction_service.list_transactions(db, current_user, kind, space_id, before, limit)
