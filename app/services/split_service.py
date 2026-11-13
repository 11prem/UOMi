"""Split an expense between people: the same answers as the app's `computeSplit` (mobile/src/domain/split.ts).

One difference, on purpose: everyone in the split must owe at least one minor unit, so the server refuses a split
that leaves someone with 0 (an exact or percent split with a 0 for someone, or a total too small to share). The app's
computeSplit allows that, so its Save button would be enabled and the server would then refuse. A decision for the
team: relax this rule here, or make the app refuse too.

Money is integer minor units, so the shares always add up to the total. Leftover units go one at a time to the
people in the split, in the order given (the caller passes them in member-list order), never to someone whose
weight is 0. All the maths is integer maths: no floating point, so nothing drifts at a unit boundary.
"""

from decimal import Decimal

from app.currencies import format_money
from app.models.expense import SplitType

PERCENT_TOTAL = 10_000  # percentages are held in hundredths: 33.33% is 3333


def _distribute(total: int, weights: list[int], denominator: int) -> list[int]:
    amounts = [total * weight // denominator for weight in weights]
    left = total - sum(amounts)
    index = 0
    while left > 0:
        if weights[index] > 0:
            amounts[index] += 1
            left -= 1
        index = (index + 1) % len(amounts)
    return amounts


def _hundredths(typed: Decimal | None) -> int:
    """A typed value has at most 2 decimals (the schema checks), so this is exact."""
    return int((typed or Decimal(0)) * 100)


def split(total: int, split_type: SplitType, typed: list[Decimal | None], currency: str) -> list[int]:
    """What each person owes, in the order of `typed` (what each of them typed: nothing for an equal split).

    Raises ValueError with a message for people when the split cannot be saved: amounts that do not add up,
    percentages that are not 100, a fractional or zero share count, or someone who would owe nothing.
    """
    count = len(typed)

    if split_type == SplitType.EQUAL:
        amounts = _distribute(total, [1] * count, count)

    elif split_type == SplitType.EXACT:
        amounts = [_hundredths(value) for value in typed]
        left = total - sum(amounts)
        if left > 0:
            raise ValueError(f"{format_money(left, currency)} left to assign")
        if left < 0:
            raise ValueError(f"{format_money(-left, currency)} over the total")

    elif split_type == SplitType.PERCENT:
        weights = [_hundredths(value) for value in typed]
        left = PERCENT_TOTAL - sum(weights)
        if left != 0:
            raise ValueError(f"The percentages must add up to 100 ({abs(left) / 100:g}% {'left' if left > 0 else 'over'})")
        amounts = _distribute(total, weights, PERCENT_TOTAL)

    else:  # SplitType.SHARES: nothing typed means 1 share
        counts = [Decimal(1) if value is None else value for value in typed]
        if any(value != value.to_integral_value() for value in counts):
            raise ValueError("Shares must be whole numbers")
        weights = [int(value) for value in counts]
        if any(weight < 1 for weight in weights):
            raise ValueError("Everyone in the split needs at least 1 share")
        amounts = _distribute(total, weights, sum(weights))

    if any(amount <= 0 for amount in amounts):
        raise ValueError("Everyone in the split must owe something: this amount is too small to share this way")
    return amounts
