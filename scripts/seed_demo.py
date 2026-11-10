"""Demo data for the phone app: the people, spaces, expenses, payments and cards of prototype/js/data.js seed().

    python scripts/seed_demo.py            create the demo data (refuses if kabir.r already exists)
    python scripts/seed_demo.py --reset    delete the demo users' rows, then create the demo data again

Run it from the repo root after `alembic upgrade head`. Every demo user's password is `demo1234`.
Development only: the password is public. Expenses are written straight to the tables because the
API has no expense endpoints yet.
"""

import argparse
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # so `python scripts/seed_demo.py` finds `app`

from sqlalchemy import delete, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import SessionLocal, utcnow  # noqa: E402
from app.models import (  # noqa: E402
    Expense,
    ExpenseShare,
    LoginAttempt,
    Notification,
    NotificationType,
    PasswordReset,
    RefreshToken,
    Settlement,
    SettlementStatus,
    ShareStatus,
    Space,
    SpaceMember,
    SplitType,
    User,
)
from app.services.notification_service import create_notification  # noqa: E402
from app.utils.security import hash_password  # noqa: E402

PASSWORD = "demo1234"

USERS = [  # (username, name, phone): the prototype's u_kabir, u_swetha, u_arun, u_meera, u_rohan, u_priya
    ("kabir.r", "Kabir Rao", "+919845012331"),
    ("swetha.i", "Swetha Iyer", "+919880213344"),
    ("arun.n", "Arun Nair", "+919446078812"),
    ("meera.s", "Meera Shah", "+971501234567"),
    ("rohan.d", "Rohan Das", "+919830045566"),
    ("priya.m", "Priya Menon", "+919567001122"),
]

# (key, name, icon, currency, owner, members in list order, created N days ago)
SPACES = [
    ("flat", "Flat 4B", "home", "INR", "kabir.r", ["kabir.r", "swetha.i", "rohan.d"], 60),
    ("goa", "Goa Trip", "trip", "INR", "arun.n", ["kabir.r", "arun.n", "swetha.i", "priya.m"], 30),
    ("office", "Office lunches", "food", "INR", "priya.m", ["kabir.r", "priya.m", "rohan.d"], 90),
    ("dubai", "Dubai stopover", "trip", "USD", "kabir.r", ["kabir.r", "meera.s"], 12),
    ("cricket", "Sunday cricket", "friends", "INR", "arun.n", ["kabir.r", "arun.n", "rohan.d"], 45),
]

# (key, space, description, amount_minor, paid_by, split_type, created_by, N days ago,
#  shares: [(username, amount_minor, status, typed input)]). Exact inputs are major units, as typed.
EXPENSES = [
    ("groc", "flat", "Groceries — DMart", 234000, "rohan.d", "equal", "rohan.d", 6,
     [("kabir.r", 78000, "accepted", None), ("swetha.i", 78000, "accepted", None), ("rohan.d", 78000, "accepted", None)]),
    ("wifi", "flat", "Wi-Fi bill", 118000, "kabir.r", "equal", "kabir.r", 4,
     [("kabir.r", 39334, "accepted", None), ("swetha.i", 39333, "accepted", None), ("rohan.d", 39333, "accepted", None)]),
    ("toit", "flat", "Dinner at Toit", 144000, "swetha.i", "equal", "swetha.i", 0.1,
     [("kabir.r", 48000, "pending", None), ("swetha.i", 48000, "accepted", None), ("rohan.d", 48000, "accepted", None)]),
    ("villa", "goa", "Villa booking, Anjuna", 1840000, "kabir.r", "shares", "kabir.r", 21,
     [("kabir.r", 368000, "accepted", "1"), ("arun.n", 736000, "accepted", "2"),
      ("swetha.i", 368000, "accepted", "1"), ("priya.m", 368000, "accepted", "1")]),
    ("scoot", "goa", "Scooter rentals", 360000, "arun.n", "equal", "arun.n", 19,
     [("kabir.r", 90000, "accepted", None), ("arun.n", 90000, "accepted", None),
      ("swetha.i", 90000, "accepted", None), ("priya.m", 90000, "accepted", None)]),
    ("shack", "goa", "Beach shack lunch", 268000, "swetha.i", "exact", "swetha.i", 18,
     [("kabir.r", 70000, "accepted", "700"), ("arun.n", 82000, "accepted", "820"),
      ("swetha.i", 56000, "accepted", "560"), ("priya.m", 60000, "rejected", "600")]),
    ("lunch", "office", "Team lunch — Meghana Foods", 180000, "priya.m", "equal", "priya.m", 11,
     [("kabir.r", 60000, "accepted", None), ("priya.m", 60000, "accepted", None), ("rohan.d", 60000, "accepted", None)]),
    ("taxi", "dubai", "Airport taxi", 7000, "kabir.r", "percent", "kabir.r", 3,
     [("kabir.r", 3500, "accepted", "50"), ("meera.s", 3500, "accepted", "50")]),
    ("ground", "cricket", "Ground booking", 80000, "arun.n", "equal", "arun.n", 8,
     [("kabir.r", 40000, "accepted", None), ("arun.n", 40000, "accepted", None)]),
    ("ball", "cricket", "New ball and tape", 80000, "kabir.r", "equal", "kabir.r", 7,
     [("kabir.r", 40000, "accepted", None), ("rohan.d", 40000, "accepted", None)]),
]

