"""Sending email: the console backend, the SMTP backend (with a fake server) and what a failure does."""

import logging

import pytest

from app.config import settings
from app.services import email_service, otp_service

CODE = "482913"
REAL_SEND_EMAIL = email_service.send_email  # imported before conftest swaps it for the outbox


class FakeSMTP:
    """Stands in for smtplib.SMTP: remembers what it was asked to do. `fail_on` names a step that raises."""

    instances: list["FakeSMTP"] = []
    fail_on: str | None = None

    def __init__(self, host, port, timeout=None):
        self.host, self.port, self.timeout = host, port, timeout
        self.steps: list[str] = []
        self.message = None
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def _step(self, name):
        self.steps.append(name)
        if FakeSMTP.fail_on == name:
            raise OSError(f"{name} failed")

    def starttls(self, context=None):
        self._step("starttls")

    def login(self, user, password):
        self._step("login")
        self.credentials = (user, password)

    def send_message(self, message):
        self._step("send")
        self.message = message


@pytest.fixture(autouse=True)
def real_send_email(monkeypatch):
    monkeypatch.setattr("app.services.email_service.send_email", REAL_SEND_EMAIL)


@pytest.fixture
def smtp(monkeypatch):
    FakeSMTP.instances, FakeSMTP.fail_on = [], None
    monkeypatch.setattr("app.services.email_service.smtplib.SMTP", FakeSMTP)
    for name, value in dict(
        EMAIL_BACKEND="smtp", SMTP_HOST="smtp.uomi.test", SMTP_PORT=587, SMTP_USER="mailer", SMTP_PASSWORD="s3cret",
        SMTP_FROM="UOMi <no-reply@uomi.test>", SMTP_STARTTLS=True,
    ).items():
        monkeypatch.setattr(settings, name, value)
    return FakeSMTP


def test_the_console_backend_writes_the_message_to_the_log(monkeypatch, caplog):
    monkeypatch.setattr(settings, "EMAIL_BACKEND", "console")
    with caplog.at_level(logging.WARNING, logger="uomi.email"):
        email_service.send_email("alice@example.com", "Your UOMi code", f"Your UOMi code is {CODE}.")
    assert "alice@example.com" in caplog.text and CODE in caplog.text


def test_an_unknown_backend_is_an_error(monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_BACKEND", "carrier-pigeon")
    with pytest.raises(RuntimeError, match="carrier-pigeon"):
        email_service.send_email("alice@example.com", "s", "b")


def test_smtp_sends_one_message_with_starttls_and_login(smtp):
    email_service.send_email("alice@example.com", "Your UOMi code", f"Your UOMi code is {CODE}.")

    [server] = smtp.instances
    assert (server.host, server.port) == ("smtp.uomi.test", 587)
    assert server.steps == ["starttls", "login", "send"]  # encrypted before the password is sent
    assert server.credentials == ("mailer", "s3cret")
    assert (server.message["To"], server.message["From"], server.message["Subject"]) == (
        "alice@example.com", "UOMi <no-reply@uomi.test>", "Your UOMi code",
    )
    assert CODE in server.message.get_content()


def test_smtp_without_starttls_or_a_user_skips_those_steps(smtp, monkeypatch):
    monkeypatch.setattr(settings, "SMTP_STARTTLS", False)
    monkeypatch.setattr(settings, "SMTP_USER", "")
    email_service.send_email("alice@example.com", "s", "b")
    assert smtp.instances[0].steps == ["send"]


@pytest.mark.parametrize("step", ["starttls", "login", "send"])
def test_an_smtp_failure_is_logged_and_never_raised_and_the_code_is_not_in_the_log(smtp, caplog, step):
    smtp.fail_on = step
    with caplog.at_level(logging.INFO):
        otp_service.send_code_email("alice@example.com", CODE)  # does not raise
        email_service.send_email("alice@example.com", "Your UOMi code", f"Your UOMi code is {CODE}.")  # nor this
    assert "Could not send an email through SMTP" in caplog.text
    assert CODE not in caplog.text and "s3cret" not in caplog.text


def test_a_successful_smtp_send_never_puts_the_code_in_the_log(smtp, caplog):
    with caplog.at_level(logging.DEBUG):
        otp_service.send_code_email("alice@example.com", CODE)
    assert smtp.instances[0].message is not None
    assert CODE not in caplog.text


def test_the_code_email_has_the_subject_and_wording_of_the_old_text(smtp):
    otp_service.send_code_email("alice@example.com", CODE)
    message = smtp.instances[0].message
    assert message["Subject"] == "Your UOMi code"
    assert message.get_content().strip() == (
        f"Your UOMi code is {CODE}. It expires in {settings.OTP_TTL_MINUTES} minutes. Do not share it with anyone."
    )
