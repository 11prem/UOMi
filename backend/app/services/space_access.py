"""Look-ups that every feature inside a space needs: "is the caller in this space" and "who is this person".

A space you are not in does not exist as far as you are concerned (404, never 403), so nobody can probe for
other people's spaces. Expenses and payments inherit that rule from their space.

Inside the database every table points at a person by the integer `users.id`; the API speaks usernames. The helpers
here turn one into the other (`people_of`, `person`, `active_ids`, `owner_username`), so the services never mix them up.
"""

from collections.abc import Iterable

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.group import Space
from app.models.group_member import SpaceMember
from app.models.user import STATUS_ACTIVE, User
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


def member_space(db: Session, user_id: int, space_id: int, *, lock: bool = False) -> Space:
    """The space, if the person is in it. Otherwise the same 404 as a space that does not exist.

    `lock` takes the space's lock first (see `lock_space`) and only then looks at who is in it, so the answer is current.
    """
    if lock:
        lock_space(db, space_id)
    if db.get(SpaceMember, (space_id, user_id)) is None:
        raise api_error(404, "space_not_found", "Space not found.")
    return db.get(Space, space_id)


def people_of(db: Session, user_ids: Iterable[int]) -> dict[int, UserSummary]:
    """id -> (username, name) for every given person, in one query."""
    wanted = set(user_ids)
    if not wanted:
        return {}
    rows = db.execute(select(User.id, User.username, User.name).where(User.id.in_(wanted))).all()
    return {uid: UserSummary(username=username, name=name) for uid, username, name in rows}


def person(db: Session, user_id: int) -> UserSummary:
    found = people_of(db, [user_id]).get(user_id)
    return found if found is not None else UserSummary(username="unknown", name="Unknown")


def first_name(db: Session, user_id: int) -> str:
    """What the notification cards call a person: "Alice" for "Alice Rao"."""
    who = people_of(db, [user_id]).get(user_id)
    if who is None:
        return "Someone"
    parts = who.name.split()
    return parts[0] if parts else who.username


def active_ids(db: Session, usernames: Iterable[str]) -> dict[str, int]:
    """username -> id for the people who exist and can be found and added (a sign-up that is not verified is not one)."""
    wanted = set(usernames)
    if not wanted:
        return {}
    return dict(
        db.execute(select(User.username, User.id).where(User.username.in_(wanted), User.status == STATUS_ACTIVE)).all()
    )


def owner_username(db: Session, space: Space) -> str:
    return person(db, space.created_by).username
