"""Persistent user/token registry stored in STORAGE_ROOT/users.json."""
import hashlib
import json
import secrets
import threading
import time
from pathlib import Path

from .config import settings


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
                self._users.append(u)
                self._tokens[u["token_sha256"]] = u["user_id"]

    def _persist(self) -> None:
        payload = {"users": self._users}
        tmp = self.path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, indent=2))
        tmp.replace(self.path)

    def add_user(self, user_id: str) -> str:
        with self._lock:
            if any(u["user_id"] == user_id for u in self._users):
                raise ValueError(f"user already exists: {user_id}")
            raw = secrets.token_urlsafe(32)
            entry = {
                "user_id": user_id,
                "token_sha256": token_hash(raw),
                "created": int(time.time()),
            }
            self._users.append(entry)
            self._tokens[entry["token_sha256"]] = user_id
            self._persist()
            return raw

    def user_id_for_token(self, token: str) -> str | None:
        return self._tokens.get(token_hash(token))

    def list_users(self) -> list[dict]:
        return [{"user_id": u["user_id"], "created": u["created"]} for u in self._users]


user_store = UserStore()
