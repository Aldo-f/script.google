import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path))
    monkeypatch.setenv("USER_MASTER_KEY", "ab" * 32)
    monkeypatch.setenv("USER_KEY_SALT", "s")
    monkeypatch.setenv("SIGNING_SECRET", "test-signing-secret")
    monkeypatch.setenv("ADMIN_TOKEN", "admin-secret")
    monkeypatch.setenv("SMTP_HOST", "localhost")

    for mod in ("app.config", "app.crypto", "app.users", "app.storage", "app.emailer", "app.main"):
        importlib.reload(importlib.import_module(mod))

    from app.config import settings
    settings.ensure_dirs()
    from app.users import user_store
    user_store.load()

    from app.main import app
    return TestClient(app)


def _token(client, email):
    r = client.post("/admin/users", json={"user_id": email},
                    headers={"Authorization": "Bearer admin-secret"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _payload():
    return {
        "threadId": "t1",
        "messageId": "m1234567890",
        "subject": "Hallo",
        "from": "Alice <alice@example.com>",
        "date": "2026-01-02T10:00:00Z",
        "attachments": [{"filename": "a.txt", "mimeType": "text/plain",
                         "base64Data": "aGVsbG8="}],
    }


def test_admin_requires_token(client):
    assert client.post("/admin/users", json={"user_id": "x@y.z"}).status_code == 401
    assert client.post("/admin/users", json={"user_id": "x@y.z"},
                       headers={"Authorization": "Bearer wrong"}).status_code == 403


def test_admin_creates_user(client):
    token = _token(client, "alice@example.com")
    assert len(token) > 20


def test_webhook_requires_bearer(client):
    assert client.post("/webhook/gmail-attachments", json=_payload()).status_code == 401


def test_webhook_stores_and_returns_signed_url(client):
    token = _token(client, "alice@example.com")
    r = client.post("/webhook/gmail-attachments", json=_payload(),
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["attachmentCount"] == 1
    assert "/download/" in body["downloadUrl"]


def test_cross_tenant_isolation(client):
    ta = _token(client, "alice@example.com")
    tb = _token(client, "bob@example.com")
    r = client.post("/webhook/gmail-attachments", json=_payload(),
                    headers={"Authorization": f"Bearer {ta}"})
    url = r.json()["downloadUrl"]

    # Bob's token cannot list Alice's items over the API
    rb = client.get("/api/downloads", headers={"Authorization": f"Bearer {tb}"})
    assert rb.status_code == 200
    assert rb.json() == []

    # Bob's token cannot fetch Alice's item even if he guesses the id
    ra = client.get("/api/downloads", headers={"Authorization": f"Bearer {ta}"})
    assert len(ra.json()) == 1
    dl_id = ra.json()[0]["download_id"]
    rb2 = client.get(f"/api/downloads/{dl_id}", headers={"Authorization": f"Bearer {tb}"})
    assert rb2.status_code == 404


def test_signed_download_works_and_rejects_bad_sig(client):
    token = _token(client, "alice@example.com")
    url = client.post("/webhook/gmail-attachments", json=_payload(),
                      headers={"Authorization": f"Bearer {token}"}).json()["downloadUrl"]
    path = url.split("http://testserver", 1)[-1] if url.startswith("http") else url
    path = path.replace("http://localhost:8000", "")
    r = client.get(path)
    assert r.status_code == 200
    assert r.content[:2] == b"PK"
    assert client.get(path.split("?")[0] + "?sig=deadbeef").status_code == 403


def test_bad_token_rejected(client):
    assert client.post("/webhook/gmail-attachments", json=_payload(),
                       headers={"Authorization": "Bearer nope"}).status_code == 401
