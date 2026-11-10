"""Delete my account (task 1.7.2), under the rule in Appendix B, B.6 (decision 1.7.1).

The rule, in short:
  * The account is ANONYMISED, not removed. The `users` row stays, because the username is the key that other people's
    expenses, shares and payments point at, so their ledgers keep adding up. The row's name becomes "Deleted user",
    its phone is let go, its password is replaced by one nobody knows, and `deleted_at` says when.
  * The username is retired: nobody can sign up with it again, so nobody can pose as the old person in old spaces.
  * The phone number is free again: it can be used to sign up a new account.
  * Deleting is refused until the person is settled up in every space (their balance with everyone is zero, the same rule
    as leaving a space), and while they own a space that still has other people in it (they delete it or remove the
    others first). A space that only they are in goes with the account.
  * Whatever is left of them is removed: their sessions, their cards, their password-reset and sign-in records, their
    place in every space, and any payment of theirs still waiting for an answer (cancelled).
  * Names written inside OTHER people's old cards ("Alice added you to ...") are not rewritten. Those cards are deleted by
    the clean-up job after NOTIFICATION_RETENTION_DAYS.
"""

import secrets

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.database import utcnow
from app.models.group import Space
from app.models.group_member import SpaceMember
from app.models.login_attempt import LoginAttempt
from app.models.notification import Notification, NotificationType
from app.models.password_reset import PasswordReset
from app.models.payment import Settlement, SettlementStatus
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.services import auth_service, balance_service
from app.services.space_access import lock_space
from app.utils import security
from app.utils.errors import api_error, forbidden

DELETED_NAME = "Deleted user"


def _spaces_of(db: Session, username: str) -> list[Space]:
    """Every space the person is in, each locked before it is read (see `lock_space`), so the answers below are current.

    Adding someone needs the space's lock too, so once a space is locked nobody can add this person to a new one behind us.
    The loop covers a space they were added to while the first ones were being locked.
    """
    locked: set[int] = set()
    while True:
        wanted = sorted(set(db.scalars(select(SpaceMember.space_id).where(SpaceMember.username == username))) - locked)
        if not wanted:
            break
        for space_id in wanted:
            lock_space(db, space_id)
            locked.add(space_id)
    return list(db.scalars(select(Space).where(Space.id.in_(locked)).order_by(Space.id)))


def delete_account(db: Session, user: User, password: str) -> None:
    """Delete the signed-in person's account, if they are settled up everywhere and own no space with others in it."""
    auth_service.confirm_password(db, user, password)  # a wrong one is counted like a wrong sign-in
    db.commit()  # keep the cleared count: a right password that is then refused below must not add up towards a lockout
    username = user.username
    unusable_password = security.hash_password(secrets.token_urlsafe(32))  # slow, so before any lock is held

    spaces = _spaces_of(db, username)

    unsettled = [space for space in spaces if any(username in pair for pair in balance_service.pairwise(db, space.id))]
    if unsettled:
        db.rollback()
        raise forbidden(
            "not_settled",
            "Settle up in every space before deleting your account.",
            spaces=[{"id": space.id, "name": space.name} for space in unsettled],
        )

    owned = [space for space in spaces if space.created_by == username]
    shared = [
        space
        for space in owned
        if db.scalar(select(SpaceMember.username).where(SpaceMember.space_id == space.id, SpaceMember.username != username).limit(1))
        is not None
    ]
    if shared:
        db.rollback()
        raise forbidden(
            "owns_shared_space",
            "Delete the spaces you own, or remove the other people from them, before deleting your account.",
            spaces=[{"id": space.id, "name": space.name} for space in shared],
        )

    claimed = db.execute(  # one conditional UPDATE: two parallel deletions cannot both go on
        update(User)
        .where(User.username == username, User.deleted_at.is_(None))
        .values(
            deleted_at=utcnow(),
            name=DELETED_NAME,
            phone=None,
            password_hash=unusable_password,
            notifications_on=False,
        )
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        db.rollback()
        raise api_error(401, "invalid_token", "Invalid access token.")

    pending = list(
        db.scalars(
            select(Settlement.id).where(
                Settlement.status == SettlementStatus.PENDING, (Settlement.payer == username) | (Settlement.payee == username)
            )
        )
    )
    if pending:  # nobody is left to answer these: they are taken back, and the cards asking about them go
        db.execute(
            update(Settlement)
            .where(Settlement.id.in_(pending), Settlement.status == SettlementStatus.PENDING)
            .values(status=SettlementStatus.CANCELLED, answered_at=utcnow())
            .execution_options(synchronize_session=False)
        )
        db.execute(
            delete(Notification).where(Notification.ref_id.in_(pending), Notification.type == NotificationType.PAYMENT_TO_CONFIRM)
        )

    solo = [space.id for space in owned]  # owned and (checked above) nobody else in it: the space goes with the account
    if solo:
        db.execute(delete(Space).where(Space.id.in_(solo)))  # the database cascades its expenses, shares, payments, members
    db.execute(delete(SpaceMember).where(SpaceMember.username == username))

    db.execute(delete(Notification).where(Notification.username == username))
    db.execute(delete(RefreshToken).where(RefreshToken.username == username))
    db.execute(delete(PasswordReset).where((PasswordReset.username == username) | (PasswordReset.requested_username == username)))
    db.execute(delete(LoginAttempt).where(LoginAttempt.username == username))
    db.commit()
