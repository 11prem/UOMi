"""Settling up (task 1.4): record a payment made outside the app, and the other person's answer. No money moves.

Rules the server enforces itself:
  - Only the person who owes can record a payment, and never more than they still owe the receiver, counting the
    payments already waiting for an answer (so the same debt cannot be recorded twice).
  - Only the receiver can confirm or reject, and only while it is pending. Only the payer can cancel, and only
    while it is pending. Only confirmed payments change a balance (balance_service).
  - Every change and the card it sends are saved in one transaction, or not at all.
"""

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.currencies import format_money
from app.database import utcnow
from app.models.group import Space
from app.models.group_member import SpaceMember
from app.models.notification import Notification, NotificationType
from app.models.payment import Settlement, SettlementStatus
from app.models.user import User
from app.schemas.group import SpaceHeader
from app.schemas.settlement import PayeeOut, SettlementCreate, SettlementDetailOut
from app.services import balance_service, notification_service
from app.services.space_access import first_name as _first_name
from app.services.space_access import lock_space, member_space, person
from app.utils.errors import api_error, field_error, forbidden


def _payable(db: Session, space_id: int, username: str) -> dict[str, tuple[int, int]]:
    """Everyone `username` owes: their username -> (what is owed, the most that can be recorded paying them now)."""
    owing = {
        other: -amount
        for other, amount in balance_service.viewer_pairs(db, space_id, username).items()
        if amount < 0
    }
    pending = dict(
        db.execute(
            select(Settlement.payee, func.sum(Settlement.amount_minor))
            .where(
                Settlement.space_id == space_id,
                Settlement.payer == username,
                Settlement.status == SettlementStatus.PENDING,
            )
            .group_by(Settlement.payee)
        ).all()
    )
    return {other: (owed, max(0, owed - pending.get(other, 0))) for other, owed in owing.items()}


def list_payees(db: Session, user: User, space_id: int) -> list[PayeeOut]:
    """The people the viewer owes in this space (members first, in member-list order), who can still be paid."""
    space = member_space(db, user.username, space_id)
    positions = dict(
        db.execute(select(SpaceMember.username, SpaceMember.position).where(SpaceMember.space_id == space.id)).all()
    )
    payable = _payable(db, space.id, user.username)
    # Someone who has left can still be paid what the viewer owes them, so they are listed too, after the members.
    order = sorted(payable, key=lambda other: (positions.get(other, len(positions) + 1), other))
    return [
        PayeeOut(user=person(db, other), owed_minor=payable[other][0], max_minor=payable[other][1])
        for other in order
        if payable[other][1] > 0  # everything owed is already recorded and waiting for an answer: nothing left to pay
    ]


def create_settlement(db: Session, payer: User, space_id: int, data: SettlementCreate) -> SettlementDetailOut:
    space = member_space(db, payer.username, space_id, lock=True)  # recording a payment depends on what is owed now
    payee = data.to_username
    if payee == payer.username or db.get(User, payee) is None:
        raise api_error(404, "person_not_found", "Person not found.")

    # One payment at a time per person and space. What can still be recorded is read, and then a payment is written,
    # so two requests at the same moment would both read "₹500 left" and both record ₹500. A write that changes
    # nothing takes the payer's membership row (PostgreSQL: a row lock; SQLite: the write lock) until this request
    # commits, so the next one reads the amounts again only after this payment is in.
    db.execute(
        update(SpaceMember)
        .where(SpaceMember.space_id == space.id, SpaceMember.username == payer.username)
        .values(position=SpaceMember.position)
    )
    owed, most = _payable(db, space.id, payer.username).get(payee, (0, 0))
    if owed == 0:
        if db.get(SpaceMember, (space.id, payee)) is None:  # someone who left can still be paid
            raise api_error(404, "person_not_found", "Person not found.")
        raise forbidden("owes_nothing", f"You don’t owe {_first_name(db, payee)} anything in this space")
    if data.amount_minor > most:
        raise field_error("amount_minor", f"The most you can record is {format_money(most, space.currency)}")

    settlement = Settlement(space_id=space.id, payer=payer.username, payee=payee, amount_minor=data.amount_minor)
    db.add(settlement)
    db.flush()
    notification_service.create_notification(
        db,
        username=payee,
        type=NotificationType.PAYMENT_TO_CONFIRM,
        message=f"{_first_name(db, payer.username)} says they paid you {format_money(data.amount_minor, space.currency)}",
        space_id=space.id,
        space_name=space.name,
        ref_id=settlement.id,
        needs_answer=True,
    )
    db.commit()  # the payment and the card are saved together, or not at all
    return _detail(db, settlement, space)


