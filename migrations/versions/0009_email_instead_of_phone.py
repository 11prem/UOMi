"""email instead of phone: sign-up verification and forgot password go to an email address

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-14 10:00:00.000000

- `users.phone` is replaced by `users.email` (unique, NOT NULL). Existing accounts have no email yet, so each gets the
  placeholder `<username>@example.invalid` (unique because the username is). A deleted account's phone was NULL; its
  placeholder is the same, and new deletions use `deleted:<username>@example.invalid` (see account_service.py).
- `pending_signups` and `password_resets` swap `phone` for `email`. Their rows are short-lived and each code was bound to
  a phone number, so no old code can be used any more: pending sign-ups are dropped, reset requests are kept with an
  empty email (they are already expired or can never match).

Downgrade brings `phone` back with a unique placeholder per user (`removed:<n>`): the real numbers are not kept.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0009'
down_revision: Union[str, None] = '0008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

users = sa.table('users', sa.column('username', sa.String), sa.column('email', sa.String), sa.column('phone', sa.String))


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('email', sa.String(length=254), nullable=True))
    op.execute(users.update().values(email=users.c.username + sa.literal('@example.invalid')))
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_users_phone'))
        batch_op.drop_column('phone')
        batch_op.alter_column('email', existing_type=sa.String(length=254), nullable=False)
        batch_op.create_index(batch_op.f('ix_users_email'), ['email'], unique=True)

    op.execute(sa.text('DELETE FROM pending_signups'))
    with op.batch_alter_table('pending_signups', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_pending_signups_phone'))
        batch_op.drop_column('phone')
        batch_op.add_column(sa.Column('email', sa.String(length=254), server_default='', nullable=False))
    with op.batch_alter_table('pending_signups', schema=None) as batch_op:
        batch_op.alter_column('email', existing_type=sa.String(length=254), server_default=None)
        batch_op.create_index(batch_op.f('ix_pending_signups_email'), ['email'], unique=False)

    with op.batch_alter_table('password_resets', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_password_resets_phone'))
        batch_op.drop_column('phone')
        batch_op.add_column(sa.Column('email', sa.String(length=254), server_default='', nullable=False))
    with op.batch_alter_table('password_resets', schema=None) as batch_op:
        batch_op.alter_column('email', existing_type=sa.String(length=254), server_default=None)
        batch_op.create_index(batch_op.f('ix_password_resets_email'), ['email'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('password_resets', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_password_resets_email'))
        batch_op.drop_column('email')
        batch_op.add_column(sa.Column('phone', sa.String(length=20), server_default='', nullable=False))
    with op.batch_alter_table('password_resets', schema=None) as batch_op:
        batch_op.alter_column('phone', existing_type=sa.String(length=20), server_default=None)
        batch_op.create_index(batch_op.f('ix_password_resets_phone'), ['phone'], unique=False)

    op.execute(sa.text('DELETE FROM pending_signups'))
    with op.batch_alter_table('pending_signups', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_pending_signups_email'))
        batch_op.drop_column('email')
        batch_op.add_column(sa.Column('phone', sa.String(length=20), server_default='', nullable=False))
    with op.batch_alter_table('pending_signups', schema=None) as batch_op:
        batch_op.alter_column('phone', existing_type=sa.String(length=20), server_default=None)
        batch_op.create_index(batch_op.f('ix_pending_signups_phone'), ['phone'], unique=False)

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('phone', sa.String(length=20), nullable=True))
    bind = op.get_bind()
    for number, (username,) in enumerate(bind.execute(sa.select(users.c.username).order_by(users.c.username)), start=1):
        bind.execute(users.update().where(users.c.username == username).values(phone=f'removed:{number}'))
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_users_email'))
        batch_op.drop_column('email')
        batch_op.create_index(batch_op.f('ix_users_phone'), ['phone'], unique=True)
