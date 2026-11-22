"""Background scheduler: the daily payment reminders, the daily clean-up and the push worker (each can be switched off)."""

from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler

from app.config import settings
from app.database import SessionLocal
from app.services.push_service import run_push_job
from app.services.reminder_service import process_due_reminders
from app.services.retention_service import run_retention_job

scheduler = BackgroundScheduler(timezone="UTC")


def run_reminder_job() -> None:
    """Run the payment reminder check using a fresh database session."""
    with SessionLocal() as db:
        process_due_reminders(db)


def _add(func, job_id: str, **every) -> None:
    """Run `func` now and then on an interval (hours=..., seconds=...), one run at a time, missed runs folded into one."""
    scheduler.add_job(
        func,
        trigger="interval",
        id=job_id,
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        next_run_time=datetime.now(timezone.utc),
        **every,
    )


def _add_daily(func, job_id: str) -> None:
    _add(func, job_id, hours=24)


def start_scheduler() -> None:
    if scheduler.running:
        return

    if settings.REMINDERS_ENABLED:
        _add_daily(run_reminder_job, "payment_reminders")
    if settings.RETENTION_ENABLED:
        _add_daily(run_retention_job, "data_retention")
    if settings.PUSH_ENABLED:
        _add(run_push_job, "push_delivery", seconds=settings.PUSH_POLL_SECONDS)  # one run at a time
    scheduler.start()


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
