import importlib
import json

import pytest


@pytest.fixture
def storage(monkeypatch, tmp_path):
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path))
    monkeypatch.setenv("USER_MASTER_KEY", "ab" * 32)
    monkeypatch.setenv("USER_KEY_SALT", "s")
    monkeypatch.setenv("SIGNING_SECRET", "x")
    import app.config as cfg
    importlib.reload(cfg)
    import app.crypto as crypto_mod
    importlib.reload(crypto_mod)
    import app.storage as storage_mod
    importlib.reload(storage_mod)
    cfg.settings.ensure_dirs()
    return storage_mod


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
    assert b"PK" not in raw[:4]  # not a plain zip header


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
