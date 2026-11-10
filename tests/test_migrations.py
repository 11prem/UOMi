"""Migration 0002 on a real SQLite file: it matches the models, converts money and keeps the data.

Alembic runs in a child process because `migrations/env.py` reads the settings once, on import,
and the test session has already imported them for the in-memory database.
"""

import os
import shutil
import sqlite3
import subprocess
import sys
from contextlib import closing
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

# What the app held at revision 0001: money as decimals, enum NAMES in the type columns.
SEED_0001 = """
INSERT INTO users (username, name, phone, password_hash, currency, created_at) VALUES
    ('alice', 'Alice', '+919876543210', 'x', 'INR', '2026-01-01 00:00:00.000000'),
    ('bob', 'Bob', '+919876543211', 'x', 'INR', '2026-01-01 00:00:00.000000');
INSERT INTO spaces (id, name, icon, created_by, created_at)
    VALUES (1, 'Goa Trip', 'trip', 'alice', '2026-01-02 00:00:00.000000');
INSERT INTO expenses (id, space_id, paid_by, title, amount, split_type, created_at) VALUES
    (1, 1, 'alice', 'Dinner', 123.45, 'EQUAL', '2026-01-15 10:30:00.000000'),
    (2, 1, 'bob', '{long_title}', 19.99, 'ITEM', '2026-01-16 23:59:59.000000');
INSERT INTO expense_shares (id, expense_id, username, amount, status) VALUES
    (1, 1, 'alice', 61.72, 'ACCEPTED'),
    (2, 1, 'bob', 61.73, 'PENDING');
INSERT INTO settlements (id, space_id, payer, payee, amount, status, created_at, confirmed_at)
    VALUES (1, 1, 'bob', 'alice', 50.50, 'CONFIRMED', '2026-01-17 08:00:00.000000', '2026-01-17 09:00:00.000000');
INSERT INTO notifications (id, username, type, title, body, space_id, ref_id, is_read, created_at) VALUES
    (1, 'bob', 'SPACE_ADDED', 'Added to Goa Trip', 'Alice added you to Goa Trip.', 1, NULL, 1, '2026-01-02 00:00:01.000000'),
    (2, 'bob', 'SHARE_REQUEST', 'Dinner', '', 1, 2, 0, '2026-01-15 10:30:01.000000'),
    (3, 'alice', 'SHARE_RESPONSE', 'Bob answered', 'Bob rejected a share.', 1, 2, 0, '2026-01-15 10:31:00.000000'),
    (4, 'alice', 'SETTLEMENT_REQUEST', 'Payment', 'Bob says he paid you.', 1, 1, 0, '2026-01-17 08:00:01.000000'),
    (5, 'bob', 'PAYMENT_REMINDER', 'Reminder', 'You owe Alice.', 1, NULL, 0, '2026-01-20 00:00:00.000000');
""".format(long_title="x" * 60)


def alembic(db: Path, *args: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{db.as_posix()}", "SECRET_KEY": "migration-test-secret-key-0123456789"}
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *args], cwd=ROOT, env=env, capture_output=True, text=True
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return result


def rows(db: Path, sql: str) -> list[tuple]:
    with closing(sqlite3.connect(db)) as con:
        return con.execute(sql).fetchall()


def run_script(db: Path, sql: str, foreign_keys: bool = False) -> None:
    with closing(sqlite3.connect(db)) as con:
        con.execute(f"PRAGMA foreign_keys={'ON' if foreign_keys else 'OFF'}")
        con.executescript(sql)
        con.commit()


def schema(db: Path) -> dict[str, set[tuple]]:
    """Every table's columns as (name, type, not null, primary key)."""
    tables = [name for (name,) in rows(db, "SELECT name FROM sqlite_master WHERE type = 'table'")]
    return {
        table: {(name, kind, notnull, pk) for _, name, kind, notnull, _, pk in rows(db, f"PRAGMA table_info({table})")}
        for table in tables
    }


@pytest.fixture(scope="module")
def db_0001(tmp_path_factory) -> Path:
    db = tmp_path_factory.mktemp("migrations") / "at_0001.db"
    alembic(db, "upgrade", "0001")
    run_script(db, SEED_0001)
    return db


@pytest.fixture(scope="module")
def db_head(tmp_path_factory, db_0001) -> Path:
    db = tmp_path_factory.mktemp("migrations") / "at_head.db"
    shutil.copy(db_0001, db)
    alembic(db, "upgrade", "head")
    return db


def test_upgrade_head_matches_models(tmp_path):
    db = tmp_path / "fresh.db"
    alembic(db, "upgrade", "head")
    result = alembic(db, "check")  # exits non-zero and lists the operations if the models drifted
    assert "No new upgrade operations detected" in result.stdout + result.stderr


def test_0002_converts_money_to_minor_units(db_head):
    assert rows(db_head, "SELECT id, amount_minor FROM expenses ORDER BY id") == [(1, 12345), (2, 1999)]
    assert rows(db_head, "SELECT id, amount_minor FROM expense_shares ORDER BY id") == [(1, 6172), (2, 6173)]
    assert rows(db_head, "SELECT id, amount_minor FROM settlements") == [(1, 5050)]
    # stored as integers, not as floats that happen to look whole
    assert rows(db_head, "SELECT DISTINCT typeof(amount_minor) FROM expenses") == [("integer",)]


