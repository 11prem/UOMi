"""Small helpers shared by the tests."""

import re
from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import delete, select

from app.database import SessionLocal, utcnow
from app.models.expense import Expense
from app.models.expense_split import ExpenseShare, ShareStatus
from app.models.group_member import SpaceMember
from app.models.notification import Notification
from app.models.user import User
from app.models.payment import Settlement, SettlementStatus
from app.utils.validators import normalize_phone

PASSWORD = "password123"
STAND_IN = "stand.in"  # see create_space
PHONES = {
    "alice": "9876543210",
    "bob": "9876543211",
    "bobby": "9876543212",
    "carol": "9876543213",
    "alex": "9876543214",
}


def register_payload(**overrides) -> dict:
    payload = {
        "username": "alice",
        "name": "Alice",
        "phone": PHONES["alice"],
        "password": PASSWORD,
        "confirm_password": PASSWORD,
    }
    payload.update(overrides)
    return payload


OUTBOX: list[tuple[str, str]] = []  # every text the app "sent" in this test: (E.164 phone, message). See conftest.py


def last_code(phone: str) -> str:
    """The code in the newest text sent to `phone` (typed any way: it is normalised like the API does)."""
    wanted = normalize_phone(phone)
    for sent_to, message in reversed(OUTBOX):
        if sent_to == wanted:
            return re.search(r"code is (\d+)", message).group(1)
    raise AssertionError(f"no text was sent to {wanted}")


def rewind(model, seconds: int) -> None:
    """Let `seconds` pass: every time stored for every request in `model`'s table becomes that much older.

    Moving one column (say only the lock) into the past gives a state that real time never produces, because the
    code, the lock and the sign-up all age together.
    """
    columns = ("created_at", "last_sent_at", "expires_at", "valid_until", "locked_until", "reset_expires_at", "verified_at", "used_at")
    with SessionLocal() as session:
        for row in session.scalars(select(model)):
            for column in columns:
                value = getattr(row, column, None)
                if value is not None:
                    setattr(row, column, value - timedelta(seconds=seconds))
        session.commit()


def wrong_code(real: str) -> str:
    """A 6-digit code that is not `real`."""
    return "000000" if real != "000000" else "111111"


def start_signup(client, username: str, phone: str | None = None, **overrides):
    """Create Account: the first step. Returns the response (202 with the pending id when it works)."""
    return client.post(
        "/auth/register",
        json=register_payload(
            username=username, name=username.capitalize(), phone=phone or PHONES[username], **overrides
        ),
    )


def register(client, username: str, phone: str | None = None) -> dict:
    """Sign a user up through the API, both steps (the texted code is read from OUTBOX), and return the token pair."""
    phone = phone or PHONES[username]
    started = start_signup(client, username, phone)
    assert started.status_code == 202, started.text
    response = client.post(
        "/auth/register/verify", json={"pending_id": started.json()["pending_id"], "code": last_code(phone)}
    )
    assert response.status_code == 201, response.text
    return response.json()


def start_reset(client, username: str):
    """Forgot Password, step a. Returns the response (202 with the reset id and masked phone)."""
    return client.post("/auth/forgot", json={"username": username})


def reset_token(client, username: str) -> str:
    """Run forgot password up to the reset token (the texted code is read from OUTBOX)."""
    started = start_reset(client, username)
    assert started.status_code == 202, started.text
    user_phone = [phone for name, phone in PHONES.items() if name == username][0]
    verified = client.post(
        "/auth/verify-otp", json={"reset_id": started.json()["reset_id"], "code": last_code(user_phone)}
    )
    assert verified.status_code == 200, verified.text
    return verified.json()["reset_token"]


def auth(tokens: dict) -> dict:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def error_code(response) -> str:
    return response.json()["detail"]["code"]


def create_space(
    client, tokens: dict, name: str = "Trip", usernames=(), icon: str = "trip", currency: str | None = None
) -> dict:
    """Create a space through the API. A new space needs one other person, so with none given a stand-in is added and then
    taken out again: that leaves the creator alone, as a space that has lost its people would be."""
    lone = not usernames
    payload = {"name": name, "icon": icon, "usernames": list(usernames) or [STAND_IN]}
    if currency is not None:
        payload["currency"] = currency
    if lone:
        with SessionLocal() as db:
            if db.get(User, STAND_IN) is None:
                db.add(User(username=STAND_IN, name="Stand In", phone="+919000000999", password_hash="x"))
                db.commit()
    response = client.post("/spaces", json=payload, headers=auth(tokens))
    assert response.status_code == 201, response.text
    if not lone:
        return response.json()
    space_id = response.json()["id"]
    with SessionLocal() as db:
        db.delete(db.get(SpaceMember, (space_id, STAND_IN)))
        db.execute(delete(Notification).where(Notification.username == STAND_IN))
        db.commit()
    return client.get(f"/spaces/{space_id}", headers=auth(tokens)).json()


def db_exec(statement) -> None:
    with SessionLocal() as session:
        session.execute(statement)
        session.commit()


def db_all(statement) -> list:
    with SessionLocal() as session:
        return list(session.scalars(statement).all())


def minor(amount: str) -> int:
    """The tests write amounts as decimal strings; the database holds minor units ('100.50' is 10050)."""
    return int(Decimal(amount) * 100)


def add_expense(
    space_id: int,
    paid_by: str,
    title: str,
    shares: dict[str, tuple[str, ShareStatus]],
    updated_at: datetime | None = None,
) -> int:
    """Insert a bill and its shares straight into the database. shares = {username: (amount, status)}."""
    with SessionLocal() as session:
        total = sum(minor(amount) for amount, _ in shares.values())
        expense = Expense(
            space_id=space_id,
            paid_by=paid_by,
            created_by=paid_by,
            description=title,
            amount_minor=total,
            date=utcnow().date(),
            updated_at=updated_at or utcnow(),
        )
        session.add(expense)
        session.flush()
        for username, (amount, status) in shares.items():
            session.add(
                ExpenseShare(expense_id=expense.id, username=username, amount_minor=minor(amount), status=status)
            )
        session.commit()
        return expense.id


def add_settlement(
    space_id: int,
    payer: str,
    payee: str,
    amount: str,
    status: SettlementStatus,
    answered_at: datetime | None = None,
) -> None:
    with SessionLocal() as session:
        session.add(
            Settlement(
                space_id=space_id,
                payer=payer,
                payee=payee,
                amount_minor=minor(amount),
                status=status,
                answered_at=answered_at,
            )
        )
        session.commit()
