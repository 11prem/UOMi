"""Payment reminders: days 3, 5, 7 and 10 after a share is accepted, while the debtor still owes the payer."""

from datetime import datetime, timezone

from sqlalchemy import select, update

from app.currencies import format_money
from app.database import SessionLocal
from app.models.expense_split import ExpenseShare, ShareStatus
from app.models.notification import Notification, NotificationType
from app.models.payment import SettlementStatus
from app.models.reminder import Reminder
from app.services.reminder_service import process_due_reminders
from tests.helpers import add_expense, add_settlement, create_space, db_all, db_exec, register

ACCEPTED_AT = datetime(2026, 11, 1, 10, 0, tzinfo=timezone.utc)
DAY_THREE = datetime(2026, 11, 4, 10, 0, tzinfo=timezone.utc)
AFTER_DAY_TEN = datetime(2026, 11, 15, 10, 0, tzinfo=timezone.utc)


def accept(expense_id: int) -> None:
    """Stamp every accepted share of the expense as accepted at ACCEPTED_AT."""
    db_exec(
        update(ExpenseShare)
        .where(ExpenseShare.expense_id == expense_id, ExpenseShare.status == ShareStatus.ACCEPTED)
        .values(responded_at=ACCEPTED_AT)
    )


def prepare_share(client, status=ShareStatus.ACCEPTED) -> int:
    """Alice paid ₹500 for Bob in the space 'Trip'. Returns the space id."""
    alice = register(client, "alice")
    register(client, "bob")
    space = create_space(client, alice, usernames=["bob"])
    accept(add_expense(space["id"], "alice", "Dinner", {"bob": ("500", status)}))
    return space["id"]


def reminder_cards() -> list[Notification]:
    return db_all(select(Notification).where(Notification.type == NotificationType.REMINDER))


def run(now: datetime) -> int:
    with SessionLocal() as db:
        return process_due_reminders(db, now)


def test_no_reminder_before_day_three(client):
    prepare_share(client)

    assert run(datetime(2026, 11, 4, 9, 59, tzinfo=timezone.utc)) == 0


def test_reminder_sent_on_day_three(client):
    space_id = prepare_share(client)

    assert run(DAY_THREE) == 1

    reminders = db_all(select(Reminder))
    notifications = reminder_cards()
    assert len(reminders) == 1
    assert reminders[0].reminder_day == 3
    assert len(notifications) == 1
    card = notifications[0]
    assert card.username == "bob"
    assert card.type == NotificationType.REMINDER
    assert card.ref_id is None
    assert card.message == "You owe Alice ₹500. Trip · tap to settle up"
    assert (card.space_id, card.space_name, card.needs_answer) == (space_id, "Trip", False)


def test_duplicate_reminder_is_not_created(client):
    prepare_share(client)

    assert run(DAY_THREE) == 1
    assert run(DAY_THREE) == 0


def test_pending_share_gets_no_reminder(client):
    prepare_share(client, ShareStatus.PENDING)

    assert run(AFTER_DAY_TEN) == 0


def test_fully_settled_pair_gets_no_reminder(client):
    space_id = prepare_share(client)
    add_settlement(space_id, "bob", "alice", "500", SettlementStatus.CONFIRMED)

    assert run(AFTER_DAY_TEN) == 0


def test_reminders_sent_on_days_3_5_7_and_10(client):
    prepare_share(client)

    for day in (4, 6, 8, 11):  # accepted on 1 November
        assert run(datetime(2026, 11, day, 10, 0, tzinfo=timezone.utc)) == 1

    reminders = db_all(select(Reminder).order_by(Reminder.reminder_day))
    assert [reminder.reminder_day for reminder in reminders] == [3, 5, 7, 10]
    assert len(reminder_cards()) == 4


def test_two_shares_with_one_payer_send_one_reminder(client):
    space_id = prepare_share(client)
    accept(add_expense(space_id, "alice", "Taxi", {"bob": ("300", ShareStatus.ACCEPTED)}))

    assert run(DAY_THREE) == 1

    assert len(db_all(select(Reminder))) == 2
    notifications = reminder_cards()
    assert len(notifications) == 1
    assert notifications[0].message == "You owe Alice ₹800. Trip · tap to settle up"
    assert run(DAY_THREE) == 0  # both (share, day 3) rows are recorded


def test_disputed_expense_does_not_count_towards_the_debt(client):
    alice = register(client, "alice")
    register(client, "bob")
    register(client, "carol")
    space = create_space(client, alice, usernames=["bob", "carol"])
    accept(
        add_expense(
            space["id"],
            "alice",
            "Dinner",
            {"bob": ("500", ShareStatus.ACCEPTED), "carol": ("500", ShareStatus.REJECTED)},
        )
    )

    assert run(AFTER_DAY_TEN) == 0
    assert reminder_cards() == []


def test_format_money_matches_the_app():
    assert format_money(40000, "INR") == "₹400"
    assert format_money(12345650, "INR") == "₹1,23,456.50"
    assert format_money(123456789, "INR") == "₹12,34,567.89"
    assert format_money(12345650, "USD") == "$123,456.50"
    assert format_money(150000, "AED") == "AED 1,500"
    assert format_money(150050, "SGD") == "S$ 1,500.50"
    assert format_money(-2000, "EUR") == "€20"
    assert format_money(1234, "JPY") == "JPY 12.34"
