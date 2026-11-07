"""Background scheduler for payment reminders."""

from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler

from app.database import SessionLocal
from app.services.reminder_service import process_due_reminders

scheduler = BackgroundScheduler(timezone="UTC")


def run_reminder_job() -> None:
    """Run the payment reminder check using a fresh database session."""
    with SessionLocal() as db:
        process_due_reminders(db)


def start_scheduler() -> None:
    if scheduler.running:
        return

    scheduler.add_job(
        run_reminder_job,
        trigger="interval",
        hours=24,
        id="payment_reminders",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        next_run_time=datetime.now(timezone.utc),
    )
    scheduler.start()


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
