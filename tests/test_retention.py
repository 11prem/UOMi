"""The clean-up job (task 1.7.4): expired rows go, live ones stay, and nothing the limits still count is dropped early."""

import logging
from datetime import timedelta

import pytest
from sqlalchemy import select

from app import database
from app.config import settings
from app.database import SessionLocal, utcnow
from app.models.login_attempt import LoginAttempt
from app.models.notification import Notification, NotificationType
from app.models.password_reset import PasswordReset
from app.models.pending_signup import PendingSignup
from app.models.refresh_token import RefreshToken
from app.services import reminder_scheduler
from app.services.retention_service import purge_expired, run_retention_job
from tests.helpers import db_all, register


@pytest.fixture
def alice(client):
    return register(client, "alice")


def ago(**span):
    return utcnow() - timedelta(**span)


def token(name: str, expires_at) -> RefreshToken:
    return RefreshToken(username="alice", token_hash=name * 64, expires_at=expires_at)


def reset(public_id: str, created_at) -> PasswordReset:
    return PasswordReset(public_id=public_id, requested_username="alice", phone="+919876543210", code_hash="0" * 64,
                         created_at=created_at, expires_at=created_at + timedelta(minutes=5))


def signup(public_id: str, valid_until) -> PendingSignup:
    return PendingSignup(public_id=public_id, username="x" + public_id[-5:], name="X", phone="+919000000000", password_hash="h",
                         code_hash="0" * 64, expires_at=valid_until, valid_until=valid_until)


def card(created_at, needs_answer=False, text="old") -> Notification:
    return Notification(username="alice", type=NotificationType.REMINDER, message=text, created_at=created_at, needs_answer=needs_answer)


def purge() -> dict[str, int]:
    with SessionLocal() as db:
        return purge_expired(db)


def keys(model, column) -> set[str]:
    return set(db_all(select(column)))


def test_each_table_loses_only_its_expired_rows(alice):
    with SessionLocal() as db:
        db.add_all([
            token("a", ago(days=2)), token("b", ago(hours=12)), token("c", utcnow() + timedelta(days=1)),  # gone, kept (grace), kept
            LoginAttempt(username="alice", attempted_at=ago(minutes=settings.LOGIN_LOCKOUT_MINUTES + 5)),
            LoginAttempt(username="alice", attempted_at=ago(minutes=5)),
            reset("pw_old", ago(hours=25)), reset("pw_new", ago(hours=23)),
            signup("su_old", ago(hours=25)), signup("su_new", ago(hours=23)), signup("su_open", utcnow() + timedelta(minutes=20)),
            card(ago(days=settings.NOTIFICATION_RETENTION_DAYS + 1), text="expired"),
            card(ago(days=settings.NOTIFICATION_RETENTION_DAYS + 1), needs_answer=True, text="still asking"),
            card(ago(days=settings.NOTIFICATION_RETENTION_DAYS - 1), text="recent"),
        ])
        db.commit()

    removed = purge()

    assert removed == {"refresh_tokens": 1, "login_attempts": 1, "password_resets": 1, "pending_signups": 1, "notifications": 1}
    assert {"b" * 64, "c" * 64} <= keys(RefreshToken, RefreshToken.token_hash)  # the one in its grace day and the live one stay
    assert "a" * 64 not in keys(RefreshToken, RefreshToken.token_hash)
    assert len(db_all(select(LoginAttempt))) == 1
    assert keys(PasswordReset, PasswordReset.public_id) == {"pw_new"}
    assert {"su_new", "su_open"} <= keys(PendingSignup, PendingSignup.public_id) and "su_old" not in keys(PendingSignup, PendingSignup.public_id)
    assert keys(Notification, Notification.message) >= {"still asking", "recent"} and "expired" not in keys(Notification, Notification.message)


def test_the_live_session_of_a_signed_in_person_is_never_touched(client, alice):
    purge()

    assert client.get("/users/me", headers={"Authorization": f"Bearer {alice['access_token']}"}).status_code == 200


def test_a_second_run_finds_nothing_more(alice):
    with SessionLocal() as db:
        db.add_all([token("a", ago(days=3)), reset("pw_old", ago(days=3)), card(ago(days=400))])
        db.commit()

    assert sum(purge().values()) == 3
    assert purge() == {"refresh_tokens": 0, "login_attempts": 0, "password_resets": 0, "pending_signups": 0, "notifications": 0}


def test_a_request_is_kept_for_a_whole_day_because_the_daily_cap_counts_it(alice):
    """Forgetting it sooner would let the cap on texts per day be dodged. 23 hours old is still counted."""
    with SessionLocal() as db:
        db.add_all([reset("pw_a", ago(hours=23, minutes=50)), signup("su_a", ago(hours=23, minutes=50))])
        db.commit()

    removed = purge()

    assert removed["password_resets"] == 0 and removed["pending_signups"] == 0


def test_the_card_age_limit_is_the_setting(alice, monkeypatch):
    monkeypatch.setattr(settings, "NOTIFICATION_RETENTION_DAYS", 10)
    with SessionLocal() as db:
        db.add_all([card(ago(days=11), text="eleven"), card(ago(days=9), text="nine")])
        db.commit()

    purge()

    assert {"nine"} <= keys(Notification, Notification.message) and "eleven" not in keys(Notification, Notification.message)


def test_a_card_that_still_asks_a_question_is_never_deleted_however_old(alice):
    with SessionLocal() as db:
        db.add(card(ago(days=2000), needs_answer=True, text="waiting"))
        db.commit()

    purge()

    assert "waiting" in keys(Notification, Notification.message)


# --- The scheduled run ------------------------------------------------------------------------------


def test_the_scheduled_job_cleans_with_its_own_session_and_says_so(alice, caplog):
    with SessionLocal() as db:
        db.add_all([token("a", ago(days=3)), card(ago(days=400))])
        db.commit()

    with caplog.at_level(logging.INFO, logger="app.services.retention_service"):
        run_retention_job()

    assert "Clean-up removed" in caplog.text and "1 refresh_tokens" in caplog.text and "1 notifications" in caplog.text
    assert "a" * 64 not in keys(RefreshToken, RefreshToken.token_hash)


def test_the_scheduled_job_is_silent_when_there_is_nothing_to_remove(alice, caplog):
    with caplog.at_level(logging.INFO, logger="app.services.retention_service"):
        run_retention_job()

    assert "Clean-up" not in caplog.text


@pytest.mark.parametrize("retention, reminders, expected", [(True, False, {"retention"}), (False, True, {"payment_reminders"}), (True, True, {"payment_reminders", "retention"}), (False, False, set())])
def test_the_scheduler_runs_the_jobs_that_are_switched_on(monkeypatch, retention, reminders, expected):
    added = []
    monkeypatch.setattr(settings, "RETENTION_ENABLED", retention)
    monkeypatch.setattr(settings, "REMINDERS_ENABLED", reminders)
    monkeypatch.setattr(reminder_scheduler.scheduler, "add_job", lambda func, **options: added.append(options["id"]))
    monkeypatch.setattr(reminder_scheduler.scheduler, "start", lambda: None)

    reminder_scheduler.start_scheduler()

    assert set(added) == expected and len(added) == len(expected)
