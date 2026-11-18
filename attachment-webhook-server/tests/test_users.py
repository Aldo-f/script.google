import importlib
import json

import pytest


@pytest.fixture
def store(monkeypatch, tmp_path):
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path))
    monkeypatch.setenv("USER_MASTER_KEY", "ab" * 32)
    monkeypatch.setenv("SIGNING_SECRET", "x")
    import app.config as cfg
    importlib.reload(cfg)
    import app.users as users_mod
    importlib.reload(users_mod)
    cfg.settings.ensure_dirs()
    return users_mod.UserStore()


def test_add_user_returns_token_and_persists_hash_only(store, tmp_path):
    token = store.add_user("alice@example.com")
    assert len(token) >= 32
    on_disk = json.loads((tmp_path / "users.json").read_text())
    assert on_disk["users"][0]["user_id"] == "alice@example.com"
    assert "token" not in on_disk["users"][0]
    assert on_disk["users"][0]["token_sha256"]


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
