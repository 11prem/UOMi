"""Rate limits (Phase 2: tasks 2.1, 2.2 and 2.5) and the client address they are keyed on.

The limiter lives in memory: it is exact inside one API process, it forgets everything on a restart,
and with several processes each one counts alone. That is enough for a demo or a single instance.
Before running more than one worker, move the counters to a shared store (a PostgreSQL table or
Redis). `SlidingWindowLimiter.hit` is the only function that would change.

Every limit comes from `app/config.py`, so a limit is a one-line edit in `.env`.
"""

import math
import threading
import time
from collections import deque
from collections.abc import Callable

from fastapi import Request

from app.config import settings
from app.utils.errors import api_error

MINUTE = 60
HOUR = 3600

Seconds = int | Callable[[], int]


class SlidingWindowLimiter:
    """Allows `limit` hits per key in any window of `window_seconds`.

    A blocked hit is not recorded, so hammering a blocked key never pushes its release further away.
    """

    def __init__(self, max_keys: int = 50_000, clock: Callable[[], float] = time.monotonic) -> None:
        self.clock = clock  # tests replace this to move time forward
        self._max_keys = max_keys
        self._buckets: dict[str, tuple[deque[float], float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_seconds: float) -> int:
        """Count one attempt. Returns 0 when it is allowed, otherwise the whole seconds to wait."""
        limit = max(1, limit)
        now = self.clock()
        with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None:
                if len(self._buckets) >= self._max_keys:
                    self._make_room(now)
                hits: deque[float] = deque()
            else:
                hits = bucket[0]
            self._buckets[key] = (hits, window_seconds)

            cutoff = now - window_seconds
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if len(hits) >= limit:
                return max(1, math.ceil(hits[0] + window_seconds - now))
            hits.append(now)
            return 0

    def _make_room(self, now: float) -> None:
        """Called with the lock held when the table is full: drop finished windows, then the stalest keys."""
        finished = [key for key, (hits, window) in self._buckets.items() if not hits or hits[-1] <= now - window]
        for key in finished:
            del self._buckets[key]
        if len(self._buckets) >= self._max_keys:
            stalest = sorted(self._buckets, key=lambda key: self._buckets[key][0][-1])
            for key in stalest[: max(1, self._max_keys // 10)]:
                del self._buckets[key]

    def reset(self) -> None:
        with self._lock:
            self._buckets.clear()


limiter = SlidingWindowLimiter()


def enforce(
    key: str,
    limit: int,
    window_seconds: float,
    *,
    code: str = "too_many_requests",
    message: str = "Too many requests. Please try again later.",
) -> None:
    """Count one attempt for `key` and answer 429 (with Retry-After) when the limit is used up."""
    retry_after = limiter.hit(key, limit, window_seconds)
    if retry_after:
        raise api_error(
            429, code, message, headers={"Retry-After": str(retry_after)}, retry_after_seconds=retry_after
        )


# ---------------------------------------------------------------------------
# The client address
# ---------------------------------------------------------------------------


def client_ip(request: Request) -> str:
    """The address a request came from.

    Without a proxy this is the socket peer. Behind a load balancer the peer is the balancer, so set
    TRUSTED_PROXY_COUNT to how many proxies sit in front of the API: each one appends the address it
    saw to X-Forwarded-For, so the real client is that many entries from the right. Anything further
    left was written by the client and is ignored, so the header cannot be used to dodge a limit.
    """
    peer = request.client.host if request.client else "unknown"
    hops = settings.TRUSTED_PROXY_COUNT
    if hops <= 0:
        return peer
    forwarded = [part.strip() for part in request.headers.get("x-forwarded-for", "").split(",") if part.strip()]
    return forwarded[-hops] if len(forwarded) >= hops else peer


# ---------------------------------------------------------------------------
# Ready-made FastAPI dependencies, one per limited endpoint
# ---------------------------------------------------------------------------


def _value(number: Seconds) -> int:
    return number() if callable(number) else number


def limit_by_ip(
    name: str,
    limit: Seconds,
    window_seconds: Seconds,
    *,
    code: str = "too_many_requests",
    message: str = "Too many requests. Please try again later.",
) -> Callable[[Request], None]:
    """A dependency that counts every call from one address. Settings are read per request.

    The returned function is marked, so that tests/test_integration_guards.py can tell which routes are
    rate limited: a new public route without one of these fails that test until it gets a limit.
    """

    def dependency(request: Request) -> None:
        enforce(f"{name}:ip:{client_ip(request)}", _value(limit), _value(window_seconds), code=code, message=message)

    dependency.is_rate_limit = True  # type: ignore[attr-defined]
    return dependency


def is_rate_limit_dependency(call: object) -> bool:
    return getattr(call, "is_rate_limit", False) is True


register_limit = limit_by_ip("register", lambda: settings.REGISTER_MAX_PER_IP_PER_HOUR, HOUR)
login_limit = limit_by_ip(
    "login",
    lambda: settings.LOGIN_MAX_PER_IP,
    lambda: settings.LOGIN_LOCKOUT_MINUTES * MINUTE,
    code="too_many_attempts",
    message="Too many sign-in attempts from this network. Please try again later.",
)
forgot_limit = limit_by_ip("forgot", lambda: settings.FORGOT_MAX_PER_IP_PER_HOUR, HOUR)
verify_otp_limit = limit_by_ip("verify-otp", lambda: settings.VERIFY_OTP_MAX_PER_IP_PER_HOUR, HOUR)
search_ip_limit = limit_by_ip("search", lambda: settings.SEARCH_MAX_PER_IP_PER_MINUTE, MINUTE)
