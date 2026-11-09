"""refresh token reuse detection: remember the token a session just swapped out

Revision ID: 0003
Revises: bdc30b15495a
Create Date: 2026-11-09 12:00:00.000000

When a refresh token is swapped for a new one, the old token's hash is kept in `previous_token_hash`.
If that old token ever comes back, a copy of it exists somewhere it should not, so the session is ended.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0003'
down_revision: Union[str, None] = 'bdc30b15495a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('refresh_tokens', schema=None) as batch_op:
        batch_op.add_column(sa.Column('previous_token_hash', sa.String(length=64), nullable=True))
        batch_op.create_index(batch_op.f('ix_refresh_tokens_previous_token_hash'), ['previous_token_hash'], unique=False)

    # The daily code cap counts password_resets rows by created_at on every code request.
    with op.batch_alter_table('password_resets', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_password_resets_created_at'), ['created_at'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('password_resets', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_password_resets_created_at'))

    with op.batch_alter_table('refresh_tokens', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_refresh_tokens_previous_token_hash'))
        batch_op.drop_column('previous_token_hash')
