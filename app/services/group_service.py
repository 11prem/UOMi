"""Spaces: creating one, the Home page list, and the Group page.

Everything starts from the signed-in username: a space you are not in does not exist as far as
you are concerned (404, never 403), so nobody can probe for other people's spaces.
"""

from sqlalchemy import delete, exists, select, update
from sqlalchemy.orm import Session

from app.models.expense import Expense
from app.models.group import Space
from app.models.group_member import SpaceMember
from app.models.notification import Notification, NotificationType
from app.models.payment import Settlement
from app.models.user import User
from app.schemas.group import (
    MAX_SPACE_PEOPLE,
    AddMembersRequest,
    MemberOut,
    PairOut,
    SettlementRow,
    SpaceCreate,
    SpaceDetailOut,
    SpaceListOut,
    SpaceUpdate,
)
from app.schemas.user import UserSummary
from app.services import balance_service, expense_service, notification_service
from app.services.space_access import first_name, member_space
from app.utils.errors import api_error, field_error, forbidden
from app.utils.validators import validate_username

EXPENSES_LIMIT = 50


def create_space(db: Session, creator: User, data: SpaceCreate) -> Space:
    """Add People page, tick to create. One transaction: the space, its members, and one
    "you were added" card for each person added. At least one person besides the creator is needed."""
    usernames = [u for u in data.usernames if u != creator.username]
    if not usernames:  # specs § 6.2 (decision 1.2.7): a space is for splitting with somebody, so it starts with someone else
        raise field_error("usernames", "Add at least one other person")

    if usernames:
        found = set(db.scalars(select(User.username).where(User.username.in_(usernames), User.deleted_at.is_(None))))
        missing = [u for u in usernames if u not in found]
        if missing:
            raise api_error(
                422, "unknown_usernames", "Some of these usernames do not exist.", usernames=missing
            )

    space = Space(
        name=data.name,
        icon=data.icon,
        currency=data.currency or creator.currency,
        created_by=creator.username,
    )
    db.add(space)
    db.flush()  # fills in space.id

    db.add(SpaceMember(space_id=space.id, username=creator.username, position=1))
    for position, username in enumerate(usernames, start=2):
        db.add(SpaceMember(space_id=space.id, username=username, position=position))
        notification_service.create_notification(
            db,
            username=username,
            type=NotificationType.SPACE_ADDED,
            message=f"{first_name(db, creator.username)} added you to ‘{space.name}’",
            space_id=space.id,
            space_name=space.name,
        )
    db.commit()
    return space


def list_spaces(db: Session, user: User) -> SpaceListOut:
    """Home page: the overall balance per currency, and the spaces you are in, latest activity first."""
    cards = balance_service.space_cards(db, balance_service.spaces_of(db, user.username), user.username)
    cards.sort(key=lambda card: (card.last_activity_at, card.id), reverse=True)
    return SpaceListOut(overall=balance_service.overall(db, user.username), spaces=cards)


def get_space_detail(db: Session, user: User, space_id: int) -> SpaceDetailOut:
    """Group page: header, your balance, the members, expenses, payments and who owes whom."""
    space = member_space(db, user.username, space_id)

    member_rows = db.execute(
        select(SpaceMember.username, User.name, SpaceMember.position)
        .select_from(SpaceMember)
        .join(User, User.username == SpaceMember.username)
        .where(SpaceMember.space_id == space_id)
        .order_by(SpaceMember.position)
    ).all()
    names = {username: name for username, name, _ in member_rows}

    def person(username: str) -> UserSummary:
        return UserSummary(username=username, name=names.get(username, username))

    settlements = db.scalars(
        select(Settlement).where(Settlement.space_id == space_id).order_by(Settlement.id.desc())
    ).all()

    pairs = balance_service.pairwise(db, space_id)

    # Somebody who left, was removed or deleted their account is still named on the old records, by name ("Deleted user"
    # for a deleted account) and not by username, so the names of everyone the records mention are looked up too.
    recorded = set(db.scalars(select(Expense.paid_by).where(Expense.space_id == space_id).distinct()))
    recorded |= {name for s in settlements for name in (s.payer, s.payee)} | {name for pair in pairs for name in pair}
    if recorded - set(names):
        names.update(db.execute(select(User.username, User.name).where(User.username.in_(recorded - set(names)))).all())
    return SpaceDetailOut(
        id=space.id,
        name=space.name,
        icon=space.icon,
        currency=space.currency,
        owner_username=space.created_by,
        created_at=space.created_at,
        balance_minor=sum(balance_service.side_of(pairs, user.username).values()),
        members=[MemberOut(username=u, name=n, position=p) for u, n, p in member_rows],
        expenses=expense_service.expense_rows(db, space_id, user.username, names, EXPENSES_LIMIT),
        settlements=[
            SettlementRow(
                id=s.id,
                from_user=person(s.payer),
                to_user=person(s.payee),
                amount_minor=s.amount_minor,
                status=s.status,
                created_at=s.created_at,
                answered_at=s.answered_at,
            )
            for s in settlements
        ],
        pairwise=[
            PairOut(
                debtor=person(b if amount > 0 else a),  # a value above 0 means b owes a
                creditor=person(a if amount > 0 else b),
                amount_minor=abs(amount),
            )
            for (a, b), amount in sorted(pairs.items())
        ],
    )


# --- Members and space settings (task 1.2, specs § 10 and § 10.1) -------------------------------------------
#
# Everything here takes the space's lock first (member_space(lock=True)), so "everyone is settled up" and "no expenses
# yet" are checked against what is true now, and cannot be changed by another request before this one commits.
# A person who is not in the space gets the usual 404. A member who may not do it gets a 403 `forbidden` with a `reason`.


