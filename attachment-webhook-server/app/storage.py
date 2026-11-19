"""Tenant-scoped, encrypted attachment storage."""
import base64
import io
import json
import os
import re
import shutil
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from pydantic import BaseModel, Field

from .config import settings
from .crypto import decrypt_bytes, encrypt_bytes, tenant_hash

_TENANT_RE = re.compile(r"^[0-9a-f]{32}$")
_DOWNLOAD_ID_RE = re.compile(r"^[A-Za-z0-9 _.-]+$")


class AttachmentIn(BaseModel):
    filename: str
    mimeType: str
    base64Data: str


class WebhookPayload(BaseModel):
    threadId: str
    messageId: str
    subject: str
    date: str
    attachments: list[AttachmentIn]
    from_: str = Field(alias="from")
    notifyEmail: str | None = None

    class Config:
        populate_by_name = True


@dataclass
class SavedDownload:
    download_id: str
    zip_size: int
    attachment_count: int


@dataclass
class DownloadItem:
    download_id: str
    subject: str
    sender: str
    date: str
    zip_size: int
    attachment_count: int
    created_at: str


def validate_tenant(tenant: str) -> str:
    """Tenant ids are exactly 32 lowercase hex characters (sha256 truncation)."""
    if not isinstance(tenant, str) or not _TENANT_RE.fullmatch(tenant):
        raise ValueError("invalid tenant identifier")
    return tenant


def validate_download_id(download_id: str) -> str:
    """Download ids are flat names: letters, digits, space, '_', '-' and '.'."""
    if not isinstance(download_id, str) or not download_id:
        raise ValueError("invalid download id")
    if ".." in download_id or download_id in {".", ".."}:
        raise ValueError("invalid download id")
    if not _DOWNLOAD_ID_RE.fullmatch(download_id):
        raise ValueError("invalid download id")
    if download_id.strip() != download_id or os.path.isabs(download_id):
        raise ValueError("invalid download id")
    return download_id


def _users_root() -> Path:
    return (settings.STORAGE_ROOT / "users").resolve()


def tenant_root(tenant: str) -> Path:
    """Resolve a tenant directory and ensure it stays under STORAGE_ROOT/users."""
    validate_tenant(tenant)
    base = _users_root()
    root = (base / tenant).resolve()
    if root == base or not root.is_relative_to(base):
        raise ValueError("tenant path escapes the storage root")
    return root


def _item_dir(tenant: str, download_id: str) -> Path:
    root = tenant_root(tenant)
    validate_download_id(download_id)
    item = (root / download_id).resolve()
    if item == root or not item.is_relative_to(root):
        raise ValueError("item path escapes the tenant directory")
    return item


