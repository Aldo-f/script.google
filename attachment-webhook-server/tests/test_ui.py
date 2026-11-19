"""Tests for the responsive Material-style Gleaner web UI."""
import importlib
import re
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
    monkeypatch.setenv("SECURE_COOKIES", "false")
    monkeypatch.setenv("SMTP_HOST", "localhost")

    for mod in ("app.config", "app.crypto", "app.users", "app.storage",
                "app.emailer", "app.main"):
        importlib.reload(importlib.import_module(mod))

    from app.config import settings
    settings.ensure_dirs()
    from app.users import user_store
    user_store.load()

    from app.main import app
    return TestClient(app, follow_redirects=False)


def _csrf(html: str) -> str:
    match = re.search(r'name="csrf_token" value="([^"]+)"', html)
    assert match, html[:500]
    return match.group(1)


def _admin_token(client):
    r = client.post("/admin/users", json={"user_id": "alice@example.com"},
                    headers={"Authorization": "Bearer admin-secret"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _login(client, token):
    page = client.get("/login")
    assert page.status_code == 200
    r = client.post("/login", data={"token": token, "csrf_token": _csrf(page.text)})
    assert r.status_code == 303, r.text
    return r


def _admin_login(client):
    page = client.get("/admin")
    assert page.status_code == 200
    r = client.post("/admin/ui/login",
                    data={"token": "admin-secret", "csrf_token": _csrf(page.text)})
    assert r.status_code == 303, r.text
    return r


def _payload(subject="Hallo"):
    return {
        "threadId": "t1",
        "messageId": "m1234567890",
        "subject": subject,
        "from": "Alice <alice@example.com>",
        "date": "2026-01-02T10:00:00Z",
        "attachments": [{"filename": "a.txt", "mimeType": "text/plain",
                         "base64Data": "aGVsbG8="}],
    }


def _create_item(client, token, subject="Hallo"):
    r = client.post("/webhook/gmail-attachments", json=_payload(subject),
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    return r.json()


# ─── login ──────────────────────────────────────────────────────────────────

def test_login_page_renders(client):
    r = client.get("/login")
    assert r.status_code == 200
    assert "Gleaner" in r.text
    assert "Welcome back" in r.text
    assert 'name="token"' in r.text
    assert 'name="csrf_token"' in r.text
    assert "@material/web@2.5.0" not in r.text  # loaded via static/app.js


def test_dashboard_requires_login(client):
    r = client.get("/")
    assert r.status_code == 303
    assert r.headers["location"] == "/login"


def test_login_with_bad_token_shows_error(client):
    page = client.get("/login")
    r = client.post("/login", data={"token": "wrong", "csrf_token": _csrf(page.text)})
    assert r.status_code == 403
    assert "not valid" in r.text


def test_login_rejects_bad_csrf(client):
    token = _admin_token(client)
    client.get("/login")
    r = client.post("/login", data={"token": token, "csrf_token": "forged"})
    assert r.status_code == 403
    assert "session expired" in r.text.lower()


def test_login_sets_session_cookie_and_dashboard_opens(client):
    token = _admin_token(client)
    _login(client, token)
    r = client.get("/")
    assert r.status_code == 200
    assert "My archives" in r.text
    assert "alice@example.com" in r.text
    assert "gleaner_session" in client.cookies


def test_logout_requires_csrf_and_clears_session(client):
    token = _admin_token(client)
    _login(client, token)
    dash = client.get("/")
    assert client.post("/ui/logout", data={"csrf_token": "wrong"}).status_code == 403

    r = client.post("/ui/logout", data={"csrf_token": _csrf(dash.text)})
    assert r.status_code == 303
    assert client.get("/").headers["location"] == "/login"


# ─── dashboard ──────────────────────────────────────────────────────────────

def test_empty_state_is_friendly(client):
    token = _admin_token(client)
    _login(client, token)
    r = client.get("/")
    assert "Nothing archived yet" in r.text
    assert "AttachmentCleaner" in r.text


def test_dashboard_lists_item_with_actions(client):
    token = _admin_token(client)
    _create_item(client, token, "Quarterly report")
    _login(client, token)
    r = client.get("/")
    assert r.status_code == 200
    assert "Quarterly report" in r.text
    assert "Download" in r.text
    assert "Revoke link" in r.text
    assert "Delete" in r.text
    assert "data-confirm=" in r.text


def test_dashboard_escapes_subject(client):
    token = _admin_token(client)
    evil = '<script>alert("xss")</script>'
    _create_item(client, token, evil)
    _login(client, token)
    r = client.get("/")
    assert "<script>alert" not in r.text
    assert "&lt;script&gt;" in r.text


def test_ui_delete_requires_csrf(client):
    token = _admin_token(client)
    item = _create_item(client, token)
    _login(client, token)
    dash = client.get("/")
    dl_id = quote(item["downloadId"], safe="")

    assert client.post(f"/ui/downloads/{dl_id}/delete",
                       data={"csrf_token": "wrong"}).status_code == 403
    r = client.post(f"/ui/downloads/{dl_id}/delete",
                    data={"csrf_token": _csrf(dash.text)})
    assert r.status_code == 303
    assert "notice=deleted" in r.headers["location"]

    client.get("/")
    assert "Nothing archived yet" in client.get("/").text


def test_ui_revoke_keeps_archive_and_blocks_link(client):
    token = _admin_token(client)
    item = _create_item(client, token)
    _login(client, token)
    dash = client.get("/")
    dl_id = quote(item["downloadId"], safe="")
    url = item["downloadUrl"].replace("http://localhost:8000", "")

    assert client.get(url).status_code == 200
    r = client.post(f"/ui/downloads/{dl_id}/revoke",
                    data={"csrf_token": _csrf(dash.text)})
    assert r.status_code == 303
    assert "notice=link-revoked" in r.headers["location"]

    denied = client.get(url, headers={"accept": "text/html"})
    assert denied.status_code == 403
    assert "revoked" in denied.text.lower()
    assert "Quarterly" not in denied.text

    # The archive itself is still listed for the owner.
    assert item["downloadId"] in client.get("/api/downloads").json()[0]["download_id"]


# ─── static assets ──────────────────────────────────────────────────────────

def test_static_assets_are_served(client):
    css = client.get("/static/css/app.css")
    assert css.status_code == 200
    assert "--md-sys-color-primary" in css.text
    assert "@media (max-width: 680px)" in css.text

    js = client.get("/static/js/app.js")
    assert js.status_code == 200
    assert "@material/web@2.5.0" in js.text
    assert "data-confirm" in js.text


# ─── error pages ────────────────────────────────────────────────────────────

def test_friendly_html_for_expired_link(client):
    r = client.get("/download/notatenant/id?exp=1&sig=deadbeef",
                   headers={"accept": "text/html"})
    assert r.status_code == 403
    assert "Something went wrong" in r.text
    assert "expired-link" in r.text
    assert "Sign in" in r.text


def test_api_clients_still_get_json_errors(client):
    r = client.get("/download/notatenant/id?exp=1&sig=deadbeef")
    assert r.status_code == 403
    assert r.json()["detail"]


# ─── admin UI ───────────────────────────────────────────────────────────────

def test_admin_shows_login_when_not_authenticated(client):
    r = client.get("/admin")
    assert r.status_code == 200
    assert "Admin sign in" in r.text
    assert 'action="/admin/ui/login"' in r.text


def test_admin_login_rejects_bad_token_and_csrf(client):
    page = client.get("/admin")
    csrf = _csrf(page.text)
    assert client.post("/admin/ui/login",
                       data={"token": "wrong", "csrf_token": csrf}).status_code == 403
    assert client.post("/admin/ui/login",
                       data={"token": "admin-secret", "csrf_token": "forged"}).status_code == 403


def test_admin_ui_create_user_shows_token_once(client):
    _admin_login(client)
    page = client.get("/admin")
    r = client.post("/admin/ui/users",
                    data={"user_id": "bob@example.com", "csrf_token": _csrf(page.text)})
    assert r.status_code == 200
    assert "Token created" in r.text
    token = re.search(r'class="token-value">([^<]+)<', r.text)
    assert token and len(token.group(1)) > 20
    assert "bob@example.com" in r.text


def test_admin_ui_create_user_rejects_bad_csrf(client):
    _admin_login(client)
    r = client.post("/admin/ui/users",
                    data={"user_id": "bob@example.com", "csrf_token": "forged"})
    assert r.status_code == 403


def test_admin_ui_rotate_and_revoke(client):
    _admin_token(client)
    _admin_login(client)
    page = client.get("/admin")
    csrf = _csrf(page.text)

    rotated = client.post(
        "/admin/ui/users/alice@example.com/rotate-token",
        data={"csrf_token": csrf},
    )
    assert rotated.status_code == 200
    assert "copy it now" in rotated.text

    page = client.get("/admin")
    revoked = client.post(
        "/admin/ui/users/alice@example.com/revoke",
        data={"csrf_token": _csrf(page.text)},
    )
    assert revoked.status_code == 303
    assert "notice=user-revoked" in revoked.headers["location"]

    page = client.get("/admin")
    assert "Revoked" in page.text
    assert client.post("/webhook/gmail-attachments", json=_payload(),
                       headers={"Authorization": "Bearer anything"}).status_code == 401


def test_admin_ui_logout(client):
    _admin_login(client)
    page = client.get("/admin")
    r = client.post("/admin/ui/logout", data={"csrf_token": _csrf(page.text)})
    assert r.status_code == 303
    assert "Admin sign in" in client.get("/admin").text