def update_space(db: Session, user: User, space_id: int, data: SpaceUpdate) -> SpaceDetailOut:
    """Rename, change the icon (any member), change the currency (the owner, and only before the first expense)."""
    space = member_space(db, user.username, space_id, lock=True)
    new_currency = data.currency if data.currency is not None and data.currency != space.currency else None
    if new_currency is not None:  # the same currency again is no change, so it is always fine
        if space.created_by != user.username:
            raise forbidden("not_owner", "Only the owner can change the currency")
        if db.scalar(select(exists().where(Expense.space_id == space.id))):
            raise forbidden("has_expenses", "Can’t change after expenses are added")
    if data.name is not None:
        space.name = data.name
    if data.icon is not None:
        space.icon = data.icon
    if new_currency is not None:
        space.currency = new_currency
    db.commit()
    return get_space_detail(db, user, space_id)


def add_members(db: Session, user: User, space_id: int, data: AddMembersRequest) -> SpaceDetailOut:
    """Add people (any member). They are members at once and get a "you were added" card, with no accept step.

    Nothing is added unless everything can be: someone who does not exist is a 422, someone who is already in the space
    or a space that would pass 50 people is a 409.
    """
    space = member_space(db, user.username, space_id, lock=True)
    usernames = data.usernames
    known = set(db.scalars(select(User.username).where(User.username.in_(usernames), User.deleted_at.is_(None))))
    missing = [u for u in usernames if u not in known]
    if missing:
        raise api_error(422, "unknown_usernames", "Some of these usernames do not exist.", usernames=missing)
    positions = dict(db.execute(select(SpaceMember.username, SpaceMember.position).where(SpaceMember.space_id == space.id)).all())
    already = [u for u in usernames if u in positions]
    if already:
        raise api_error(409, "already_member", "Some of these people are already in the space.", usernames=already)
    if len(positions) + len(usernames) > MAX_SPACE_PEOPLE:
        raise api_error(409, "space_full", f"A space holds at most {MAX_SPACE_PEOPLE} people.")

    adder = first_name(db, user.username)
    next_position = max(positions.values(), default=0) + 1  # positions keep their order even when someone has left
    for offset, username in enumerate(usernames):
        db.add(SpaceMember(space_id=space.id, username=username, position=next_position + offset))
        notification_service.create_notification(
            db,
            username=username,
            type=NotificationType.SPACE_ADDED,
            message=f"{adder} added you to ‘{space.name}’",
            space_id=space.id,
            space_name=space.name,
        )
    db.commit()
    return get_space_detail(db, user, space_id)


def _ensure_settled_up(db: Session, space_id: int, username: str) -> None:
    """The rule for removing someone and for leaving (specs § 10): their balance with everyone in the space is 0.

    Nothing else blocks it (Appendix B, B.10). A share of theirs that nobody answered, or a payment still waiting for an
    answer, is left as it is: the balance already counts the share, and nobody is stuck, because a payment can still be
    answered by its receiver or cancelled by its payer. Blocking on an unanswered share would trap a person who has paid
    everything, since only they can answer it.
    """
    if any(username in pair for pair in balance_service.pairwise(db, space_id)):
        raise forbidden("not_settled", "Settle up first")


def remove_member(db: Session, user: User, space_id: int, username: str) -> None:
    """Remove a member (the owner only, and only when that member is settled up in the space)."""
    space = member_space(db, user.username, space_id, lock=True)
    if space.created_by != user.username:
        raise forbidden("not_owner", "Only the owner can remove people")
    try:
        username = validate_username(username)
    except ValueError:
        raise api_error(404, "member_not_found", "That person is not in this space.") from None
    if username == space.created_by:
        raise forbidden("owner_cannot_be_removed", "The owner can’t be removed")
    member = db.get(SpaceMember, (space.id, username))
    if member is None:
        raise api_error(404, "member_not_found", "That person is not in this space.")
    _ensure_settled_up(db, space.id, username)
    db.delete(member)
    db.commit()


def leave_space(db: Session, user: User, space_id: int) -> None:
    """Leave (any member except the owner, and only when they are settled up in the space)."""
    space = member_space(db, user.username, space_id, lock=True)
    if space.created_by == user.username:
        raise forbidden("owner_cannot_leave", "The owner can’t leave. Settle up and delete the space instead.")
    _ensure_settled_up(db, space.id, user.username)
    db.delete(db.get(SpaceMember, (space.id, user.username)))
    db.commit()


def delete_space(db: Session, user: User, space_id: int) -> None:
    """Delete the space (the owner only, and only when everyone in it is settled up).

    Its expenses, shares, reminders, payments and members go with it (the database cascades). The other members each get
    a "space deleted" card. Every card about the space stays and still reads, because its `space_id` becomes null and
    the name was copied onto it; a card that was still asking a question about the space is no longer asking.
    """
    space = member_space(db, user.username, space_id, lock=True)
    if space.created_by != user.username:
        raise forbidden("not_owner", "Only the owner can delete this space")
    if balance_service.pairwise(db, space.id):
        raise forbidden("not_settled", "Everyone must be settled up first")

    deleter = first_name(db, user.username)
    others = db.scalars(select(SpaceMember.username).where(SpaceMember.space_id == space.id, SpaceMember.username != user.username)).all()
    for username in others:
        notification_service.create_notification(
            db,
            username=username,
            type=NotificationType.SPACE_DELETED,
            message=f"{deleter} deleted ‘{space.name}’",
            space_id=space.id,
            space_name=space.name,
        )
    db.execute(update(Notification).where(Notification.space_id == space.id, Notification.needs_answer.is_(True)).values(needs_answer=False))
    db.flush()  # the new cards are written before the space goes, and the database then nulls their space_id
    db.execute(delete(Space).where(Space.id == space.id))
    db.commit()

