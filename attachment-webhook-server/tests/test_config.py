import importlib
import os


def test_settings_reads_env(monkeypatch, tmp_path):
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path))
    monkeypatch.setenv("USER_MASTER_KEY", "00" * 32)
    monkeypatch.setenv("SIGNING_SECRET", "s3cr3t")
    import app.config as cfg
    importlib.reload(cfg)
    assert cfg.settings.STORAGE_ROOT == tmp_path.resolve()
    assert cfg.settings.SIGNING_SECRET == "s3cr3t"
    cfg.settings.ensure_dirs()
    assert (tmp_path / "users").is_dir()
