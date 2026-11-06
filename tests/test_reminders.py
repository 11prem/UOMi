from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.database import SessionLocal
from app.models.notification import Notification, NotificationType
from app.models.reminder import Reminder
from app.models.expense_split import ShareStatus
from app.services.reminder_service import process_due_reminders
from tests.helpers import (
    register,
    create_space,
    add_expense,
    add_settlement,
)
from app.models.payment import SettlementStatus


def prepare_share(client, status=ShareStatus.ACCEPTED):
    alice = register(client, "alice")
    register(client, "bob")
    space = create_space(client, alice, usernames=["bob"])

    expense_id = add_expense(
        space["id"],
        "alice",
        "Dinner",
        {"bob": ("500", status)},
    )

    accepted_at = datetime(2026, 11, 1, 10, 0, tzinfo=timezone.utc)

    with SessionLocal() as db:
        from app.models.expense_split import ExpenseShare

        share = db.scalar(
            select(ExpenseShare).where(ExpenseShare.expense_id == expense_id)
        )
        if status == ShareStatus.ACCEPTED:
            share.responded_at = accepted_at
        db.commit()
        share_id = share.id

    return space["id"], share_id, accepted_at


def test_no_reminder_before_day_three(client):
    prepare_share(client)

    with SessionLocal() as db:
        count = process_due_reminders(
            db, datetime(2026, 11, 4, 9, 59, tzinfo=timezone.utc)
        )

    assert count == 0


def test_reminder_sent_on_day_three(client):
    prepare_share(client)

    with SessionLocal() as db:
        count = process_due_reminders(
            db, datetime(2026, 11, 4, 10, 0, tzinfo=timezone.utc)
        )

    assert count == 1

    with SessionLocal() as db:
        reminders = db.scalars(select(Reminder)).all()
        notifications = db.scalars(
            select(Notification).where(
                Notification.type == NotificationType.PAYMENT_REMINDER
            )
        ).all()

    assert len(reminders) == 1
    assert reminders[0].reminder_day == 3
    assert len(notifications) == 1
    assert notifications[0].username == "bob"


def test_duplicate_reminder_is_not_created(client):
    prepare_share(client)
    now = datetime(2026, 11, 4, 10, 0, tzinfo=timezone.utc)

    with SessionLocal() as db:
        assert process_due_reminders(db, now) == 1

    with SessionLocal() as db:
        assert process_due_reminders(db, now) == 0


def test_pending_share_gets_no_reminder(client):
    prepare_share(client, ShareStatus.PENDING)

    with SessionLocal() as db:
        count = process_due_reminders(
            db, datetime(2026, 11, 15, 10, 0, tzinfo=timezone.utc)
        )

    assert count == 0


def test_fully_settled_pair_gets_no_reminder(client):
    space_id, _, _ = prepare_share(client)

    add_settlement(
        space_id,
        "bob",
        "alice",
        "500",
        SettlementStatus.CONFIRMED,
    )

    with SessionLocal() as db:
        count = process_due_reminders(
            db, datetime(2026, 11, 15, 10, 0, tzinfo=timezone.utc)
        )

    assert count == 0
