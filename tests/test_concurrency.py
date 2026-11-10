"""Requests at the same moment: the limits, the money and the answers must hold when every request reads first.

Each test runs the SERVICE functions in threads on a real SQLite file, with a barrier so that every thread has read
before any of them writes: the worst case for code that reads, decides in Python and then writes. (SQLite lets only
one writer in at a time, which hides some races, so each test also says what the old code did.)
"""

import itertools
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import Base, make_engine, utcnow
from app.models.expense import Expense, SplitType
from app.models.expense_split import ExpenseShare, ShareStatus
from app.models.group import Space
from app.models.group_member import SpaceMember
from app.models.notification import Notification, NotificationType
from app.models.password_reset import PasswordReset
from app.models.payment import Settlement, SettlementStatus
from app.models.pending_signup import PendingSignup
from app.models.user import User
from app.schemas.expense import ExpenseWrite, ShareIn
from app.schemas.group import AddMembersRequest
from app.schemas.settlement import SettlementCreate
from app.schemas.user import RegisterRequest
from app.services import auth_service, expense_service, group_service, settlement_service
from tests.helpers import register_payload

PHONES = {"alice": "+919876543210", "bob": "+919876543211", "carol": "+919876543212"}


@pytest.fixture
def engine(tmp_path):
    """A real SQLite file, so that threads use separate connections (the in-memory test database shares one)."""
    eng = make_engine(f"sqlite:///{(tmp_path / 'race.db').as_posix()}")
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


