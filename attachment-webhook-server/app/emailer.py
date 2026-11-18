"""Transaction email via SMTP (optional, best-effort)."""
import logging
import os
import smtplib
from email.mime.text import MIMEText

from pydantic import EmailStr

log = logging.getLogger("gleaner.emailer")


def send_email(
    to: str,
    subject: str,
    body: str,
    *,
    host: str | None = None,
    port: int | None = None,
    user: str | None = None,
    password: str | None = None,
    sender: str | None = None,
    timeout: int = 10,
) -> bool:
    """Send one email. Returns True on success, False if SMTP is unavailable."""
    host = host or os.getenv("SMTP_HOST")
    port = int(port or os.getenv("SMTP_PORT", "25"))
    if not host:
        log.warning("SMTP_HOST unset — dropping email to %s", to)
        return False
    sender = sender or os.getenv("SMTP_SENDER", "no-reply@example.local")
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to
    try:
        with smtplib.SMTP(host, port, timeout=timeout) as smtp:
            smtp.ehlo()
            if user and password:
                smtp.starttls()
                smtp.login(user, password)
            smtp.send_message(msg)
        log.info("Sent email to %s: %s", to, subject)
        return True
    except Exception as exc:  # network down, refused, auth fail — never crash the webhook
        log.warning("Failed to send email to %s: %s", to, exc)
        return False
