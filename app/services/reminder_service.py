"""Payment reminder scheduling and notification logic."""

from datetime import datetime, timedelta
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.expense import Expense
from app.models.expense_split import ExpenseShare, ShareStatus
from app.models.notification import NotificationType
from app.models.reminder import Reminder
from app.database import utcnow
from app.services.balance_service import get_debts
from app.services.notification_service import create_notification

REMINDER_DAYS = (3, 5, 7, 10)


def process_due_reminders(db: Session, now: datetime | None = None) -> int:
    """Create notifications for accepted shares with outstanding pair-level debt.

    Returns the number of reminders created.
    """
    current_time = now or utcnow()

    shares = db.execute(
        select(ExpenseShare, Expense)
        .join(Expense, Expense.id == ExpenseShare.expense_id)
        .where(
            ExpenseShare.status == ShareStatus.ACCEPTED,
            ExpenseShare.responded_at.is_not(None),
            ExpenseShare.username != Expense.paid_by,
        )
    ).all()

    debts_by_space = {}
    created_count = 0

    try:
        for share, expense in shares:
            accepted_at = share.responded_at

            for reminder_day in REMINDER_DAYS:
                due_at = accepted_at + timedelta(days=reminder_day)

                if current_time < due_at:
                    continue

                already_sent = db.scalar(
                    select(Reminder.id).where(
                        Reminder.expense_share_id == share.id,
                        Reminder.reminder_day == reminder_day,
                    )
                )

                if already_sent is not None:
                    continue

                if expense.space_id not in debts_by_space:
                    debts_by_space[expense.space_id] = get_debts(
                        db, expense.space_id
                    )

                outstanding = any(
                    debt.debtor == share.username
                    and debt.creditor == expense.paid_by
                    and debt.amount > 0
                    for debt in debts_by_space[expense.space_id]
                )

                if not outstanding:
                    continue

                create_notification(
                    db=db,
                    username=share.username,
                    notification_type=NotificationType.PAYMENT_REMINDER,
                    title="Payment reminder",
                    body=(
                        f"You have an outstanding balance with "
                        f"{expense.paid_by} in this group. "
                        f"Please review your balances."
                    ),
                    space_id=expense.space_id,
                    ref_id=share.id,
                )

                db.add(
                    Reminder(
                        expense_share_id=share.id,
                        reminder_day=reminder_day,
                    )
                )
                created_count += 1

        db.commit()
        return created_count

    except Exception:
        db.rollback()
        raise
