"""Per-tenant key derivation and symmetric encryption."""
import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from .config import settings


def tenant_hash(user_id: str) -> str:
    """Public tenant identifier: sha256(user_id) truncated to 128 bits."""
    return hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:32]


def master_key_bytes() -> bytes:
    raw = settings.USER_MASTER_KEY.strip()
    if not raw:
        raise RuntimeError("USER_MASTER_KEY is not set")
    try:
        key = bytes.fromhex(raw)
    except ValueError:
        key = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
    if len(key) < 16:
        raise RuntimeError("USER_MASTER_KEY must be at least 16 bytes")
    return key


def fernet_for_hash(tenant: str) -> Fernet:
    """Derive a Fernet instance from the master key, bound to one tenant hash."""
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=settings.USER_KEY_SALT.encode("utf-8"),
        info=tenant.encode("utf-8"),
    )
    key = hkdf.derive(master_key_bytes())
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt_bytes(data: bytes, user_id: str) -> bytes:
    return fernet_for_hash(tenant_hash(user_id)).encrypt(data)


def decrypt_bytes(token: bytes, user_id: str) -> bytes:
    return decrypt_bytes_for_hash(token, tenant_hash(user_id))


def decrypt_bytes_for_hash(token: bytes, tenant: str) -> bytes:
    try:
        return fernet_for_hash(tenant).decrypt(token)
    except InvalidToken as exc:
        raise ValueError("decryption failed") from exc
