"""Finding people for the Add People page."""

from sqlalchemy import and_, case, select
from sqlalchemy.orm import Session

from app.models.group_member import SpaceMember
from app.models.user import STATUS_ACTIVE, User
from app.schemas.user import UserSearchResult, UserUpdate


def update_me(db: Session, user: User, data: UserUpdate) -> User:
    """Edit the signed-in person's own name. Their username, email and phone never change."""
    if data.name is not None:
        user.name = data.name
    db.commit()
    db.refresh(user)
    return user


SEARCH_LIMIT = 10
MIN_LETTERS_FOR_EVERYONE = 3


def search_users(db: Session, me: int, query: str) -> list[UserSearchResult]:
    """Search by username, at most SEARCH_LIMIT rows.

    * Friends (people who share a space with you) match from the first letter and come first.
    * Everyone else matches by username prefix, from MIN_LETTERS_FOR_EVERYONE letters.
    * You never appear in your own results, and email addresses and phone numbers are never returned.
    """
    q = query.strip().lower()
    if not q:
        return []

    my_spaces = select(SpaceMember.space_id).where(SpaceMember.user_id == me)
    friends = select(SpaceMember.user_id).where(
        SpaceMember.space_id.in_(my_spaces), SpaceMember.user_id != me
    )
    is_friend = User.id.in_(friends)
    starts_with = User.username.startswith(q, autoescape=True)
    condition = starts_with if len(q) >= MIN_LETTERS_FOR_EVERYONE else and_(starts_with, is_friend)

    rows = db.execute(
        select(User, is_friend)
        .where(User.id != me, User.status == STATUS_ACTIVE, condition)
        .order_by(case((is_friend, 0), else_=1), User.username)
        .limit(SEARCH_LIMIT)
    ).all()
    results = [
        UserSearchResult(username=user.username, name=user.name, is_friend=bool(friend))
        for user, friend in rows
    ]
    return results
