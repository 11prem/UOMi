"""Balance maths for the Home page (overall) and the Group page ("You owe ₹100", who owes whom).

Sign convention: positive = you are owed money, negative = you owe money.

For one person in one space:
    balance =   shares others owe you on bills you paid
              - your shares on bills others paid
              + settlements you paid
              - settlements you received

Only ACCEPTED shares and CONFIRMED settlements count. A share still waiting for its tick or cross
does not count yet, and a rejected one never does.

Every amount here is an integer in minor units (paise, cents).
"""

from collections import defaultdict
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.expense import Expense
from app.models.expense_split import ExpenseShare, ShareStatus
from app.models.payment import Settlement, SettlementStatus

ZERO = 0


@dataclass(frozen=True)
class Debt:
    debtor: str
    creditor: str
    amount: int


def get_balances(db: Session, username: str, space_ids: list[int]) -> dict[int, int]:
    """The user's balance in each of the given spaces, using four grouped queries in total."""
    if not space_ids:
        return {}
    balances = {space_id: ZERO for space_id in space_ids}
    accepted = ExpenseShare.status == ShareStatus.ACCEPTED
    confirmed = Settlement.status == SettlementStatus.CONFIRMED

    def shares(*conditions):
        return (
            select(Expense.space_id, func.sum(ExpenseShare.amount_minor))
            .select_from(ExpenseShare)
            .join(Expense, Expense.id == ExpenseShare.expense_id)
            .where(Expense.space_id.in_(space_ids), accepted, *conditions)
            .group_by(Expense.space_id)
        )

    def settlements(*conditions):
        return (
            select(Settlement.space_id, func.sum(Settlement.amount_minor))
            .where(Settlement.space_id.in_(space_ids), confirmed, *conditions)
            .group_by(Settlement.space_id)
        )

    queries = (
        (shares(Expense.paid_by == username, ExpenseShare.username != username), 1),  # others owe you
        (shares(Expense.paid_by != username, ExpenseShare.username == username), -1),  # you owe others
        (settlements(Settlement.payer == username), 1),  # you paid someone back
        (settlements(Settlement.payee == username), -1),  # someone paid you back
    )
    for stmt, sign in queries:
        for space_id, total in db.execute(stmt):
            balances[space_id] += sign * (total or ZERO)
    return balances


def get_space_balance(db: Session, username: str, space_id: int) -> int:
    return get_balances(db, username, [space_id])[space_id]


def get_debts(db: Session, space_id: int) -> list[Debt]:
    """Who owes whom in a space: one line per pair of people, netted against each other."""
    net: dict[tuple[str, str], int] = defaultdict(lambda: ZERO)  # (debtor, creditor) -> amount

    share_rows = db.execute(
        select(ExpenseShare.username, Expense.paid_by, func.sum(ExpenseShare.amount_minor))
        .select_from(ExpenseShare)
        .join(Expense, Expense.id == ExpenseShare.expense_id)
        .where(
            Expense.space_id == space_id,
            ExpenseShare.username != Expense.paid_by,
            ExpenseShare.status == ShareStatus.ACCEPTED,
        )
        .group_by(ExpenseShare.username, Expense.paid_by)
    )
    for debtor, creditor, total in share_rows:
        net[(debtor, creditor)] += total

    settlement_rows = db.execute(
        select(Settlement.payer, Settlement.payee, func.sum(Settlement.amount_minor))
        .where(Settlement.space_id == space_id, Settlement.status == SettlementStatus.CONFIRMED)
        .group_by(Settlement.payer, Settlement.payee)
    )
    for payer, payee, total in settlement_rows:
        net[(payer, payee)] -= total  # paying someone back cancels what you owed them

    debts: list[Debt] = []
    for a, b in sorted({tuple(sorted(pair)) for pair in net}):
        difference = net.get((a, b), ZERO) - net.get((b, a), ZERO)  # > 0 means a owes b
        if difference > 0:
            debts.append(Debt(debtor=a, creditor=b, amount=difference))
        elif difference < 0:
            debts.append(Debt(debtor=b, creditor=a, amount=-difference))
    return debts
