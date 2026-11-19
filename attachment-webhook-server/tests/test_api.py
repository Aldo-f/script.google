import importlib
from datetime import datetime
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path))
    monkeypatch.setenv("USER_MASTER_KEY", "ab" * 32)
    monkeypatch.setenv("USER_KEY_SALT", "s")
    monkeypatch.setenv("SIGNING_SECRET", "test-signing-secret")
    monkeypatch.setenv("ADMIN_TOKEN", "admin-secret")
    monkeypatch.setenv("PUBLIC_BASE_URL", "http://localhost:8000")
    monkeypatch.setenv("DOWNLOAD_TTL_HOURS", "168")
    monkeypatch.setenv("SECURE_COOKIES", "false")  # TestClient uses http://testserver
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


def _url_path(url: str) -> str:
    return url.replace("http://localhost:8000", "")


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
    assert "exp=" in body["downloadUrl"] and "sig=" in body["downloadUrl"]


def test_cross_tenant_isolation(client):
    ta = _token(client, "alice@example.com")
    tb = _token(client, "bob@example.com")
    r = client.post("/webhook/gmail-attachments", json=_payload(),
                    headers={"Authorization": f"Bearer {ta}"})
    url = r.json()["downloadUrl"]
    dl_id = r.json()["downloadId"]

    # Bob's token cannot list Alice's items over the API.
    rb = client.get("/api/downloads", headers={"Authorization": f"Bearer {tb}"})
    assert rb.status_code == 200
    assert rb.json() == []

    # Bob's token cannot fetch Alice's item even if he guesses the id.
    ra = client.get("/api/downloads", headers={"Authorization": f"Bearer {ta}"})
    assert len(ra.json()) == 1
    rb2 = client.get(f"/api/downloads/{quote(dl_id, safe='')}",
                     headers={"Authorization": f"Bearer {tb}"})
    assert rb2.status_code == 404

    # Bob cannot delete or revoke Alice's item either.
    assert client.delete(f"/api/downloads/{quote(dl_id, safe='')}",
                         headers={"Authorization": f"Bearer {tb}"}).status_code == 404
    assert client.post(f"/api/downloads/{quote(dl_id, safe='')}/revoke",
                       headers={"Authorization": f"Bearer {tb}"}).status_code == 404
    assert client.get(_url_path(url)).status_code == 200


def test_signed_download_works_and_rejects_bad_sig(client):
    token = _token(client, "alice@example.com")
    url = client.post("/webhook/gmail-attachments", json=_payload(),
                      headers={"Authorization": f"Bearer {token}"}).json()["downloadUrl"]
    path = _url_path(url)
    r = client.get(path)
    assert r.status_code == 200
    assert r.content[:2] == b"PK"
    assert client.get(path.split("?")[0] + "?exp=9999999999&sig=deadbeef").status_code == 403


def test_expired_signature_is_rejected(client):
    import app.main as main_mod
    from app.crypto import tenant_hash

    token = _token(client, "alice@example.com")
    result = client.post("/webhook/gmail-attachments", json=_payload(),
                         headers={"Authorization": f"Bearer {token}"}).json()
    tenant = tenant_hash("alice@example.com")
    dl_id = result["downloadId"]

    past = int(datetime.now().timestamp()) - 60
    sig = main_mod.sign_download(tenant, dl_id, past)
    url = f"/download/{tenant}/{quote(dl_id, safe='')}?exp={past}&sig={sig}"
    assert client.get(url).status_code == 403

    # Reusing the stale signature with a fresh exp must also fail.
    fresh = int(datetime.now().timestamp()) + 3600
    assert client.get(
        f"/download/{tenant}/{quote(dl_id, safe='')}?exp={fresh}&sig={sig}"
    ).status_code == 403


def test_revoked_link_is_denied_but_files_are_kept(client, tmp_path):
    from app.crypto import tenant_hash

    token = _token(client, "alice@example.com")
    result = client.post("/webhook/gmail-attachments", json=_payload(),
                         headers={"Authorization": f"Bearer {token}"}).json()
    path = _url_path(result["downloadUrl"])
    dl_id = result["downloadId"]

    assert client.get(path).status_code == 200
    rev = client.post(f"/api/downloads/{quote(dl_id, safe='')}/revoke",
                      headers={"Authorization": f"Bearer {token}"})
    assert rev.status_code == 200, rev.text
    assert rev.json() == {"revoked": dl_id}
    assert client.get(path).status_code == 403

    tenant = tenant_hash("alice@example.com")
    assert (tmp_path / "users" / tenant / dl_id).is_dir()


