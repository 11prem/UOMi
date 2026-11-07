"""The currencies a space can use (ISO 4217 codes). A space picks one when it is created."""

import re

SUPPORTED_CURRENCIES: tuple[str, ...] = ("INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD")

# The app's CURRENCY_INFO symbols (mobile/src/domain/money.ts).
SYMBOLS: dict[str, str] = {
    "INR": "₹", "USD": "$", "EUR": "€", "GBP": "£", "AED": "AED", "SGD": "S$", "AUD": "A$", "CAD": "C$",
}


def format_money(minor: int, currency: str) -> str:
    """The app's `formatMoney(minor, currency, {compact: true})`: `₹1,23,456.50`, `₹400`, `AED 1,500`.

    The magnitude only. Decimals show unless the amount is whole; INR groups the Indian way."""
    whole, cents = divmod(abs(minor), 100)
    digits = str(whole)
    if currency == "INR" and len(digits) > 3:
        digits = re.sub(r"\B(?=(\d{2})+$)", ",", digits[:-3]) + "," + digits[-3:]
    else:
        digits = f"{whole:,}"
    symbol = SYMBOLS.get(currency, currency)  # a code the app doesn't know shows as "JPY 12.34", like the app
    return f"{symbol}{' ' if len(symbol) > 1 else ''}{digits}{f'.{cents:02d}' if cents else ''}"