def test_0002_keeps_and_backfills_the_other_fields(db_head):
    assert rows(
        db_head,
        "SELECT id, description, created_by, date, updated_at = created_at, split_type FROM expenses ORDER BY id",
    ) == [
        (1, "Dinner", "alice", "2026-01-15", 1, "EQUAL"),
        (2, "x" * 50, "bob", "2026-01-16", 1, "EXACT"),  # description holds 50 characters, ITEM became EXACT
    ]
    assert rows(db_head, "SELECT answered_at FROM settlements") == [("2026-01-17 09:00:00.000000",)]
    assert rows(
        db_head, "SELECT id, type, message, read, needs_answer, space_name FROM notifications ORDER BY id"
    ) == [
        (1, "SPACE_ADDED", "Alice added you to Goa Trip.", 1, 0, "Goa Trip"),
        (2, "EXPENSE_SHARE", "Dinner", 0, 0, "Goa Trip"),  # an empty body falls back to the title
        (3, "SHARE_REJECTED", "Bob rejected a share.", 0, 0, "Goa Trip"),
        (4, "PAYMENT_TO_CONFIRM", "Bob says he paid you.", 0, 0, "Goa Trip"),
        (5, "REMINDER", "You owe Alice.", 0, 0, "Goa Trip"),
    ]
    assert rows(db_head, "SELECT currency FROM spaces") == [("INR",)]


def test_a_notification_outlives_its_space(db_head, tmp_path):
    db = tmp_path / "copy.db"
    shutil.copy(db_head, db)
    run_script(db, "DELETE FROM spaces WHERE id = 1", foreign_keys=True)
    assert rows(db, "SELECT COUNT(*) FROM expenses") == [(0,)]  # the rest of the space is gone
    assert rows(db, "SELECT COUNT(*), MIN(space_id), MIN(space_name) FROM notifications") == [(5, None, "Goa Trip")]


def test_0003_adds_the_previous_token_column_and_its_downgrade_removes_it(db_head, tmp_path):
    def columns(db: Path) -> list[str]:
        return [row[1] for row in rows(db, "PRAGMA table_info(refresh_tokens)")]

    assert "previous_token_hash" in columns(db_head)
    db = tmp_path / "copy.db"
    shutil.copy(db_head, db)
    alembic(db, "downgrade", "bdc30b15495a")
    assert "previous_token_hash" not in columns(db)
    assert rows(db, "SELECT name FROM sqlite_master WHERE name = 'ix_refresh_tokens_previous_token_hash'") == []


def test_downgrade_returns_to_0001_and_keeps_what_it_can(db_0001, db_head, tmp_path):
    db = tmp_path / "copy.db"
    shutil.copy(db_head, db)
    run_script(
        db,
        """
        INSERT INTO expenses (id, space_id, paid_by, description, amount_minor, split_type, created_by, date, created_at, updated_at)
            VALUES (3, 1, 'alice', 'Rent', 1000000, 'PERCENT', 'alice', '2026-01-18', '2026-01-18 00:00:00.000000', '2026-01-18 00:00:00.000000');
        INSERT INTO settlements (id, space_id, payer, payee, amount_minor, status, created_at, answered_at)
            VALUES (2, 1, 'alice', 'bob', 100, 'REJECTED', '2026-01-19 00:00:00.000000', '2026-01-19 01:00:00.000000');
        INSERT INTO notifications (id, username, type, message, space_id, space_name, needs_answer, read, created_at)
            VALUES (6, 'bob', 'SPACE_DELETED', 'Goa Trip was deleted.', NULL, 'Goa Trip', 0, 0, '2026-01-21 00:00:00.000000');
        """,
    )

    alembic(db, "downgrade", "0001")

    assert schema(db) == schema(db_0001)
    assert rows(db, "SELECT id, title, amount, split_type FROM expenses ORDER BY id") == [
        (1, "Dinner", 123.45, "EQUAL"),
        (2, "x" * 50, 19.99, "EXACT"),
        (3, "Rent", 10000.0, "EXACT"),  # PERCENT and SHARES had no meaning before, the amounts still do
    ]
    assert rows(db, "SELECT id, amount FROM expense_shares ORDER BY id") == [(1, 61.72), (2, 61.73)]
    # a rejected payment has no old status, and the old code could not read it
    assert rows(db, "SELECT id, amount, confirmed_at FROM settlements") == [(1, 50.5, "2026-01-17 09:00:00.000000")]
    assert rows(db, "SELECT id, type, title, body, is_read FROM notifications ORDER BY id") == [
        (1, "SPACE_ADDED", "Alice added you to Goa Trip.", "Alice added you to Goa Trip.", 1),
        (2, "SHARE_REQUEST", "Dinner", "Dinner", 0),
        (3, "SHARE_RESPONSE", "Bob rejected a share.", "Bob rejected a share.", 0),
        (4, "SETTLEMENT_REQUEST", "Bob says he paid you.", "Bob says he paid you.", 0),
        (5, "PAYMENT_REMINDER", "You owe Alice.", "You owe Alice.", 0),
    ]  # the SPACE_DELETED card (no old type) is gone