def test_owner_can_revoke_via_session(client):
    token = _token(client, "alice@example.com")
    dl_id = client.post("/webhook/gmail-attachments", json=_payload(),
                        headers={"Authorization": f"Bearer {token}"}).json()["downloadId"]
    login = client.post("/login", data={"token": token})
    assert login.status_code == 200
    rev = client.post(f"/api/downloads/{quote(dl_id, safe='')}/revoke")
    assert rev.status_code == 200, rev.text


def test_owner_notification_recipient(client, monkeypatch):
    import app.main as main_mod

    sent = []
    monkeypatch.setattr(main_mod, "send_download_email", lambda *args, **kwargs: sent.append(args))
    token = _token(client, "registered-owner@example.com")
    payload = _payload()
    payload["from"] = "Spoof <attacker@evil.example>"
    r = client.post("/webhook/gmail-attachments", json=payload,
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    assert len(sent) == 1
    assert sent[0][0] == "registered-owner@example.com"
    assert sent[0][1] == payload["subject"]
    assert sent[0][3] == r.json()["zipSize"]
    assert sent[0][4] == r.json()["attachmentCount"]


def test_notify_email_override_and_owner_fallback(client, monkeypatch):
    import app.main as main_mod

    sent = []
    monkeypatch.setattr(main_mod, "send_download_email", lambda *args, **kwargs: sent.append(args))
    token = _token(client, "owner@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    explicit = _payload()
    explicit["notifyEmail"] = "notify@other.example"
    assert client.post("/webhook/gmail-attachments", json=explicit,
                       headers=headers).status_code == 200
    assert sent[-1][0] == "notify@other.example"

    fallback = _payload()
    fallback["messageId"] = "m0987654321"
    assert client.post("/webhook/gmail-attachments", json=fallback,
                       headers=headers).status_code == 200
    assert sent[-1][0] == "owner@example.com"


def test_revoked_user_cannot_use_token(client):
    import app.users as users_mod

    token = _token(client, "alice@example.com")
    users_mod.user_store.revoke_user("alice@example.com")
    r = client.post("/webhook/gmail-attachments", json=_payload(),
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


def test_bad_token_rejected(client):
    assert client.post("/webhook/gmail-attachments", json=_payload(),
                       headers={"Authorization": "Bearer nope"}).status_code == 401


def test_admin_revoke_user_blocks_all_access(client):
    token = _token(client, "alice@example.com")
    admin = {"Authorization": "Bearer admin-secret"}

    r = client.post("/admin/users/alice@example.com/revoke", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json() == {"revoked": "alice@example.com"}

    assert client.post("/webhook/gmail-attachments", json=_payload(),
                       headers={"Authorization": f"Bearer {token}"}).status_code == 401
    assert client.get("/api/downloads",
                      headers={"Authorization": f"Bearer {token}"}).status_code == 401
    assert client.post("/login", data={"token": token}).status_code == 403
    assert any(u["revoked"] for u in client.get("/admin/users", headers=admin).json())


def test_admin_rotate_token_invalidates_old_token(client):
    old = _token(client, "alice@example.com")
    admin = {"Authorization": "Bearer admin-secret"}

    r = client.post("/admin/users/alice@example.com/rotate-token", headers=admin)
    assert r.status_code == 200, r.text
    new = r.json()["token"]
    assert new and new != old

    assert client.post("/webhook/gmail-attachments", json=_payload(),
                       headers={"Authorization": f"Bearer {old}"}).status_code == 401
    assert client.post("/webhook/gmail-attachments", json=_payload(),
                       headers={"Authorization": f"Bearer {new}"}).status_code == 200


def test_admin_revoke_unknown_user_is_404(client):
    admin = {"Authorization": "Bearer admin-secret"}
    assert client.post("/admin/users/nobody@example.com/revoke",
                       headers=admin).status_code == 404
    assert client.post("/admin/users/nobody@example.com/rotate-token",
                       headers=admin).status_code == 404
