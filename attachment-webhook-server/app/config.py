"""Runtime configuration, read once from environment variables."""
import os
from pathlib import Path


class Settings:
    HOST = os.getenv("HOST", "0.0.0.0")
    PORT = int(os.getenv("PORT", "8000"))

    STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "/data/gmail-attachments")).resolve()
    PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")

    # Secrets — see Phase 10 for how they are generated.
    USER_MASTER_KEY = os.getenv("USER_MASTER_KEY", "")
    USER_KEY_SALT = os.getenv("USER_KEY_SALT", "gleaner-v1")
    SIGNING_SECRET = os.getenv("SIGNING_SECRET", "")
    ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")

    # SMTP
    SMTP_HOST = os.getenv("SMTP_HOST", "localhost")
    SMTP_PORT = int(os.getenv("SMTP_PORT", "25"))
    SMTP_USER = os.getenv("SMTP_USER") or None
    SMTP_PASSWORD = os.getenv("SMTP_PASSWORD") or None
    SMTP_TLS = os.getenv("SMTP_TLS", "false").lower() == "true"
    SMTP_FROM = os.getenv("SMTP_FROM", "noreply@example.com")
    SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Gleaner")

    RETENTION_DAYS = int(os.getenv("RETENTION_DAYS", "0"))
    UI_TITLE = "Gleaner — Gmail Attachments"

    @classmethod
    def ensure_dirs(cls) -> None:
        (cls.STORAGE_ROOT / "users").mkdir(parents=True, exist_ok=True)

    @classmethod
    def validate(cls) -> None:
        problems = []
        if not cls.USER_MASTER_KEY:
            problems.append("USER_MASTER_KEY is not set")
        if not cls.SIGNING_SECRET:
            problems.append("SIGNING_SECRET is not set")
        if problems:
            raise RuntimeError("Refusing to start: " + "; ".join(problems))
        cls.ensure_dirs()


settings = Settings()
