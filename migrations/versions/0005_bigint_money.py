"""money columns become 64-bit

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-10 18:00:00.000000

`amount_minor` was a 32-bit integer, which PostgreSQL caps at 2,147,483,647 minor units. One expense is limited to
999,999,999, but sums and any future limit may not fit, so the three money columns become BIGINT.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0005'
down_revision: Union[str, None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ('expenses', 'expense_shares', 'settlements')


def upgrade() -> None:
    for table in TABLES:
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.alter_column('amount_minor', existing_type=sa.Integer(), type_=sa.BigInteger(), existing_nullable=False)


def downgrade() -> None:
    # Only safe while every amount still fits in 32 bits, which the 999,999,999 limit per expense keeps true for one row.
    for table in TABLES:
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.alter_column('amount_minor', existing_type=sa.BigInteger(), type_=sa.Integer(), existing_nullable=False)
