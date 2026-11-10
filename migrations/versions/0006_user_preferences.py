"""the notifications switch is stored on the user

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-10 19:00:00.000000

The default currency was already on the user. The notifications on/off switch (Profile page) moves from the phone
to the server, so a push can honour it. Everyone starts with it on.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0006'
down_revision: Union[str, None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('notifications_on', sa.Boolean(), server_default=sa.true(), nullable=False))


def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('notifications_on')
