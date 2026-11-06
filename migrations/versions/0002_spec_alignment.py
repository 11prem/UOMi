"""spec alignment: integer money, space currency, expense and notification fields

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-06 18:00:00.000000

Every table changes in two steps so no row is lost: add the new columns empty, fill them from the
old ones, then make them required and drop the old ones. SQLite rebuilds the table for the second
step (`batch_alter_table`). Foreign keys are off on the migration connection, so a rebuild does not
cascade into the child tables.

`downgrade()` cannot keep what the old schema has no place for: PERCENT and SHARES expenses become
EXACT (the amounts stay), and rejected or cancelled settlements and PAYMENT_ANSWERED or
SPACE_DELETED notifications are deleted, because the old code fails on a status or type it does not know.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0002'
down_revision: Union[str, None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# What UTCDateTime stores. app.database is not imported here, so the migration never changes with the app.
DATETIME = sa.DateTime(timezone=True)

# The 0001 foreign key on notifications.space_id has no name; the batch names it so it can be replaced.
# shortcut: that name is SQLite's only, PostgreSQL named the constraint itself. Look it up with the inspector when PostgreSQL is used.
FK_NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"}
SPACE_FK = "fk_notifications_space_id_spaces"

# Stored enum NAMES, old -> new. The other names did not change.
NOTIFICATION_TYPES = {
    "SHARE_REQUEST": "EXPENSE_SHARE",
    "SHARE_RESPONSE": "SHARE_REJECTED",
    "SETTLEMENT_REQUEST": "PAYMENT_TO_CONFIRM",
    "PAYMENT_REMINDER": "REMINDER",
}


def _rename_types(mapping: dict[str, str]) -> None:
    cases = " ".join(f"WHEN '{old}' THEN '{new}'" for old, new in mapping.items())
    op.execute(f"UPDATE notifications SET type = CASE type {cases} ELSE type END")


def upgrade() -> None:
    # --- spaces: every existing space is in the default currency
    with op.batch_alter_table("spaces") as batch_op:
        batch_op.add_column(sa.Column("currency", sa.String(3), nullable=False, server_default="INR"))

    # --- expenses
    op.execute("UPDATE expenses SET title = SUBSTR(title, 1, 50)")  # description holds 50 characters
    op.execute("UPDATE expenses SET split_type = 'EXACT' WHERE split_type = 'ITEM'")
    with op.batch_alter_table("expenses") as batch_op:
        batch_op.add_column(sa.Column("amount_minor", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("created_by", sa.String(30), nullable=True))
        batch_op.add_column(sa.Column("date", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("updated_at", DATETIME, nullable=True))
    op.execute(
        "UPDATE expenses SET amount_minor = CAST(ROUND(amount * 100) AS INTEGER), "
        "created_by = paid_by, date = DATE(created_at), updated_at = created_at"
    )
    with op.batch_alter_table("expenses") as batch_op:
        batch_op.alter_column("amount_minor", existing_type=sa.Integer(), nullable=False)
        batch_op.alter_column("created_by", existing_type=sa.String(30), nullable=False)
        batch_op.alter_column("date", existing_type=sa.Date(), nullable=False)
        batch_op.alter_column("updated_at", existing_type=DATETIME, nullable=False)
        batch_op.alter_column(
            "title",
            new_column_name="description",
            existing_type=sa.String(200),
            type_=sa.String(50),
            existing_nullable=False,
        )
        batch_op.create_foreign_key("fk_expenses_created_by_users", "users", ["created_by"], ["username"])
        batch_op.drop_column("amount")

    # --- expense_shares
    with op.batch_alter_table("expense_shares") as batch_op:
        batch_op.add_column(sa.Column("amount_minor", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("input", sa.String(20), nullable=True))
    op.execute("UPDATE expense_shares SET amount_minor = CAST(ROUND(amount * 100) AS INTEGER)")
    with op.batch_alter_table("expense_shares") as batch_op:
        batch_op.alter_column("amount_minor", existing_type=sa.Integer(), nullable=False)
        batch_op.drop_column("amount")

    # --- settlements
    with op.batch_alter_table("settlements") as batch_op:
        batch_op.add_column(sa.Column("amount_minor", sa.Integer(), nullable=True))
    op.execute("UPDATE settlements SET amount_minor = CAST(ROUND(amount * 100) AS INTEGER)")
    with op.batch_alter_table("settlements") as batch_op:
        batch_op.alter_column("amount_minor", existing_type=sa.Integer(), nullable=False)
        batch_op.alter_column("confirmed_at", new_column_name="answered_at", existing_type=DATETIME, existing_nullable=True)
        batch_op.drop_column("amount")

    # --- notifications
    _rename_types(NOTIFICATION_TYPES)
    with op.batch_alter_table("notifications") as batch_op:
        batch_op.add_column(sa.Column("message", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("space_name", sa.String(100), nullable=True))
        batch_op.add_column(sa.Column("needs_answer", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.execute(
        "UPDATE notifications SET message = COALESCE(NULLIF(body, ''), title), "
        "space_name = (SELECT name FROM spaces WHERE spaces.id = notifications.space_id)"
    )
    with op.batch_alter_table("notifications", naming_convention=FK_NAMING) as batch_op:
        batch_op.alter_column("message", existing_type=sa.Text(), nullable=False)
        batch_op.alter_column("is_read", new_column_name="read", existing_type=sa.Boolean(), existing_nullable=False)
        batch_op.drop_column("title")
        batch_op.drop_column("body")
        batch_op.drop_constraint(SPACE_FK, type_="foreignkey")
        batch_op.create_foreign_key(SPACE_FK, "spaces", ["space_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    # --- notifications
    op.execute("DELETE FROM notifications WHERE type IN ('PAYMENT_ANSWERED', 'SPACE_DELETED')")
    _rename_types({new: old for old, new in NOTIFICATION_TYPES.items()})
    with op.batch_alter_table("notifications") as batch_op:
        batch_op.add_column(sa.Column("title", sa.String(200), nullable=True))
        batch_op.add_column(sa.Column("body", sa.Text(), nullable=True))
    op.execute("UPDATE notifications SET title = SUBSTR(message, 1, 200), body = message")
    with op.batch_alter_table("notifications", naming_convention=FK_NAMING) as batch_op:
        batch_op.alter_column("title", existing_type=sa.String(200), nullable=False)
        batch_op.alter_column("body", existing_type=sa.Text(), nullable=False)
        batch_op.alter_column("read", new_column_name="is_read", existing_type=sa.Boolean(), existing_nullable=False)
        batch_op.drop_column("message")
        batch_op.drop_column("space_name")
        batch_op.drop_column("needs_answer")
        batch_op.drop_constraint(SPACE_FK, type_="foreignkey")
        batch_op.create_foreign_key(SPACE_FK, "spaces", ["space_id"], ["id"], ondelete="CASCADE")

    # --- settlements
    op.execute("DELETE FROM settlements WHERE status IN ('REJECTED', 'CANCELLED')")
    with op.batch_alter_table("settlements") as batch_op:
        batch_op.add_column(sa.Column("amount", sa.Numeric(12, 2), nullable=True))
    op.execute("UPDATE settlements SET amount = amount_minor / 100.0")
    with op.batch_alter_table("settlements") as batch_op:
        batch_op.alter_column("amount", existing_type=sa.Numeric(12, 2), nullable=False)
        batch_op.alter_column("answered_at", new_column_name="confirmed_at", existing_type=DATETIME, existing_nullable=True)
        batch_op.drop_column("amount_minor")

    # --- expense_shares
    with op.batch_alter_table("expense_shares") as batch_op:
        batch_op.add_column(sa.Column("amount", sa.Numeric(12, 2), nullable=True))
    op.execute("UPDATE expense_shares SET amount = amount_minor / 100.0")
    with op.batch_alter_table("expense_shares") as batch_op:
        batch_op.alter_column("amount", existing_type=sa.Numeric(12, 2), nullable=False)
        batch_op.drop_column("amount_minor")
        batch_op.drop_column("input")

    # --- expenses
    op.execute("UPDATE expenses SET split_type = 'EXACT' WHERE split_type IN ('PERCENT', 'SHARES')")
    with op.batch_alter_table("expenses") as batch_op:
        batch_op.add_column(sa.Column("amount", sa.Numeric(12, 2), nullable=True))
    op.execute("UPDATE expenses SET amount = amount_minor / 100.0")
    with op.batch_alter_table("expenses") as batch_op:
        batch_op.alter_column("amount", existing_type=sa.Numeric(12, 2), nullable=False)
        batch_op.alter_column(
            "description",
            new_column_name="title",
            existing_type=sa.String(50),
            type_=sa.String(200),
            existing_nullable=False,
        )
        batch_op.drop_column("amount_minor")
        batch_op.drop_column("created_by")
        batch_op.drop_column("date")
        batch_op.drop_column("updated_at")

    # --- spaces
    with op.batch_alter_table("spaces") as batch_op:
        batch_op.drop_column("currency")
