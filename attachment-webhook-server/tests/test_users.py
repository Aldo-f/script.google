import importlib
import json

import pytest


@pytest.fixture
def store(monkeypatch, tmp_path):
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path))
    monkeypatch.setenv("USER_MASTER_KEY", "ab" * 32)
    monkeypatch.setenv("USER_KEY_SALT", "s")
    monkeypatch.setenv("SIGNING_SECRET", "test-signing-secret")
    monkeypatch.setenv("ADMIN_TOKEN", "admin-secret")
    monkeypatch.setenv("PUBLIC_BASE_URL", "http://localhost:8000")
    monkeypatch.setenv("SMTP_HOST", "localhost")
    import app.config as cfg
    importlib.reload(cfg)
    cfg.settings.ensure_dirs()
    import app.users as users_mod
    importlib.reload(users_mod)
    return users_mod.UserStore()


def test_add_user_returns_token_and_persists_hash_only(store, tmp_path):
    token = store.add_user("alice@example.com")
    assert len(token) >= 32
    on_disk = json.loads((tmp_path / "users.json").read_text())
    assert on_disk["users"][0]["user_id"] == "alice@example.com"
    assert "token" not in on_disk["users"][0]
    assert on_disk["users"][0]["token_sha256"]
    assert on_disk["users"][0]["revoked"] is False
    assert on_disk["users"][0]["revoked_downloads"] == []


def test_token_resolves_to_user(store):
    token = store.add_user("bob@example.com")
    assert store.user_id_for_token(token) == "bob@example.com"
    assert store.user_id_for_token("nope") is None


def test_reload_from_disk(store, tmp_path):
    token = store.add_user("carol@example.com")
    import app.users as users_mod
    fresh = users_mod.UserStore()
    fresh.load()
    assert fresh.user_id_for_token(token) == "carol@example.com"


def test_duplicate_user_rejected(store):
    store.add_user("dave@example.com")
    with pytest.raises(ValueError):
        store.add_user("dave@example.com")


def test_revoked_user_cannot_authenticate(store):
    token = store.add_user("alice@example.com")
    assert store.user_id_for_token(token) == "alice@example.com"
    store.revoke_user("alice@example.com")
    assert store.user_id_for_token(token) is None
    assert store.is_user_revoked("alice@example.com")
    on_disk = json.loads(store.path.read_text())
    assert on_disk["users"][0]["revoked"] is True
    assert on_disk["users"][0]["token_sha256"]  # still hashed, never plaintext


def test_rotate_token_invalidates_old_token(store):
    old_token = store.add_user("bob@example.com")
    new_token = store.rotate_token("bob@example.com")
    assert new_token != old_token
    assert store.user_id_for_token(old_token) is None
    assert store.user_id_for_token(new_token) == "bob@example.com"
    import app.users as users_mod
    fresh = users_mod.UserStore()
    fresh.load()
    assert fresh.user_id_for_token(old_token) is None
    assert fresh.user_id_for_token(new_token) == "bob@example.com"
    with pytest.raises(ValueError):
        store.rotate_token("unknown@example.com")


def test_revoked_downloads_are_tracked_by_tenant(store):
    from app.crypto import tenant_hash

    store.add_user("carol@example.com")
    tenant = tenant_hash("carol@example.com")
    assert store.user_id_for_tenant(tenant) == "carol@example.com"
    assert store.user_id_for_tenant("0" * 32) is None
    assert not store.is_download_revoked(tenant, "dl-1")

    store.revoke_download("carol@example.com", "dl-1")
    assert store.is_download_revoked(tenant, "dl-1")
    assert not store.is_download_revoked("0" * 32, "dl-1")
    assert not store.is_download_revoked(tenant, "dl-2")

    import app.users as users_mod
    fresh = users_mod.UserStore()
    fresh.load()
    assert fresh.is_download_revoked(tenant, "dl-1")
