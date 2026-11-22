"""Migration 0002 finds notifications.space_id's foreign key by name on SQLite and by inspection on PostgreSQL.

The PostgreSQL branch cannot run in this suite (it uses SQLite), so the bind and the inspector are faked.
"""

import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest

import sqlalchemy as sa

MIGRATION = Path(__file__).resolve().parent.parent / "migrations" / "versions" / "0002_spec_alignment.py"


@pytest.fixture
def mig():
    spec = importlib.util.spec_from_file_location("migration_0002", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def use_dialect(monkeypatch, mig, name: str, foreign_keys: list[dict] | None = None):
    bind = SimpleNamespace(dialect=SimpleNamespace(name=name))
    monkeypatch.setattr(mig.op, "get_bind", lambda: bind)
    inspector = SimpleNamespace(get_foreign_keys=lambda table: foreign_keys or [])
    monkeypatch.setattr(sa, "inspect", lambda _bind: inspector)


def test_sqlite_uses_the_batch_name(monkeypatch, mig):
    use_dialect(monkeypatch, mig, "sqlite")
    assert mig._space_fk_name() == mig.SPACE_FK


def test_postgresql_uses_the_constraint_name_it_was_given(monkeypatch, mig):
    use_dialect(
        monkeypatch,
        mig,
        "postgresql",
        [
            {"name": "notifications_user_fkey", "referred_table": "users", "constrained_columns": ["username"]},
            {"name": "notifications_space_id_fkey", "referred_table": "spaces", "constrained_columns": ["space_id"]},
        ],
    )
    assert mig._space_fk_name() == "notifications_space_id_fkey"


def test_postgresql_without_a_space_foreign_key_fails_loudly(monkeypatch, mig):
    use_dialect(monkeypatch, mig, "postgresql", [])
    with pytest.raises(RuntimeError):
        mig._space_fk_name()