def get_settlement(db: Session, user: User, settlement_id: int) -> SettlementDetailOut:
    settlement, space = _settlement_of(db, user.username, settlement_id)
    return _detail(db, settlement, space)


def answer_settlement(
    db: Session, user: User, settlement_id: int, verdict: SettlementStatus
) -> SettlementDetailOut:
    """Confirm or reject (`verdict` is CONFIRMED or REJECTED). The payer is told."""
    settlement, space = _settlement_of(db, user.username, settlement_id, lock=True)  # a confirm changes what is owed
    if settlement.payee != user.username:
        raise forbidden("not_payee", "Only the person receiving the payment can answer it")
    if settlement.status != SettlementStatus.PENDING:
        raise forbidden("already_answered", "This payment has already been answered")

    # Claimed with one conditional UPDATE, not a read and then a write: of a confirm and a cancel (or two confirms) at
    # the same moment, exactly one changes the row, and only that one sends a card.
    claimed = db.execute(
        update(Settlement)
        .where(Settlement.id == settlement.id, Settlement.status == SettlementStatus.PENDING)
        .values(status=verdict, answered_at=utcnow())
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        db.rollback()
        raise forbidden("already_answered", "This payment has already been answered")
    db.execute(
        update(Notification)
        .where(
            Notification.username == user.username,
            Notification.type == NotificationType.PAYMENT_TO_CONFIRM,
            Notification.ref_id == settlement.id,
            Notification.needs_answer.is_(True),
        )
        .values(needs_answer=False, read=True)
    )
    notification_service.create_notification(
        db,
        username=settlement.payer,
        type=NotificationType.PAYMENT_ANSWERED,
        message=(
            f"{_first_name(db, user.username)} {verdict.value} your "
            f"{format_money(settlement.amount_minor, space.currency)} payment"
        ),
        space_id=space.id,
        space_name=space.name,
        ref_id=settlement.id,
    )
    db.commit()
    return _detail(db, settlement, space)


def cancel_settlement(db: Session, user: User, settlement_id: int) -> SettlementDetailOut:
    settlement, space = _settlement_of(db, user.username, settlement_id)
    if settlement.payer != user.username:
        raise forbidden("not_payer", "Only the person who recorded this payment can cancel it")
    if settlement.status != SettlementStatus.PENDING:
        raise forbidden(
            "not_pending",
            "Confirmed payments can’t be cancelled"
            if settlement.status == SettlementStatus.CONFIRMED
            else "Only pending payments can be cancelled",
        )

    claimed = db.execute(  # one conditional UPDATE, like the answer: a parallel confirm cannot be overwritten
        update(Settlement)
        .where(Settlement.id == settlement.id, Settlement.status == SettlementStatus.PENDING)
        .values(status=SettlementStatus.CANCELLED, answered_at=utcnow())
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        now_status = db.scalar(select(Settlement.status).where(Settlement.id == settlement.id))
        db.rollback()
        raise forbidden(
            "not_pending",
            "Confirmed payments can’t be cancelled"
            if now_status == SettlementStatus.CONFIRMED
            else "Only pending payments can be cancelled",
        )
    # Only this payment's card: an expense card can carry the same number in `ref_id`.
    db.execute(
        delete(Notification).where(
            Notification.ref_id == settlement.id, Notification.type == NotificationType.PAYMENT_TO_CONFIRM
        )
    )
    db.commit()
    return _detail(db, settlement, space)


# --- helpers ------------------------------------------------------------------------------------


def _settlement_of(db: Session, username: str, settlement_id: int, *, lock: bool = False) -> tuple[Settlement, Space]:
    """The payment and its space, if `username` is in that space. Otherwise it does not exist for them.

    `lock` takes the space's lock first (see space_access.lock_space): for what changes what people owe.
    """
    if lock:
        space_id = db.scalar(select(Settlement.space_id).where(Settlement.id == settlement_id))
        if space_id is not None:
            lock_space(db, space_id)
    settlement = db.get(Settlement, settlement_id)
    if settlement is None or db.get(SpaceMember, (settlement.space_id, username)) is None:
        raise api_error(404, "settlement_not_found", "Payment not found.")
    return settlement, db.get(Space, settlement.space_id)


def _detail(db: Session, settlement: Settlement, space: Space) -> SettlementDetailOut:
    return SettlementDetailOut(
        id=settlement.id,
        space=SpaceHeader(
            id=space.id,
            name=space.name,
            icon=space.icon,
            currency=space.currency,
            owner_username=space.created_by,
            created_at=space.created_at,
        ),
        from_user=person(db, settlement.payer),
        to_user=person(db, settlement.payee),
        amount_minor=settlement.amount_minor,
        status=settlement.status,
        created_at=settlement.created_at,
        answered_at=settlement.answered_at,
    )
