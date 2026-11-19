"""Persistent user/token registry stored in STORAGE_ROOT/users.json.

Only SHA-256 hashes of bearer tokens are persisted. User records also carry a
revocation flag and the list of capability links that their owner has revoked.
"""
import hashlib
import json
import os
import secrets
import threading
import time
from pathlib import Path

from .config import settings
from .crypto import tenant_hash


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class UserStore:
    def __init__(self, path: Path | None = None):
        self.path = path or (settings.STORAGE_ROOT / "users.json")
        self._lock = threading.Lock()
        self._users: list[dict] = []
        self._tokens: dict[str, str] = {}

    def load(self) -> None:
        with self._lock:
            self._users = []
            self._tokens = {}
            if not self.path.exists():
                return
            data = json.loads(self.path.read_text())
            for u in data.get("users", []):
                u.setdefault("revoked", False)
                u["revoked_downloads"] = list(u.get("revoked_downloads") or [])
                self._users.append(u)
                if not u["revoked"]:
                    self._tokens[u["token_sha256"]] = u["user_id"]

    def _persist(self) -> None:
        """Atomically write the registry (caller must hold ``self._lock``)."""
        tmp = self.path.with_name(self.path.name + ".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump({"users": self._users}, handle, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, 0o600)
        tmp.replace(self.path)

    def _find(self, user_id: str) -> dict | None:
        return next((u for u in self._users if u["user_id"] == user_id), None)

    def _find_by_tenant(self, tenant: str) -> dict | None:
        return next((u for u in self._users if tenant_hash(u["user_id"]) == tenant), None)

    def add_user(self, user_id: str) -> str:
        with self._lock:
            if self._find(user_id):
                raise ValueError(f"user already exists: {user_id}")
            raw = secrets.token_urlsafe(32)
            entry = {
                "user_id": user_id,
                "token_sha256": token_hash(raw),
                "created": int(time.time()),
                "revoked": False,
                "revoked_downloads": [],
            }
            self._users.append(entry)
            self._tokens[entry["token_sha256"]] = user_id
            self._persist()
            return raw

    def user_id_for_token(self, token: str) -> str | None:
        with self._lock:
            return self._tokens.get(token_hash(token))

    def is_user_revoked(self, user_id: str) -> bool:
        with self._lock:
            entry = self._find(user_id)
            return bool(entry and entry.get("revoked", False))

    def revoke_user(self, user_id: str) -> None:
        with self._lock:
            entry = self._find(user_id)
            if not entry:
                raise ValueError(f"unknown user: {user_id}")
            entry["revoked"] = True
            self._tokens.pop(entry["token_sha256"], None)
            self._persist()

    def rotate_token(self, user_id: str) -> str:
        with self._lock:
            entry = self._find(user_id)
            if not entry:
                raise ValueError(f"unknown user: {user_id}")
            if entry.get("revoked", False):
                raise ValueError(f"user is revoked: {user_id}")
            raw = secrets.token_urlsafe(32)
            self._tokens.pop(entry["token_sha256"], None)
            entry["token_sha256"] = token_hash(raw)
            self._tokens[entry["token_sha256"]] = user_id
            self._persist()
            return raw

    def revoke_download(self, user_id: str, download_id: str) -> None:
        with self._lock:
            entry = self._find(user_id)
            if not entry:
                raise ValueError(f"unknown user: {user_id}")
            revoked = entry.setdefault("revoked_downloads", [])
            if download_id not in revoked:
                revoked.append(download_id)
                self._persist()

    def is_download_revoked(self, tenant: str, download_id: str) -> bool:
        with self._lock:
            entry = self._find_by_tenant(tenant)
            return bool(entry and download_id in entry.get("revoked_downloads", []))

    def user_id_for_tenant(self, tenant: str) -> str | None:
        with self._lock:
            entry = self._find_by_tenant(tenant)
            return entry["user_id"] if entry else None

    def list_users(self) -> list[dict]:
        with self._lock:
            return [
                {"user_id": u["user_id"], "created": u["created"],
                 "revoked": bool(u.get("revoked", False))}
                for u in self._users
            ]


user_store = UserStore()
