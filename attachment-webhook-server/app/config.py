"""Runtime configuration, read once from environment variables."""
import base64
import os
from pathlib import Path
from urllib.parse import urlparse


def _env_bool(name: str, default: bool = True) -> bool:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _looks_like_placeholder(value: str) -> bool:
    normalized = value.strip().lower().replace("_", "-").replace(" ", "-")
    if not normalized:
        return True
    markers = (
        "change-me", "changeme", "replace-me", "replaceme",
        "your-token", "your-secret", "your-key", "fixme", "todo", "dummy",
    )
    return any(marker in normalized for marker in markers)


def _decoded_key_length(raw: str) -> int:
    """Best-effort key length check; 0 means the value cannot be decoded at all."""
    raw = raw.strip()
    if not raw:
        return 0
    try:
        return len(bytes.fromhex(raw))
    except ValueError:
        try:
            return len(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
        except Exception:
            return 0


class Settings:
    HOST = os.getenv("HOST", "0.0.0.0")
    PORT = int(os.getenv("PORT", "8000"))

    STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "/data/gmail-attachments")).resolve()
    PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")

    # Secrets — never commit real values; supplied through the environment.
    USER_MASTER_KEY = os.getenv("USER_MASTER_KEY", "")
    USER_KEY_SALT = os.getenv("USER_KEY_SALT", "gleaner-v1")
    SIGNING_SECRET = os.getenv("SIGNING_SECRET", "")
    ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")

    # Signed download links live for 7 days by default; 0 means never expire.
    DOWNLOAD_TTL_HOURS = int(os.getenv("DOWNLOAD_TTL_HOURS", "168"))
    SECURE_COOKIES = _env_bool("SECURE_COOKIES", True)

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
        problems: list[str] = []

        def check_secret(name: str, value: str, min_len: int) -> None:
            if not value or not value.strip():
                problems.append(f"{name} is not set")
            elif _looks_like_placeholder(value):
                problems.append(f"{name} is a placeholder")
            elif len(value.strip()) < min_len:
                problems.append(f"{name} is too short (minimum {min_len} characters)")

        check_secret("USER_MASTER_KEY", cls.USER_MASTER_KEY, 16)
        check_secret("SIGNING_SECRET", cls.SIGNING_SECRET, 8)
        check_secret("ADMIN_TOKEN", cls.ADMIN_TOKEN, 8)

        if cls.USER_MASTER_KEY and not _looks_like_placeholder(cls.USER_MASTER_KEY):
            if _decoded_key_length(cls.USER_MASTER_KEY) < 16:
                problems.append("USER_MASTER_KEY must decode to at least 16 bytes")

        url = (cls.PUBLIC_BASE_URL or "").strip()
        if not url:
            problems.append("PUBLIC_BASE_URL is not set")
        elif _looks_like_placeholder(url):
            problems.append("PUBLIC_BASE_URL is a placeholder")
        else:
            parsed = urlparse(url)
            if parsed.scheme not in ("http", "https") or not parsed.netloc:
                problems.append("PUBLIC_BASE_URL must be an absolute http(s) URL")

        if cls.DOWNLOAD_TTL_HOURS < 0:
            problems.append("DOWNLOAD_TTL_HOURS must be 0 or greater")
        if cls.RETENTION_DAYS < 0:
            problems.append("RETENTION_DAYS must be 0 or greater")

        if problems:
            raise RuntimeError("Refusing to start: " + "; ".join(problems))
        cls.ensure_dirs()


settings = Settings()
