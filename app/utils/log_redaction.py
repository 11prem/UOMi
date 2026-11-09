"""Keep what people type into search out of the access log (Phase 2, task 2.8).

`GET /users/search?q=9876543210` would otherwise write a full phone number into every access-log line.
The values of these query parameters are replaced with `[redacted]` before the line is written.
"""

import logging
import re

REDACTED = "[redacted]"

# Query parameters whose values never reach the log. When you add an endpoint that takes something private in
# its query string (an email, a phone number, a token), add the parameter's name here.
SENSITIVE_QUERY_PARAMS = (
    "q",
    "phone",
    "email",
    "code",
    "otp",
    "password",
    "secret",
    "token",
    "access_token",
    "refresh_token",
    "reset_token",
)

_SENSITIVE_PARAM = re.compile(
    r"([?&](?:" + "|".join(re.escape(name) for name in SENSITIVE_QUERY_PARAMS) + r")=)[^&\s\"]*", re.IGNORECASE
)


def redact(text: str) -> str:
    return _SENSITIVE_PARAM.sub(lambda match: match.group(1) + REDACTED, text)


class RedactQueryFilter(logging.Filter):
    """uvicorn writes the access line as ``'%s - "%s %s HTTP/%s" %d'`` with the path (and query) as an argument."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(redact(arg) if isinstance(arg, str) else arg for arg in record.args)
        elif isinstance(record.args, dict):  # gunicorn logs its access line with named atoms such as %(r)s
            record.args = {key: redact(value) if isinstance(value, str) else value for key, value in record.args.items()}
        return True


# uvicorn writes the access line itself; under gunicorn (with uvicorn workers) gunicorn writes it.
ACCESS_LOGGERS = ("uvicorn.access", "gunicorn.access")


def install_access_log_redaction() -> None:
    """Add the filter to the access loggers, once each however often this is called."""
    for name in ACCESS_LOGGERS:
        access_logger = logging.getLogger(name)
        if not any(isinstance(existing, RedactQueryFilter) for existing in access_logger.filters):
            access_logger.addFilter(RedactQueryFilter())
