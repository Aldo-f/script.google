import importlib

import pytest


@pytest.fixture
def crypto(monkeypatch, tmp_path):
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path))
    monkeypatch.setenv("USER_MASTER_KEY", "ab" * 32)
    monkeypatch.setenv("USER_KEY_SALT", "test-salt")
    monkeypatch.setenv("SIGNING_SECRET", "test-signing-secret")
    monkeypatch.setenv("ADMIN_TOKEN", "admin-secret")
    monkeypatch.setenv("PUBLIC_BASE_URL", "http://localhost:8000")
    monkeypatch.setenv("SMTP_HOST", "localhost")
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
    assert enc.startswith(b"GLEANER-v1:")
    assert crypto.decrypt_bytes(enc, "alice@example.com") == data
    tenant = crypto.tenant_hash("alice@example.com")
    assert crypto.decrypt_bytes_for_hash(enc, tenant) == data


def test_cross_user_decrypt_fails(crypto):
    enc = crypto.encrypt_bytes(b"secret", "alice@example.com")
    with pytest.raises(ValueError):
        crypto.decrypt_bytes(enc, "bob@example.com")


def test_missing_master_key_raises(monkeypatch, tmp_path):
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path))
    monkeypatch.setenv("USER_MASTER_KEY", "")
    monkeypatch.setenv("SIGNING_SECRET", "test-signing-secret")
    monkeypatch.setenv("ADMIN_TOKEN", "admin-secret")
    monkeypatch.setenv("PUBLIC_BASE_URL", "http://localhost:8000")
    import app.config as cfg
    importlib.reload(cfg)
    import app.crypto as crypto_mod
    importlib.reload(crypto_mod)
    with pytest.raises(RuntimeError):
        crypto_mod.master_key_bytes()


def test_fixed_v1_prefix_and_malformed_ciphertext(crypto):
    enc = crypto.encrypt_bytes(b"payload", "alice@example.com")
    token = crypto.parse_envelope(enc)
    assert token == enc[len(b"GLEANER-v1:"):]
    with pytest.raises(ValueError):
        crypto.decrypt_bytes(b"GLEANER-v99:not-a-fernet-token", "alice@example.com")
    with pytest.raises(ValueError):
        crypto.parse_envelope(b"GLEANER-v99:token")
    with pytest.raises(ValueError):
        crypto.decrypt_bytes(token, "alice@example.com")
    with pytest.raises(ValueError):
        crypto.parse_envelope(b"GLEANER-v1")
    with pytest.raises(ValueError):
        crypto.parse_envelope(b"GLEANER-vX:token")
