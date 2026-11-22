"""Request/response shapes for the Transactions page (task 1.5, specs § 12).

A row is an expense or a payment, with the space it belongs to. The expense row is the same card as on the Space page
(it carries the viewer's own share and whether it is disputed), the payment row is the same as on the Space page
(it carries its status), so the app can show "you owe", "you lent", "you paid" and "you received" and the Pending and
Disputed tags. There are no totals: the rows can be in different currencies.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.schemas.group import ExpenseRow, SettlementRow


class TransactionSpace(BaseModel):
    """The space a row belongs to: its name for the row, its currency for the amounts."""

    space_id: int
    space_name: str
    currency: str


class ExpenseTransaction(ExpenseRow, TransactionSpace):
    kind: Literal["expense"] = "expense"


class PaymentTransaction(SettlementRow, TransactionSpace):
    kind: Literal["payment"] = "payment"


Transaction = Annotated[ExpenseTransaction | PaymentTransaction, Field(discriminator="kind")]


class TransactionListOut(BaseModel):
    """One page, newest first. Pass `next_before` back as `before` for the next page. It is None on the last page.

    `next_before` is an opaque marker (do not build or read one): it says where this page ended.
    """

    items: list[Transaction]
    next_before: str | None
