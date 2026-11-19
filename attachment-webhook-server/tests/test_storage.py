import importlib
import json

import pytest


@pytest.fixture
def storage(monkeypatch, tmp_path):
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path))
    monkeypatch.setenv("USER_MASTER_KEY", "ab" * 32)
    monkeypatch.setenv("USER_KEY_SALT", "s")
    monkeypatch.setenv("SIGNING_SECRET", "test-signing-secret")
    monkeypatch.setenv("ADMIN_TOKEN", "admin-secret")
    monkeypatch.setenv("PUBLIC_BASE_URL", "http://localhost:8000")
    monkeypatch.setenv("SMTP_HOST", "localhost")
    for mod in ("app.config", "app.crypto", "app.users", "app.storage"):
        importlib.reload(importlib.import_module(mod))
    cfg = importlib.import_module("app.config")
    cfg.settings.ensure_dirs()
    return importlib.import_module("app.storage")


def _payload(storage):
    return storage.WebhookPayload(
        threadId="t1",
        messageId="m1234567890",
        subject="Test Subject",
        date="2026-01-02T10:00:00Z",
        attachments=[
            storage.AttachmentIn(
                filename="report.pdf",
                mimeType="application/pdf",
                base64Data="aGVsbG8gd29ybGQ=",  # b"hello world"
            )
        ],
        **{"from": "Alice <alice@example.com>"},
    )


def test_save_is_encrypted_on_disk(storage, tmp_path):
    dl = storage.save_email("alice@example.com", _payload(storage))
    tdir = tmp_path / "users" / storage.tenant_hash("alice@example.com") / dl.download_id
    assert (tdir / f"{dl.download_id}-attachments.zip.enc").exists()
    assert (tdir / "meta.json.enc").exists()
    # no plaintext zip or meta anywhere
    assert not list(tdir.glob("*.zip"))
    assert not (tdir / "meta.json").exists()
    raw = (tdir / f"{dl.download_id}-attachments.zip.enc").read_bytes()
    assert raw.startswith(b"GLEANER-v1:")
    assert b"PK" not in raw[:4]  # not a plain zip header


def test_encrypted_files_have_owner_only_permissions(storage, tmp_path):
    dl = storage.save_email("alice@example.com", _payload(storage))
    tdir = tmp_path / "users" / storage.tenant_hash("alice@example.com") / dl.download_id
    for name in (f"{dl.download_id}-attachments.zip.enc", "meta.json.enc"):
        assert (tdir / name).stat().st_mode & 0o777 == 0o600


def test_read_roundtrip(storage):
    dl = storage.save_email("alice@example.com", _payload(storage))
    blob = storage.read_zip("alice@example.com", dl.download_id)
    assert blob[:2] == b"PK"
    import io, zipfile
    zf = zipfile.ZipFile(io.BytesIO(blob))
    assert zf.namelist() == ["report.pdf"]
    assert zf.read("report.pdf") == b"hello world"


def test_isolation_between_users(storage):
    dl = storage.save_email("alice@example.com", _payload(storage))
    assert storage.list_items("bob@example.com") == []
    assert storage.list_items("alice@example.com")[0].download_id == dl.download_id
    with pytest.raises(FileNotFoundError):
        storage.read_zip("bob@example.com", dl.download_id)


def test_list_items_returns_metadata(storage):
    storage.save_email("alice@example.com", _payload(storage))
    items = storage.list_items("alice@example.com")
    assert len(items) == 1
    assert items[0].subject == "Test Subject"
    assert items[0].sender == "Alice <alice@example.com>"
    assert items[0].attachment_count == 1


def test_path_traversal_and_unsafe_ids_rejected(storage):
    with pytest.raises(ValueError):
        storage.validate_tenant("../" + "a" * 32)
    with pytest.raises(ValueError):
        storage.validate_tenant("A" * 32)
    for bad in ("../evil", "/etc/passwd", "a/b", "a\\b", "..", "a..b", ""):
        with pytest.raises(ValueError):
            storage.validate_download_id(bad)
    with pytest.raises(ValueError):
        storage.read_zip_by_hash("a" * 32, "../outside")
    with pytest.raises(ValueError):
        storage.read_zip_by_hash("not-a-tenant", "item")


def test_purge_expired_uses_encrypted_metadata(storage, tmp_path):
    import app.crypto as crypto_mod
    import app.users as users_mod

    users_mod.user_store.add_user("alice@example.com")
    dl = storage.save_email("alice@example.com", _payload(storage))
    tenant = storage.tenant_hash("alice@example.com")
    item_dir = tmp_path / "users" / tenant / dl.download_id

    assert storage.purge_expired(0) == []
    assert item_dir.is_dir()

    meta_path = item_dir / "meta.json.enc"
    meta = json.loads(crypto_mod.decrypt_bytes(meta_path.read_bytes(), "alice@example.com"))
    meta["createdAt"] = "2000-01-01T00:00:00"
    storage._atomic_write(
        meta_path,
        crypto_mod.encrypt_bytes(json.dumps(meta).encode(), "alice@example.com"),
    )

    removed = storage.purge_expired(1)
    assert removed == [f"{tenant}/{dl.download_id}"]
    assert not item_dir.exists()
