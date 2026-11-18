"""Tenant-scoped, encrypted attachment storage."""
import base64
import hashlib
import io
import json
import os
import zipfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from pydantic import BaseModel, Field

from .config import settings
from .crypto import decrypt_bytes, encrypt_bytes, tenant_hash


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


def sanitize_filename(name: str) -> str:
    cleaned = "".join(c if c.isalnum() or c in "._- " else "_" for c in name).strip()
    return cleaned or "attachment"


def tenant_dir(user_id: str) -> Path:
    return settings.STORAGE_ROOT / "users" / tenant_hash(user_id)


def _folder_name(message_id: str, subject: str, date_str: str) -> str:
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        day = dt.strftime("%Y-%m-%d")
    except ValueError:
        day = datetime.now().strftime("%Y-%m-%d")
    safe = sanitize_filename(subject or "geen-onderwerp")[:100]
    return f"{day} - {safe} - {message_id[:8]}"


def save_email(user_id: str, payload: WebhookPayload) -> SavedDownload:
    base = tenant_dir(user_id)
    base.mkdir(parents=True, exist_ok=True)
    folder = _folder_name(payload.messageId, payload.subject, payload.date)

    download_id, counter = folder, 1
    while (base / download_id).exists():
        download_id = f"{folder}_{counter}"
        counter += 1
    email_dir = base / download_id
    email_dir.mkdir(parents=True, mode=0o700)

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
    zip_path.write_bytes(encrypt_bytes(zip_bytes, user_id))
    os.chmod(zip_path, 0o600)

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
    meta_path.write_bytes(encrypt_bytes(json.dumps(meta).encode(), user_id))
    os.chmod(meta_path, 0o600)

    return SavedDownload(download_id, len(zip_bytes), len(names))


def _read_meta(email_dir: Path, user_id: str) -> dict:
    return json.loads(decrypt_bytes((email_dir / "meta.json.enc").read_bytes(), user_id))


def read_zip(user_id: str, download_id: str) -> bytes:
    email_dir = tenant_dir(user_id) / download_id
    zip_path = email_dir / f"{download_id}-attachments.zip.enc"
    if not zip_path.exists():
        raise FileNotFoundError(download_id)
    return decrypt_bytes(zip_path.read_bytes(), user_id)


def read_zip_by_hash(tenant: str, download_id: str) -> bytes:
    """Used by the anonymised download route (no user_id available)."""
    from .crypto import decrypt_bytes_for_hash

    email_dir = settings.STORAGE_ROOT / "users" / tenant / download_id
    zip_path = email_dir / f"{download_id}-attachments.zip.enc"
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
            meta = _read_meta(email_dir, user_id)
        except ValueError:
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
    import shutil

    email_dir = tenant_dir(user_id) / download_id
    if not email_dir.exists():
        raise FileNotFoundError(download_id)
    shutil.rmtree(email_dir)
