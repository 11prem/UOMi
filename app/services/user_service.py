"""Finding people for the Add People page."""

from sqlalchemy import and_, case, select
from sqlalchemy.orm import Session

from app.models.group_member import SpaceMember
from app.models.user import User
from app.schemas.user import UserSearchResult
from app.utils.validators import parse_full_phone

SEARCH_LIMIT = 10
MIN_LETTERS_FOR_EVERYONE = 3


def search_users(db: Session, me: str, query: str) -> list[UserSearchResult]:
    """Search by username or phone number, at most SEARCH_LIMIT rows.

    * Friends (people who share a space with you) match from the first letter and come first.
    * Everyone else matches by username prefix, from MIN_LETTERS_FOR_EVERYONE letters.
    * A phone number only matches when the whole number has been typed.
    * You never appear in your own results, and phone numbers are never returned.
    """
    text = query.strip()
    q = text.lower()
    if not q:
        return []

    my_spaces = select(SpaceMember.space_id).where(SpaceMember.username == me)
    friends = select(SpaceMember.username).where(
        SpaceMember.space_id.in_(my_spaces), SpaceMember.username != me
    )
    is_friend = User.username.in_(friends)
    starts_with = User.username.startswith(q, autoescape=True)
    condition = starts_with if len(q) >= MIN_LETTERS_FOR_EVERYONE else and_(starts_with, is_friend)

    rows = db.execute(
        select(User, is_friend)
        .where(User.username != me, condition)
        .order_by(case((is_friend, 0), else_=1), User.username)
        .limit(SEARCH_LIMIT)
    ).all()
    results = [
        UserSearchResult(username=user.username, name=user.name, is_friend=bool(friend))
        for user, friend in rows
    ]

    phone = parse_full_phone(text)
    if phone is not None:
        match = db.scalar(select(User).where(User.phone == phone, User.username != me))
        if match is not None and all(r.username != match.username for r in results):
            friend_usernames = set(db.scalars(friends))
            results.insert(
                0,
                UserSearchResult(
                    username=match.username, name=match.name, is_friend=match.username in friend_usernames
                ),
            )
    return results[:SEARCH_LIMIT]
