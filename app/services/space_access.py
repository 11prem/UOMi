"""Look-ups that every feature inside a space needs: "is the caller in this space" and "who is this person".

A space you are not in does not exist as far as you are concerned (404, never 403), so nobody can probe for
other people's spaces. Expenses and payments inherit that rule from their space.
"""

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models.group import Space
from app.models.group_member import SpaceMember
from app.models.user import User
from app.schemas.user import UserSummary
from app.utils.errors import api_error


def lock_space(db: Session, space_id: int) -> None:
    """Hold the space's row until this request commits, so that changes to a space run one after the other.

    It is a write that changes nothing: a row lock on PostgreSQL, the write lock on SQLite. Whatever changes what
    people owe in the space (adding, editing, deleting or answering an expense, recording or confirming a payment) takes
    it, and so does whatever depends on that staying put (removing a member, leaving, deleting the space, changing the
    currency). A check such as "everyone is settled up" or "the space has no expenses" therefore cannot be made stale by
    another request at the same moment. A space that is gone is the usual 404.
    """
    if db.execute(update(Space).where(Space.id == space_id).values(name=Space.name)).rowcount != 1:
        raise api_error(404, "space_not_found", "Space not found.")


def member_space(db: Session, username: str, space_id: int, *, lock: bool = False) -> Space:
    """The space, if `username` is in it. Otherwise the same 404 as a space that does not exist.

    `lock` takes the space's lock first (see `lock_space`) and only then looks at who is in it, so the answer is current.
    """
    if lock:
        lock_space(db, space_id)
    if db.get(SpaceMember, (space_id, username)) is None:
        raise api_error(404, "space_not_found", "Space not found.")
    return db.get(Space, space_id)


def first_name(db: Session, username: str) -> str:
    """What the notification cards call a person: "Alice" for "Alice Rao"."""
    user = db.get(User, username)
    parts = user.name.split() if user else []
    return parts[0] if parts else username


def person(db: Session, username: str) -> UserSummary:
    user = db.get(User, username)
    return UserSummary(username=username, name=user.name if user else username)