def run_each(engine, works):
    """Run each callable in its own thread, all reading before any writes. Returns ("ok", value) or ("error", code)."""
    barrier = threading.Barrier(len(works), timeout=10)
    first_read = threading.local()

    @event.listens_for(engine, "after_cursor_execute")
    def wait_for_everyone_to_read(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT") and not getattr(first_read, "done", True):
            first_read.done = True
            barrier.wait()

    def runner(work):
        first_read.done = False
        with Session(engine) as db:
            try:
                return "ok", work(db)
            except HTTPException as exc:
                return "error", exc.detail["code"]

    with ThreadPoolExecutor(len(works)) as pool:
        return list(pool.map(runner, works))


def seed(engine) -> tuple[int, int]:
    """alice, bob and carol in one space. Bob owes alice ₹500 (a ₹1000 rent alice paid, split with bob).

    Returns (space id, expense id)."""
    with Session(engine) as db:
        for name, phone in PHONES.items():
            db.add(User(username=name, name=name.capitalize(), phone=phone, password_hash="x"))
        db.flush()
        space = Space(name="Flat", icon="home", currency="INR", created_by="alice")
        db.add(space)
        db.flush()
        db.add_all([SpaceMember(space_id=space.id, username=n, position=i) for i, n in enumerate(PHONES, start=1)])
        expense = Expense(
            space_id=space.id, paid_by="alice", created_by="alice", description="Rent", amount_minor=100000,
            split_type=SplitType.EQUAL, date=utcnow().date(),
        )
        db.add(expense)
        db.flush()
        db.add(ExpenseShare(expense_id=expense.id, username="alice", amount_minor=50000, status=ShareStatus.ACCEPTED, responded_at=utcnow()))
        db.add(ExpenseShare(expense_id=expense.id, username="bob", amount_minor=50000, status=ShareStatus.PENDING))
        db.commit()
        return space.id, expense.id


def count(engine, model, *where) -> int:
    with Session(engine) as db:
        return len(db.scalars(select(model).where(*where)).all())


def cards(engine, username, type_) -> int:
    return count(engine, Notification, Notification.username == username, Notification.type == type_)


# --- Starting a sign-up or a reset: the limits hold under a burst -------------------------------------


def signup_for(phone: str, counter) -> callable:
    def start(db):
        return auth_service.start_signup(
            db, RegisterRequest(**register_payload(username=f"user{next(counter):02d}", phone=phone)), BackgroundTasks()
        )

    return start


def test_a_burst_of_sign_ups_for_one_phone_gets_one_text(engine):
    """Old code: all 10 passed the cooldown check (each read 'nothing sent yet'), so all 10 were texted."""
    counter = itertools.count()
    results = run_each(engine, [signup_for("+919876543299", counter) for _ in range(10)])

    passed = [r for r in results if r[0] == "ok"]
    assert len(passed) <= 1
    assert {value for kind, value in results if kind == "error"} <= {"resend_too_soon", "too_many_requests"}
    assert count(engine, PendingSignup) == len(passed)  # a refused request takes its own row back out


def test_a_burst_obeys_the_hourly_limit_even_without_the_cooldown(engine, monkeypatch):
    monkeypatch.setattr(settings, "OTP_RESEND_COOLDOWN_SECONDS", 0)
    counter = itertools.count()
    results = run_each(engine, [signup_for("+919876543299", counter) for _ in range(10)])

    passed = [r for r in results if r[0] == "ok"]
    assert 1 <= len(passed) <= settings.OTP_MAX_REQUESTS_PER_HOUR  # old code: all 10
    assert count(engine, PendingSignup) == len(passed)


def test_a_burst_of_forgot_password_requests_for_one_username_is_limited_too(engine, monkeypatch):
    monkeypatch.setattr(settings, "OTP_RESEND_COOLDOWN_SECONDS", 0)
    seed(engine)
    results = run_each(engine, [lambda db: auth_service.request_password_reset(db, "alice", BackgroundTasks()) for _ in range(10)])

    passed = [r for r in results if r[0] == "ok"]
    assert 1 <= len(passed) <= settings.OTP_MAX_REQUESTS_PER_HOUR  # old code: all 10
    assert count(engine, PasswordReset) == len(passed)


def test_a_burst_of_made_up_usernames_is_limited_exactly_like_a_real_one(engine, monkeypatch):
    monkeypatch.setattr(settings, "OTP_RESEND_COOLDOWN_SECONDS", 0)
    results = run_each(engine, [lambda db: auth_service.request_password_reset(db, "nobody.here", BackgroundTasks()) for _ in range(10)])

    passed = [r for r in results if r[0] == "ok"]
    assert 1 <= len(passed) <= settings.OTP_MAX_REQUESTS_PER_HOUR


def test_a_burst_across_many_phones_cannot_pass_the_daily_cap(engine, monkeypatch):
    monkeypatch.setattr(settings, "SMS_DAILY_CAP", 2)
    counter = itertools.count()
    phones = [f"+91987650{n:04d}" for n in range(1000, 1008)]
    results = run_each(engine, [signup_for(phone, counter) for phone in phones])

    passed = [r for r in results if r[0] == "ok"]
    assert 1 <= len(passed) <= 2  # old code: all 8
    assert count(engine, PendingSignup) == len(passed)


def test_the_daily_cap_still_counts_a_sign_up_after_it_is_verified(engine, monkeypatch):
    """Old code deleted the sign-up when it was verified, so the cap forgot its text: 6 accounts under a cap of 3."""
    monkeypatch.setattr(settings, "SMS_DAILY_CAP", 3)
    texts = {}
    monkeypatch.setattr("app.services.sms_service.send_sms", lambda phone, message: texts.setdefault(phone, message))
    created = 0
    for n in range(6):
        phone = f"+91987650{n:04d}"
        with Session(engine) as db:
            tasks = BackgroundTasks()
            try:
                started = auth_service.start_signup(
                    db, RegisterRequest(**register_payload(username=f"user{n:02d}", phone=phone)), tasks
                )
            except HTTPException as refused:
                assert refused.detail["code"] == "too_many_requests"
                continue
            import asyncio

            asyncio.run(tasks())
            code = texts[phone].split("code is ")[1][:6]
            auth_service.verify_signup(db, started.pending_id, code)
            created += 1
    assert created == 3
    assert count(engine, User) == 3


# --- Payments --------------------------------------------------------------------------------------------


def test_the_same_debt_cannot_be_recorded_twice_at_the_same_moment(engine):
    """Old code: every request read '₹500 left', so all five recorded the full ₹500 (₹2500 of payments for a ₹500 debt)."""
    space_id, _ = seed(engine)

    def pay(db):
        bob = db.get(User, "bob")
        return settlement_service.create_settlement(db, bob, space_id, SettlementCreate(to_username="alice", amount_minor=50000))

    results = run_each(engine, [pay] * 5)

    assert [kind for kind, _ in results].count("ok") == 1
    assert {value for kind, value in results if kind == "error"} == {"validation_error"}
    assert count(engine, Settlement, Settlement.status == SettlementStatus.PENDING) == 1
    assert cards(engine, "alice", NotificationType.PAYMENT_TO_CONFIRM) == 1


def test_pending_payments_never_add_up_to_more_than_is_owed_even_in_parts(engine):
    space_id, _ = seed(engine)

    def pay(db):
        bob = db.get(User, "bob")
        return settlement_service.create_settlement(db, bob, space_id, SettlementCreate(to_username="alice", amount_minor=20000))

    results = run_each(engine, [pay] * 5)  # ₹200 each against ₹500 owed: two fit, the third would not

    assert [kind for kind, _ in results].count("ok") == 2
    with Session(engine) as db:
        pending = db.scalars(select(Settlement).where(Settlement.status == SettlementStatus.PENDING)).all()
        assert sum(s.amount_minor for s in pending) == 40000


def new_pending_payment(engine, space_id) -> int:
    with Session(engine) as db:
        payment = Settlement(space_id=space_id, payer="bob", payee="alice", amount_minor=20000)
        db.add(payment)
        db.flush()
        db.add(Notification(username="alice", type=NotificationType.PAYMENT_TO_CONFIRM, message="Bob says they paid you ₹200",
                            space_id=space_id, ref_id=payment.id, needs_answer=True))
        db.commit()
        return payment.id


def test_a_confirm_and_a_cancel_at_the_same_moment_have_one_winner(engine):
    """Old code: both returned 200; the payer was told 'cancelled' while the payment stayed confirmed and counted."""
    space_id, _ = seed(engine)
    payment_id = new_pending_payment(engine, space_id)

    def confirm(db):
        return settlement_service.answer_settlement(db, db.get(User, "alice"), payment_id, SettlementStatus.CONFIRMED)

    def cancel(db):
        return settlement_service.cancel_settlement(db, db.get(User, "bob"), payment_id)

    results = run_each(engine, [confirm, cancel])

    assert sorted(kind for kind, _ in results) == ["error", "ok"]
    assert {value for kind, value in results if kind == "error"} <= {"forbidden"}
    winner = next(value for kind, value in results if kind == "ok")
    with Session(engine) as db:
        assert db.get(Settlement, payment_id).status == winner.status  # what the winner was told is what is stored
    assert winner.status in (SettlementStatus.CONFIRMED, SettlementStatus.CANCELLED)
    if winner.status == SettlementStatus.CONFIRMED:
        assert cards(engine, "bob", NotificationType.PAYMENT_ANSWERED) == 1
    else:
        assert cards(engine, "alice", NotificationType.PAYMENT_TO_CONFIRM) == 0  # the receiver's card is gone
        assert cards(engine, "bob", NotificationType.PAYMENT_ANSWERED) == 0


def stale_payment(engine, monkeypatch, payment_id, space_id):
    """Make the service act on what it read BEFORE another request changed the payment: the exact moment of the race.

    A thread race only shows a missing guard in some orderings (SQLite lets one writer in at a time), so this does it
    on purpose: the payment is loaded while still pending, then another request answers it, and only then does the
    service under test do its write, still believing the payment is pending.
    """
    reader = Session(engine)
    stale = (reader.get(Settlement, payment_id), reader.get(Space, space_id))
    assert stale[0].status == SettlementStatus.PENDING
    monkeypatch.setattr(settlement_service, "_settlement_of", lambda db, username, settlement_id, lock=False: stale)
    return reader


def test_a_cancel_cannot_overwrite_a_confirm_that_landed_after_it_looked(engine, monkeypatch):
    space_id, _ = seed(engine)
    payment_id = new_pending_payment(engine, space_id)
    reader = stale_payment(engine, monkeypatch, payment_id, space_id)
    other = Session(engine)  # the receiver's confirm lands first, written by a plain UPDATE like the service does
    other.execute(
        Settlement.__table__.update().where(Settlement.id == payment_id).values(status=SettlementStatus.CONFIRMED, answered_at=utcnow())
    )
    other.commit()

    with Session(engine) as db, pytest.raises(HTTPException) as refused:
        settlement_service.cancel_settlement(db, db.get(User, "bob"), payment_id)

    assert refused.value.detail["code"] == "forbidden" and refused.value.detail["reason"] == "not_pending"
    assert refused.value.detail["message"] == "Confirmed payments can’t be cancelled"
    with Session(engine) as db:
        assert db.get(Settlement, payment_id).status == SettlementStatus.CONFIRMED  # not overwritten with "cancelled"
    assert cards(engine, "alice", NotificationType.PAYMENT_TO_CONFIRM) == 1  # and the card was not deleted
    reader.close()
    other.close()


def test_a_confirm_cannot_overwrite_a_cancel_that_landed_after_it_looked(engine, monkeypatch):
    space_id, _ = seed(engine)
    payment_id = new_pending_payment(engine, space_id)
    reader = stale_payment(engine, monkeypatch, payment_id, space_id)
    other = Session(engine)  # the payer's cancel lands first
    other.execute(
        Settlement.__table__.update().where(Settlement.id == payment_id).values(status=SettlementStatus.CANCELLED, answered_at=utcnow())
    )
    other.commit()

    with Session(engine) as db, pytest.raises(HTTPException) as refused:
        settlement_service.answer_settlement(db, db.get(User, "alice"), payment_id, SettlementStatus.CONFIRMED)

    assert refused.value.detail["reason"] == "already_answered"
    with Session(engine) as db:
        assert db.get(Settlement, payment_id).status == SettlementStatus.CANCELLED  # not turned into "confirmed"
    assert cards(engine, "bob", NotificationType.PAYMENT_ANSWERED) == 0  # and nobody was told it was confirmed
    reader.close()
    other.close()


def test_two_confirms_at_the_same_moment_send_one_card(engine):
    space_id, _ = seed(engine)
    payment_id = new_pending_payment(engine, space_id)

    def confirm(db):
        return settlement_service.answer_settlement(db, db.get(User, "alice"), payment_id, SettlementStatus.CONFIRMED)

    results = run_each(engine, [confirm, confirm])

    assert sorted(kind for kind, _ in results) == ["error", "ok"]
    assert [value for kind, value in results if kind == "error"] == ["forbidden"]
    assert cards(engine, "bob", NotificationType.PAYMENT_ANSWERED) == 1  # old code: two "confirmed your payment" cards


# --- Expenses --------------------------------------------------------------------------------------------


def test_repeating_a_reject_at_the_same_moment_tells_the_creator_once(engine):
    """Old code: four parallel rejects sent four cards, although the docs promise a repeated answer changes nothing."""
    _, expense_id = seed(engine)

    def reject(db):
        return expense_service.answer_share(db, db.get(User, "bob"), expense_id, ShareStatus.REJECTED)

    results = run_each(engine, [reject] * 4)

    assert [kind for kind, _ in results] == ["ok"] * 4  # a repeat is not an error
    assert cards(engine, "alice", NotificationType.SHARE_REJECTED) == 1


# --- Space management: the checks cannot go stale ---------------------------------------------------------------
#
# "Everyone is settled up", "no expenses yet" and "fewer than 50 people" are each checked and then acted on. Every change
# to a space's money or people takes the space's lock first, so another request cannot slip in between. Each of these
# runs several rounds, because which request wins is up to the scheduler; with the lock, every round must come out whole.


def seed_users(engine) -> None:
    with Session(engine) as db:
        for name, phone in PHONES.items():
            db.add(User(username=name, name=name.capitalize(), phone=phone, password_hash="x"))
        db.commit()


def new_space(engine) -> int:
    """A space of alice (the owner), bob and carol, with nothing owed."""
    with Session(engine) as db:
        space = Space(name="Flat", icon="home", currency="INR", created_by="alice")
        db.add(space)
        db.flush()
        db.add_all([SpaceMember(space_id=space.id, username=n, position=i) for i, n in enumerate(PHONES, start=1)])
        db.commit()
        return space.id


def tea(space_id: int, *people: str) -> ExpenseWrite:
    """A ₹30 expense alice paid, split between `people`."""
    return ExpenseWrite(
        description="Tea", amount_minor=3000, paid_by="alice", split_type=SplitType.EQUAL,
        shares=[ShareIn(username=n) for n in people], date=utcnow().date(),
    )


def test_deleting_a_space_and_adding_an_expense_at_the_same_moment_cannot_lose_the_expense(engine):
    """The owner checks "settled up" and deletes the space while someone adds an expense: one of them must lose, whole.

    Without the lock the delete can pass its check just before the expense lands, and the expense is lost with the space
    (or the expense fails on a space that is gone, as a crash instead of a 404)."""
    seed_users(engine)
    for _ in range(6):
        space_id = new_space(engine)

        def delete(db, space_id=space_id):
            return group_service.delete_space(db, db.get(User, "alice"), space_id)

        def add(db, space_id=space_id):
            return expense_service.create_expense(db, db.get(User, "alice"), space_id, tea(space_id, "alice", "bob"))

        results = run_each(engine, [delete, add])

        assert sorted(kind for kind, _ in results) == ["error", "ok"]
        deleted = count(engine, Space, Space.id == space_id) == 0
        if deleted:  # the delete came first: the expense found no space
            assert {value for kind, value in results if kind == "error"} == {"space_not_found"}
            assert count(engine, Expense, Expense.space_id == space_id) == 0
        else:  # the expense came first: the space is not settled up any more, so it stays
            assert {value for kind, value in results if kind == "error"} == {"forbidden"}
            assert count(engine, Expense, Expense.space_id == space_id) == 1


def test_removing_a_member_and_adding_an_expense_that_includes_them_cannot_leave_them_owing(engine):
    """Without the lock bob could be removed while the expense that makes him owe ₹15 is being saved."""
    seed_users(engine)
    for _ in range(6):
        space_id = new_space(engine)

        def remove(db, space_id=space_id):
            return group_service.remove_member(db, db.get(User, "alice"), space_id, "bob")

        def add(db, space_id=space_id):
            return expense_service.create_expense(db, db.get(User, "alice"), space_id, tea(space_id, "alice", "bob"))

        results = run_each(engine, [remove, add])

        assert sorted(kind for kind, _ in results) == ["error", "ok"]
        bob_is_in = count(engine, SpaceMember, SpaceMember.space_id == space_id, SpaceMember.username == "bob") == 1
        owed = count(engine, ExpenseShare, ExpenseShare.username == "bob", ExpenseShare.expense_id.in_(
            select(Expense.id).where(Expense.space_id == space_id)))
        assert not (owed and not bob_is_in)  # nobody who owes money is outside the space
        if bob_is_in:  # the expense came first, so removing him was refused
            assert {value for kind, value in results if kind == "error"} == {"forbidden"}
        else:  # he was removed first, so the expense could not include him
            assert {value for kind, value in results if kind == "error"} == {"validation_error"}


def test_two_people_adding_at_the_limit_cannot_both_get_in(engine):
    """49 people, two requests each adding one: without the lock both read 49 and the space ends up with 51."""
    seed_users(engine)
    with Session(engine) as db:
        for name in ("late.one", "late.two"):
            db.add(User(username=name, name=name.title(), phone="+9190000" + str(abs(hash(name)) % 100000).zfill(5), password_hash="x"))
        db.commit()
    for round_ in range(4):
        space_id = new_space(engine)
        with Session(engine) as db:
            for n in range(46):  # alice, bob and carol, and 46 more: 49
                filler = f"filler{round_}_{n:02d}"
                db.add(User(username=filler, name=filler, phone=f"+9191{round_}{n:07d}", password_hash="x"))
                db.flush()
                db.add(SpaceMember(space_id=space_id, username=filler, position=4 + n))
            db.commit()

        def add(name):
            def work(db):
                return group_service.add_members(db, db.get(User, "alice"), space_id, AddMembersRequest(usernames=[name]))

            return work

        results = run_each(engine, [add("late.one"), add("late.two")])

        assert sorted(kind for kind, _ in results) == ["error", "ok"]
        assert {value for kind, value in results if kind == "error"} == {"space_full"}
        assert count(engine, SpaceMember, SpaceMember.space_id == space_id) == 50


def test_leaving_and_being_removed_at_the_same_moment_is_not_an_error_for_the_one_that_comes_second_but_a_clean_404(engine):
    seed_users(engine)
    for _ in range(4):
        space_id = new_space(engine)

        def leave(db, space_id=space_id):
            return group_service.leave_space(db, db.get(User, "bob"), space_id)

        def remove(db, space_id=space_id):
            return group_service.remove_member(db, db.get(User, "alice"), space_id, "bob")

        results = run_each(engine, [leave, remove])

        assert sorted(kind for kind, _ in results) == ["error", "ok"]  # bob is out once, and the other is told so
        assert {value for kind, value in results if kind == "error"} <= {"space_not_found", "member_not_found"}
        assert count(engine, SpaceMember, SpaceMember.space_id == space_id, SpaceMember.username == "bob") == 0


# --- Deleting an account ---------------------------------------------------------------------------


def test_two_deletions_of_one_account_at_the_same_moment_delete_it_once(engine):
    """Both requests pass the password check and read the same state; only one may go on to anonymise the row."""
    from app.services import account_service
    from app.utils import security

    seed(engine)
    with Session(engine) as db:
        db.get(User, "carol").password_hash = security.hash_password("password123")
        db.commit()

    def delete(db):
        return account_service.delete_account(db, db.get(User, "carol"), "password123")

    results = run_each(engine, [delete, delete])

    assert sorted(kind for kind, _ in results) == ["error", "ok"]
    assert [value for kind, value in results if kind == "error"] == ["invalid_token"]
    with Session(engine) as db:
        carol = db.get(User, "carol")
        assert carol.deleted_at is not None and carol.name == "Deleted user" and carol.phone is None
    assert count(engine, SpaceMember, SpaceMember.username == "carol") == 0