# (key, space, payer, payee, amount_minor, status, created N days ago, answered N days ago or None)
SETTLEMENTS = [
    ("sw", "goa", "swetha.i", "kabir.r", 368000, "confirmed", 14, 13),
    ("pr", "goa", "priya.m", "kabir.r", 200000, "pending", 0.2, None),
    ("k1", "office", "kabir.r", "priya.m", 60000, "confirmed", 10, 9),
    ("r1", "office", "rohan.d", "priya.m", 60000, "confirmed", 10, 10),
]


class AlreadySeeded(Exception):
    """kabir.r already exists, so the demo data is probably there already."""


def seed(db: Session) -> None:
    """Insert the demo data and commit. Raises AlreadySeeded if kabir.r exists (use reset() first)."""
    if db.get(User, "kabir.r") is not None:
        raise AlreadySeeded("kabir.r already exists. Run with --reset to delete the demo users and create them again.")

    now = utcnow()

    def ago(days: float):
        return now - timedelta(days=days)

    password_hash = hash_password(PASSWORD)
    for username, name, phone in USERS:
        db.add(
            User(
                username=username,
                name=name,
                phone=phone,
                password_hash=password_hash,
                currency="AED" if phone.startswith("+971") else "INR",  # the phone's country
            )
        )
    db.flush()

    spaces: dict[str, Space] = {}
    for key, name, icon, currency, owner, members, days in SPACES:
        spaces[key] = Space(name=name, icon=icon, currency=currency, created_by=owner, created_at=ago(days))
        db.add(spaces[key])
        db.flush()
        for position, username in enumerate(members, start=1):
            db.add(SpaceMember(space_id=spaces[key].id, username=username, position=position, joined_at=ago(days)))

    expenses: dict[str, Expense] = {}
    for key, space, description, amount, paid_by, split, created_by, days, shares in EXPENSES:
        expenses[key] = Expense(
            space_id=spaces[space].id,
            paid_by=paid_by,
            created_by=created_by,
            description=description,
            amount_minor=amount,
            split_type=SplitType(split),
            date=ago(days).date(),
            created_at=ago(days),
            updated_at=ago(days),
        )
        db.add(expenses[key])
        db.flush()
        for username, share_amount, status, typed in shares:
            db.add(
                ExpenseShare(
                    expense_id=expenses[key].id,
                    username=username,
                    amount_minor=share_amount,
                    status=ShareStatus(status),
                    input=typed,
                )
            )

    settlements: dict[str, Settlement] = {}
    for key, space, payer, payee, amount, status, days, answered_days in SETTLEMENTS:
        settlements[key] = Settlement(
            space_id=spaces[space].id,
            payer=payer,
            payee=payee,
            amount_minor=amount,
            status=SettlementStatus(status),
            created_at=ago(days),
            answered_at=None if answered_days is None else ago(answered_days),
        )
        db.add(settlements[key])
    db.flush()

    # Oldest first, so the ids (which the API sorts by, newest first) run in the order the prototype lists them.
    # The message is the prototype's notifText title and sub joined into one sentence.
    cards = [  # (N days ago, user, type, space, ref id, needs_answer, read, message)
        (30, "kabir.r", "space_added", "goa", None, False, True,
         "Arun added you to ‘Goa Trip’. 4 people"),
        (17, "swetha.i", "share_rejected", "goa", expenses["shack"].id, False, False,
         "Priya rejected their ₹600 share. ‘Beach shack lunch’ · Goa Trip"),
        (12, "meera.s", "space_added", "dubai", None, False, False,
         "Kabir added you to ‘Dubai stopover’. 2 people"),
        (9, "kabir.r", "payment_answered", "office", settlements["k1"].id, False, True,
         "Priya confirmed your ₹600 payment. Office lunches"),
        (1, "kabir.r", "reminder", "cricket", None, False, False,
         "You owe Arun ₹400. Sunday cricket · tap to settle up"),
        (0.2, "kabir.r", "payment_to_confirm", "goa", settlements["pr"].id, True, False,
         "Priya says they paid you. ₹2,000 · Goa Trip"),
        (0.1, "kabir.r", "expense_share", "flat", expenses["toit"].id, True, False,
         "Swetha added ‘Dinner at Toit’. Your share is ₹480 · Flat 4B"),
    ]
    for days, username, kind, space, ref_id, needs_answer, read, message in cards:
        card = create_notification(
            db,
            username=username,
            type=NotificationType(kind),
            message=message,
            space_id=spaces[space].id,
            space_name=spaces[space].name,
            ref_id=ref_id,
            needs_answer=needs_answer,
        )
        card.read = read
        card.created_at = ago(days)

    db.commit()


