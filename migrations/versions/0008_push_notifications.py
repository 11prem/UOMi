"""push notifications: device tokens and the queue of pushes to send

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-13 10:00:00.000000

`device_tokens` holds one row per phone that can receive pushes (it goes when its sign-in does). `push_deliveries` is the
queue the worker sends from: one row per card and device, written in the same transaction as the card.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0008'
down_revision: Union[str, None] = '0007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'device_tokens',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('username', sa.String(length=30), nullable=False),
        sa.Column('session_id', sa.String(length=32), nullable=False),
        sa.Column('token', sa.String(length=255), nullable=False),
        sa.Column('platform', sa.String(length=10), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['username'], ['users.username'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['session_id'], ['refresh_tokens.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token'),
    )
    with op.batch_alter_table('device_tokens', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_device_tokens_username'), ['username'], unique=False)
        batch_op.create_index(batch_op.f('ix_device_tokens_session_id'), ['session_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_device_tokens_last_seen_at'), ['last_seen_at'], unique=False)

    op.create_table(
        'push_deliveries',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('notification_id', sa.Integer(), nullable=False),
        sa.Column('device_token_id', sa.Integer(), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['notification_id'], ['notifications.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['device_token_id'], ['device_tokens.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('notification_id', 'device_token_id', name='uq_push_deliveries_card_device'),
    )
    with op.batch_alter_table('push_deliveries', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_push_deliveries_notification_id'), ['notification_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_push_deliveries_device_token_id'), ['device_token_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_push_deliveries_next_attempt_at'), ['next_attempt_at'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('push_deliveries', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_push_deliveries_next_attempt_at'))
        batch_op.drop_index(batch_op.f('ix_push_deliveries_device_token_id'))
        batch_op.drop_index(batch_op.f('ix_push_deliveries_notification_id'))
    op.drop_table('push_deliveries')

    with op.batch_alter_table('device_tokens', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_device_tokens_last_seen_at'))
        batch_op.drop_index(batch_op.f('ix_device_tokens_session_id'))
        batch_op.drop_index(batch_op.f('ix_device_tokens_username'))
    op.drop_table('device_tokens')
