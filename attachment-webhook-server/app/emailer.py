"""Notification email sending via SMTP."""
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from .config import settings


def send_download_email(to_email: str, subject: str, url: str, zip_size: int, count: int) -> bool:
    if not settings.SMTP_HOST or settings.SMTP_HOST == "localhost":
        print(f"[EMAIL-MOCK] to={to_email} url={url}")
        return True

    size_mb = zip_size / (1024 * 1024)
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Bijlagen beschikbaar: {subject}"
    msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM}>"
    msg["To"] = to_email

    text = (
        f"De bijlagen van uw e-mail \"{subject}\" zijn verplaatst naar het archief.\n\n"
        f"Aantal bijlagen: {count}\nTotale grootte: {size_mb:.2f} MB\n\n"
        f"Download (link verloopt niet):\n{url}\n"
    )
    html = (
        f"<p>De bijlagen van uw e-mail <strong>{subject}</strong> zijn verplaatst naar het archief.</p>"
        f"<ul><li>Aantal bijlagen: {count}</li><li>Totale grootte: {size_mb:.2f} MB</li></ul>"
        f"<p><a href=\"{url}\">Download de bijlagen</a> (link verloopt niet).</p>"
    )
    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as s:
            if settings.SMTP_TLS:
                s.starttls()
            if settings.SMTP_USER and settings.SMTP_PASSWORD:
                s.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            s.send_message(msg)
        return True
    except Exception as exc:  # pragma: no cover - network
        print(f"[EMAIL ERROR] {exc}")
        return False
