import importlib
import pytest

@pytest.fixture
def crypto(monkeypatch):
    monkeypatch.setenv("USER_MASTER_KEY", "ab" * 32)
    monkeypatch.setenv("USER_KEY_SALT", "test-salt")
    import app.config as cfg
    importlib.reload(cfg)
    import app.crypto as crypto_mod
    importlib.reload(crypto_mod)
    return crypto_mod


def test_tenant_hash_is_stable_and_email_free(crypto):
    h = crypto.tenant_hash("alice@example.com")
    assert h == crypto.tenant_hash("alice@example.com")
    assert len(h) == 32
    assert "alice" not in h


def test_roundtrip(crypto):
    data = b"hello attachment payload"
    enc = crypto.encrypt_bytes(data, "alice@example.com")
    assert enc != data
    assert crypto.decrypt_bytes(enc, "alice@example.com") == data


def test_cross_user_decrypt_fails(crypto):
    enc = crypto.encrypt_bytes(b"secret", "alice@example.com")
    with pytest.raises(ValueError):
        crypto.decrypt_bytes(enc, "bob@example.com")


def test_missing_master_key_raises(monkeypatch):
    monkeypatch.setenv("USER_MASTER_KEY", "")
    import app.config as cfg
    importlib.reload(cfg)
    import app.crypto as crypto_mod
    importlib.reload(crypto_mod)
    with pytest.raises(RuntimeError):
        crypto_mod.master_key_bytes()
