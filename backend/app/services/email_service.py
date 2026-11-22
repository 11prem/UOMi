"""Sending email (the one-time codes). Two backends, chosen by EMAIL_BACKEND:

  console  writes the message to the server log. Development only: it puts the one-time code in the log, so
           `ENVIRONMENT=production` refuses to start with it.
  smtp     sends through the SMTP server in SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD (standard library only).
"""

import logging
import smtplib
import ssl
from email.message import EmailMessage

from app.config import settings

logger = logging.getLogger("uomi.email")

SMTP_TIMEOUT_SECONDS = 15


def send_email(to: str, subject: str, body: str) -> None:
    if settings.EMAIL_BACKEND == "console":
        # WARNING level so it shows up in the default server output. Development only: this puts
        # the one-time code in the log.
        logger.warning("[Email to %s] %s: %s", to, subject, body)
        return
    if settings.EMAIL_BACKEND == "smtp":
        _send_smtp(to, subject, body)
        return
    raise RuntimeError(f"Unknown EMAIL_BACKEND: {settings.EMAIL_BACKEND!r}")


def _send_smtp(to: str, subject: str, body: str) -> None:
    """A failure is logged and never raised (the reply has already gone out). The message is never logged."""
    message = EmailMessage()
    message["From"] = settings.SMTP_FROM
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=SMTP_TIMEOUT_SECONDS) as server:
            if settings.SMTP_STARTTLS:
                server.starttls(context=ssl.create_default_context())
            if settings.SMTP_USER:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.send_message(message)
    except Exception:
        logger.exception("Could not send an email through SMTP")  # the traceback never holds the body, only the error