def _atomic_write(path: Path, data: bytes) -> None:
    """Write a file atomically with owner-only permissions."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, 0o600)
        tmp.replace(path)
    finally:
        if tmp.exists():
            tmp.unlink()


def sanitize_filename(name: str) -> str:
    cleaned = "".join(
        c if c.isascii() and (c.isalnum() or c in "._- ") else "_" for c in name
    ).strip()
    return cleaned or "attachment"


def tenant_dir(user_id: str) -> Path:
    return tenant_root(tenant_hash(user_id))


def _folder_name(message_id: str, subject: str, date_str: str) -> str:
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        day = dt.strftime("%Y-%m-%d")
    except ValueError:
        day = datetime.now().strftime("%Y-%m-%d")
    safe = sanitize_filename(subject or "geen-onderwerp")[:100]
    safe_id = sanitize_filename(message_id)[:8] or "msg"
    return f"{day} - {safe} - {safe_id}"


def save_email(user_id: str, payload: WebhookPayload) -> SavedDownload:
    base = tenant_dir(user_id)
    base.mkdir(parents=True, exist_ok=True, mode=0o700)
    folder = _folder_name(payload.messageId, payload.subject, payload.date)

    download_id, counter = folder, 1
    while (base / download_id).exists():
        download_id = f"{folder}_{counter}"
        counter += 1
    validate_download_id(download_id)
    email_dir = base / download_id
    email_dir.mkdir(parents=True, mode=0o700)
    os.chmod(email_dir, 0o700)

    buf = io.BytesIO()
    names: list[dict] = []
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        used: set[str] = set()
        for att in payload.attachments:
            name = sanitize_filename(att.filename)
            stem, ext = os.path.splitext(name)
            final, i = name, 1
            while final in used:
                final = f"{stem}_{i}{ext}"
                i += 1
            used.add(final)
            data = base64.b64decode(att.base64Data)
            zf.writestr(final, data)
            names.append({"filename": final, "size": len(data)})

    zip_bytes = buf.getvalue()
    zip_path = email_dir / f"{download_id}-attachments.zip.enc"
    _atomic_write(zip_path, encrypt_bytes(zip_bytes, user_id))

    meta = {
        "threadId": payload.threadId,
        "messageId": payload.messageId,
        "subject": payload.subject,
        "sender": payload.from_,
        "date": payload.date,
        "attachmentCount": len(names),
        "zipSize": len(zip_bytes),
        "createdAt": datetime.now().isoformat(),
        "attachments": names,
    }
    meta_path = email_dir / "meta.json.enc"
    _atomic_write(meta_path, encrypt_bytes(json.dumps(meta).encode(), user_id))

    return SavedDownload(download_id, len(zip_bytes), len(names))


def _read_meta(email_dir: Path, user_id: str) -> dict:
    return json.loads(decrypt_bytes((email_dir / "meta.json.enc").read_bytes(), user_id))


def read_zip(user_id: str, download_id: str) -> bytes:
    from .crypto import decrypt_bytes_for_hash

    tenant = tenant_hash(user_id)
    zip_path = _item_dir(tenant, download_id) / f"{download_id}-attachments.zip.enc"
    if not zip_path.exists():
        raise FileNotFoundError(download_id)
    return decrypt_bytes_for_hash(zip_path.read_bytes(), tenant)


def read_zip_by_hash(tenant: str, download_id: str) -> bytes:
    """Used by the anonymised download route (no user_id available)."""
    from .crypto import decrypt_bytes_for_hash

    zip_path = _item_dir(tenant, download_id) / f"{download_id}-attachments.zip.enc"
    if not zip_path.exists():
        raise FileNotFoundError(download_id)
    return decrypt_bytes_for_hash(zip_path.read_bytes(), tenant)


def list_items(user_id: str) -> list[DownloadItem]:
    base = tenant_dir(user_id)
    if not base.is_dir():
        return []
    out: list[DownloadItem] = []
    for email_dir in sorted(base.iterdir(), reverse=True):
        if not email_dir.is_dir() or not (email_dir / "meta.json.enc").exists():
            continue
        try:
            validate_download_id(email_dir.name)
            meta = _read_meta(email_dir, user_id)
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        out.append(
            DownloadItem(
                download_id=email_dir.name,
                subject=meta.get("subject", ""),
                sender=meta.get("sender", ""),
                date=meta.get("date", ""),
                zip_size=meta.get("zipSize", 0),
                attachment_count=meta.get("attachmentCount", 0),
                created_at=meta.get("createdAt", ""),
            )
        )
    return out


def delete_item(user_id: str, download_id: str) -> None:
    email_dir = _item_dir(tenant_hash(user_id), download_id)
    if not email_dir.exists():
        raise FileNotFoundError(download_id)
    shutil.rmtree(email_dir)


def _created_at(meta: dict) -> datetime:
    """Parse metadata createdAt into a naive local datetime for comparisons."""
    value = str(meta.get("createdAt", "")).replace("Z", "+00:00")
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone().replace(tzinfo=None)
    return parsed


def purge_expired(max_age_days: int | None = None) -> list[str]:
    """Delete item directories older than the retention window.

    Returns the relative names of removed items. A value of 0 disables purging;
    the current settings value is used when no argument is supplied. Metadata
    is encrypted, so the owning user is resolved from the tenant directory.
    """
    days = settings.RETENTION_DAYS if max_age_days is None else int(max_age_days)
    if days <= 0:
        return []

    from .users import user_store

    base = _users_root()
    if not base.is_dir():
        return []
    cutoff = datetime.now() - timedelta(days=days)
    removed: list[str] = []
    for tenant_path in sorted(base.iterdir()):
        if not tenant_path.is_dir():
            continue
        try:
            tenant = validate_tenant(tenant_path.name)
        except ValueError:
            continue
        user_id = user_store.user_id_for_tenant(tenant)
        if not user_id:
            # Without the owner we cannot decrypt metadata; leave it untouched.
            continue
        for item in sorted(tenant_path.iterdir()):
            if not item.is_dir() or not (item / "meta.json.enc").exists():
                continue
            try:
                created = _created_at(_read_meta(item, user_id))
            except (ValueError, TypeError, KeyError, UnicodeDecodeError, json.JSONDecodeError):
                continue
            if created > cutoff:
                continue
            shutil.rmtree(item)
            removed.append(f"{tenant}/{item.name}")
    return removed
