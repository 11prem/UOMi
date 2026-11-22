"""deleting an account keeps the row, anonymised

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-10 20:00:00.000000

A deleted account stays in `users` (the username is the key other people's records point at) with its name, phone and
password wiped. `deleted_at` says when, and `phone` may now be empty, so the number can be used for a new account.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0007'
down_revision: Union[str, None] = '0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.alter_column('phone', existing_type=sa.String(length=20), nullable=True)


def downgrade() -> None:
    # A deleted account has no phone, and the old schema needs one that is unique: give each a made-up placeholder.
    bind = op.get_bind()
    users = sa.table('users', sa.column('username', sa.String), sa.column('phone', sa.String))
    for number, (username,) in enumerate(bind.execute(sa.select(users.c.username).where(users.c.phone.is_(None))), start=1):
        bind.execute(users.update().where(users.c.username == username).values(phone=f'deleted:{number}'))
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.alter_column('phone', existing_type=sa.String(length=20), nullable=False)
        batch_op.drop_column('deleted_at')
