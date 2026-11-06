"""Small helpers shared by the tests."""

from decimal import Decimal

from app.database import SessionLocal, utcnow
from app.models.expense import Expense
from app.models.expense_split import ExpenseShare, ShareStatus
from app.models.payment import Settlement, SettlementStatus

PASSWORD = "password123"
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


def register(client, username: str, phone: str | None = None) -> dict:
    """Sign a user up through the API and return the token pair."""
    response = client.post(
        "/auth/register",
        json=register_payload(username=username, name=username.capitalize(), phone=phone or PHONES[username]),
    )
    assert response.status_code == 201, response.text
    return response.json()


def auth(tokens: dict) -> dict:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def error_code(response) -> str:
    return response.json()["detail"]["code"]


def create_space(client, tokens: dict, name: str = "Trip", usernames=(), icon: str = "trip") -> dict:
    response = client.post(
        "/spaces", json={"name": name, "icon": icon, "usernames": list(usernames)}, headers=auth(tokens)
    )
    assert response.status_code == 201, response.text
    return response.json()


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


def add_expense(space_id: int, paid_by: str, title: str, shares: dict[str, tuple[str, ShareStatus]]) -> int:
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
        )
        session.add(expense)
        session.flush()
        for username, (amount, status) in shares.items():
            session.add(
                ExpenseShare(expense_id=expense.id, username=username, amount_minor=minor(amount), status=status)
            )
        session.commit()
        return expense.id


def add_settlement(space_id: int, payer: str, payee: str, amount: str, status: SettlementStatus) -> None:
    with SessionLocal() as session:
        session.add(
            Settlement(space_id=space_id, payer=payer, payee=payee, amount_minor=minor(amount), status=status)
        )
        session.commit()
