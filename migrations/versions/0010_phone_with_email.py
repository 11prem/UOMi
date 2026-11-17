"""phone numbers come back next to the email

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-16 10:00:00.000000

`users.phone` returns, empty for every existing account (migration 0009 dropped the numbers, so they are not recoverable):
unique and indexed, NULL allowed (several NULLs do not clash). A new account has both a phone and an email; the code
still goes to the email only. `pending_signups` carries the phone until the code is accepted, so its short-lived rows are
dropped here, as 0009 did. `password_resets` is unchanged: forgot password uses the email.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0010'
down_revision: Union[str, None] = '0009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('phone', sa.String(length=20), nullable=True))
        batch_op.create_index(batch_op.f('ix_users_phone'), ['phone'], unique=True)

    op.execute(sa.text('DELETE FROM pending_signups'))
    with op.batch_alter_table('pending_signups', schema=None) as batch_op:
        batch_op.add_column(sa.Column('phone', sa.String(length=20), server_default='', nullable=False))
    with op.batch_alter_table('pending_signups', schema=None) as batch_op:
        batch_op.alter_column('phone', existing_type=sa.String(length=20), server_default=None)


def downgrade() -> None:
    op.execute(sa.text('DELETE FROM pending_signups'))
    with op.batch_alter_table('pending_signups', schema=None) as batch_op:
        batch_op.drop_column('phone')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_users_phone'))
        batch_op.drop_column('phone')
