"""Payment reminder scheduling and notification logic."""

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.currencies import format_money
from app.database import utcnow
from app.models.expense import Expense
from app.models.expense_split import ExpenseShare, ShareStatus
from app.models.group import Space
from app.models.notification import NotificationType
from app.models.reminder import Reminder
from app.models.user import User
from app.services.balance_service import viewer_pairs
from app.services.notification_service import create_notification

REMINDER_DAYS = (3, 5, 7, 10)


def process_due_reminders(db: Session, now: datetime | None = None) -> int:
    """Remind debtors of accepted shares whose pair still owes the payer, on days 3, 5, 7 and 10.

    Every due (share, day) gets a Reminder row so it never fires again, but each run sends at most
    one notification per (debtor, payer, space). Returns the number of notifications created.
    """
    current_time = now or utcnow()

    shares = db.execute(
        select(ExpenseShare, Expense)
        .join(Expense, Expense.id == ExpenseShare.expense_id)
        .where(
            ExpenseShare.status == ShareStatus.ACCEPTED,
            ExpenseShare.responded_at.is_not(None),
            ExpenseShare.user_id != Expense.paid_by,
        )
    ).all()

    sides: dict[tuple[int, int], dict[str, int]] = {}  # (space, debtor id) -> viewer_pairs, once per run
    notified: set[tuple[int, int, int]] = set()  # (debtor id, payer id, space) already sent this run
    users: dict[int, User] = {}  # people met this run
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

                for user_id in (share.user_id, expense.paid_by):
                    if user_id not in users:
                        users[user_id] = db.get(User, user_id)
                debtor, payer = users[share.user_id], users[expense.paid_by]

                side_key = (expense.space_id, debtor.id)
                if side_key not in sides:
                    sides[side_key] = viewer_pairs(db, expense.space_id, debtor.username)

                # Negative: the debtor owes the payer, under the Space page's balance rules.
                owed = -sides[side_key].get(payer.username, 0)

                if owed <= 0:
                    continue

                db.add(
                    Reminder(
                        expense_share_id=share.id,
                        reminder_day=reminder_day,
                    )
                )

                pair = (debtor.id, payer.id, expense.space_id)
                if pair in notified:
                    continue
                notified.add(pair)

                space = db.get(Space, expense.space_id)
                payer_first_name = payer.name.split()[0]
                create_notification(
                    db,
                    user_id=debtor.id,
                    type=NotificationType.REMINDER,
                    message=(
                        f"You owe {payer_first_name} {format_money(owed, space.currency)}. "
                        f"{space.name} · tap to settle up"
                    ),
                    space_id=space.id,
                    space_name=space.name,
                    ref_id=None,
                    needs_answer=False,
                )
                created_count += 1

        db.commit()
        return created_count

    except Exception:
        db.rollback()
        raise
