"""Background scheduler: the daily payment reminders and the daily clean-up (each can be switched off)."""

from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler

from app.config import settings
from app.database import SessionLocal
from app.services.reminder_service import process_due_reminders
from app.services.retention_service import run_retention_job

scheduler = BackgroundScheduler(timezone="UTC")


def run_reminder_job() -> None:
    """Run the payment reminder check using a fresh database session."""
    with SessionLocal() as db:
        process_due_reminders(db)


def start_scheduler() -> None:
    if scheduler.running:
        return

    if settings.REMINDERS_ENABLED:
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
    if settings.RETENTION_ENABLED:
        scheduler.add_job(
            run_retention_job,
            trigger="interval",
            hours=24,
            id="retention",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
            next_run_time=datetime.now(timezone.utc),
        )
    scheduler.start()


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
