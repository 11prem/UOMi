"""phone-verified sign-up, and forgot password by username

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-10 12:00:00.000000

- `pending_signups`: a sign-up waiting for its texted code. The account is created only when the code is accepted.
- `password_resets` gains what a flow that is identified by an id (not by a phone number) needs: the id the app
  holds, the username that was typed (also when it does not exist), the 10-minute lock, how many texts were sent,
  and when the request as a whole ends. Rows written before this change keep NULLs and are long expired.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0004'
down_revision: Union[str, None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'pending_signups',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('public_id', sa.String(length=40), nullable=False),
        sa.Column('username', sa.String(length=30), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('phone', sa.String(length=20), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('code_hash', sa.String(length=64), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('locked_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('send_count', sa.Integer(), nullable=False),
        sa.Column('last_sent_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('valid_until', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('pending_signups', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_pending_signups_public_id'), ['public_id'], unique=True)
        batch_op.create_index(batch_op.f('ix_pending_signups_username'), ['username'], unique=False)
        batch_op.create_index(batch_op.f('ix_pending_signups_phone'), ['phone'], unique=False)
        batch_op.create_index(batch_op.f('ix_pending_signups_created_at'), ['created_at'], unique=False)

    with op.batch_alter_table('password_resets', schema=None) as batch_op:
        batch_op.add_column(sa.Column('public_id', sa.String(length=40), nullable=True))
        batch_op.add_column(sa.Column('requested_username', sa.String(length=50), nullable=True))
        batch_op.add_column(sa.Column('locked_until', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('send_count', sa.Integer(), server_default='1', nullable=False))
        batch_op.add_column(sa.Column('last_sent_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('valid_until', sa.DateTime(timezone=True), nullable=True))
        batch_op.create_index(batch_op.f('ix_password_resets_public_id'), ['public_id'], unique=True)
        batch_op.create_index(batch_op.f('ix_password_resets_requested_username'), ['requested_username'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('password_resets', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_password_resets_requested_username'))
        batch_op.drop_index(batch_op.f('ix_password_resets_public_id'))
        batch_op.drop_column('valid_until')
        batch_op.drop_column('last_sent_at')
        batch_op.drop_column('send_count')
        batch_op.drop_column('locked_until')
        batch_op.drop_column('requested_username')
        batch_op.drop_column('public_id')

    with op.batch_alter_table('pending_signups', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_pending_signups_created_at'))
        batch_op.drop_index(batch_op.f('ix_pending_signups_phone'))
        batch_op.drop_index(batch_op.f('ix_pending_signups_username'))
        batch_op.drop_index(batch_op.f('ix_pending_signups_public_id'))
    op.drop_table('pending_signups')
