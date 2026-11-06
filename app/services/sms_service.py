"""Sending text messages. Only the "console" backend exists: it writes the message to the server log.

That is enough for development: run the forgot-password flow and read the code from the server
output. To send real texts later, add a branch for your provider in `send_sms` and set SMS_BACKEND.
"""

import logging

from app.config import settings

logger = logging.getLogger("uomi.sms")


def send_sms(phone: str, message: str) -> None:
    if settings.SMS_BACKEND == "console":
        # WARNING level so it shows up in the default server output. Development only: this puts
        # the one-time code in the log.
        logger.warning("[SMS to %s] %s", phone, message)
        return
    raise RuntimeError(f"Unknown SMS_BACKEND: {settings.SMS_BACKEND!r}")
