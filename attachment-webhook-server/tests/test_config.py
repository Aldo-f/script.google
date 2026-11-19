import importlib

import pytest


def _set_required_env(monkeypatch, tmp_path, **overrides):
    values = {
        "STORAGE_ROOT": str(tmp_path),
        "USER_MASTER_KEY": "00" * 32,
        "USER_KEY_SALT": "test-salt",
        "SIGNING_SECRET": "test-signing-secret",
        "ADMIN_TOKEN": "admin-secret",
        "PUBLIC_BASE_URL": "http://localhost:8000",
        "SMTP_HOST": "localhost",
    }
    values.update(overrides)
    for key, value in values.items():
        monkeypatch.setenv(key, value)


def _reload():
    import app.config as cfg
    importlib.reload(cfg)
    return cfg


def test_settings_reads_env(monkeypatch, tmp_path):
    _set_required_env(monkeypatch, tmp_path)
    cfg = _reload()
    assert cfg.settings.STORAGE_ROOT == tmp_path.resolve()
    assert cfg.settings.SIGNING_SECRET == "test-signing-secret"
    cfg.settings.ensure_dirs()
    assert (tmp_path / "users").is_dir()


def test_settings_defaults(monkeypatch, tmp_path):
    _set_required_env(monkeypatch, tmp_path)
    monkeypatch.delenv("DOWNLOAD_TTL_HOURS", raising=False)
    monkeypatch.delenv("SECURE_COOKIES", raising=False)
    cfg = _reload()
    assert cfg.settings.DOWNLOAD_TTL_HOURS == 168
    assert cfg.settings.SECURE_COOKIES is True
    assert cfg.settings.USER_KEY_SALT == "test-salt"


def test_validate_requires_admin_token(monkeypatch, tmp_path):
    _set_required_env(monkeypatch, tmp_path, ADMIN_TOKEN="")
    cfg = _reload()
    with pytest.raises(RuntimeError, match="ADMIN_TOKEN"):
        cfg.settings.validate()


@pytest.mark.parametrize("placeholder", ["change-me", "changeme", "change-me-in-production"])
def test_validate_rejects_placeholder_admin_token(monkeypatch, tmp_path, placeholder):
    _set_required_env(monkeypatch, tmp_path, ADMIN_TOKEN=placeholder)
    cfg = _reload()
    with pytest.raises(RuntimeError, match="ADMIN_TOKEN"):
        cfg.settings.validate()


def test_validate_accepts_complete_config(monkeypatch, tmp_path):
    _set_required_env(monkeypatch, tmp_path)
    cfg = _reload()
    cfg.settings.validate()
    assert (tmp_path / "users").is_dir()