class RealPeopleInDemoSpaces(Exception):
    """A space a demo user made has someone who is not a demo user in it. --reset would delete their data."""


def reset(db: Session) -> None:
    """Delete the rows that belong to the demo usernames, and nothing else. Does not commit.

    It refuses (RealPeopleInDemoSpaces) when a space made by a demo user has anyone else in it: deleting that space would
    delete their expenses and payments too.

    shortcut: a bill or payment by a demo user inside someone else's space is not removed, so deleting the user
    fails and nothing changes. The API cannot create those yet; handle them here when it can.
    """
    names = [username for username, _, _ in USERS]
    shared = db.scalars(
        select(Space.name)
        .join(SpaceMember, SpaceMember.space_id == Space.id)
        .where(Space.created_by.in_(names), SpaceMember.username.not_in(names))
        .distinct()
    ).all()
    if shared:
        raise RealPeopleInDemoSpaces(
            "Not reset: these spaces were made by a demo user but other people are in them, and would lose their data: "
            + ", ".join(sorted(shared))
        )
    spaces = select(Space.id).where(Space.created_by.in_(names))
    bills = select(Expense.id).where(Expense.space_id.in_(spaces))
    for statement in (
        delete(ExpenseShare).where(ExpenseShare.expense_id.in_(bills)),
        delete(Expense).where(Expense.space_id.in_(spaces)),
        delete(Settlement).where(Settlement.space_id.in_(spaces)),
        delete(SpaceMember).where(SpaceMember.space_id.in_(spaces)),
        delete(Space).where(Space.created_by.in_(names)),
        # the demo users' own rows in other people's spaces
        delete(ExpenseShare).where(ExpenseShare.username.in_(names)),
        delete(SpaceMember).where(SpaceMember.username.in_(names)),
        delete(Notification).where(Notification.username.in_(names)),
        delete(RefreshToken).where(RefreshToken.username.in_(names)),
        delete(PasswordReset).where(PasswordReset.username.in_(names)),
        delete(LoginAttempt).where(LoginAttempt.username.in_(names)),
        delete(User).where(User.username.in_(names)),
    ):
        db.execute(statement)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create the demo users, spaces and balances for the phone app.")
    parser.add_argument("--reset", action="store_true", help="delete the demo users' rows first, then create them again")
    args = parser.parse_args(argv)

    if settings.ENVIRONMENT == "production":  # the demo passwords are public: never create these users on a real database
        print("Refusing to seed: ENVIRONMENT is production. The demo users have public passwords.", file=sys.stderr)
        return 2

    with SessionLocal() as db:
        try:
            if args.reset:
                reset(db)  # seed() commits, so the delete and the re-create are one transaction
            seed(db)
        except AlreadySeeded as error:
            print(error, file=sys.stderr)
            return 1
        except RealPeopleInDemoSpaces as error:
            db.rollback()
            print(error, file=sys.stderr)
            return 3
    print(f"Seeded {len(USERS)} users, {len(SPACES)} spaces, {len(EXPENSES)} expenses. Sign in as kabir.r / {PASSWORD}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
