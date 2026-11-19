"""Per-tenant key derivation and symmetric encryption.

Ciphertexts are stored with a fixed v1 envelope::

    b"GLEANER-v1:" + <Fernet token>

The HKDF info is bound to both the tenant hash and the fixed key version.
"""
import base64
import hashlib
from binascii import Error as BinasciiError

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from .config import settings

_KEY_VERSION = "v1"
_ENVELOPE_PREFIX = b"GLEANER-v1:"


def tenant_hash(user_id: str) -> str:
    """Public tenant identifier: sha256(user_id) truncated to 128 bits."""
    return hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:32]


def decode_master_key(raw: str) -> bytes:
    """Decode a hex or urlsafe-base64 master key."""
    raw = (raw or "").strip()
    if not raw:
        raise RuntimeError("USER_MASTER_KEY is not set")
    try:
        key = bytes.fromhex(raw)
    except ValueError:
        try:
            key = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
        except (ValueError, BinasciiError) as exc:
            raise RuntimeError("USER_MASTER_KEY is not valid hex or base64") from exc
    if len(key) < 16:
        raise RuntimeError("USER_MASTER_KEY must be at least 16 bytes")
    return key


def master_key_bytes() -> bytes:
    return decode_master_key(settings.USER_MASTER_KEY)


def parse_envelope(token: bytes) -> bytes:
    """Validate the fixed v1 envelope and return the Fernet token bytes."""
    if not isinstance(token, (bytes, bytearray)):
        raise ValueError("ciphertext must be bytes")
    token = bytes(token)
    if not token.startswith(_ENVELOPE_PREFIX):
        raise ValueError("ciphertext is missing the v1 envelope prefix")
    payload = token[len(_ENVELOPE_PREFIX):]
    if not payload:
        raise ValueError("ciphertext is empty")
    return payload


def fernet_for_hash(tenant: str) -> Fernet:
    """Derive a Fernet instance bound to one tenant."""
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=settings.USER_KEY_SALT.encode("utf-8"),
        info=f"{tenant}:{_KEY_VERSION}".encode("utf-8"),
    )
    key = hkdf.derive(master_key_bytes())
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt_bytes(data: bytes, user_id: str) -> bytes:
    token = fernet_for_hash(tenant_hash(user_id)).encrypt(data)
    return _ENVELOPE_PREFIX + token


def decrypt_bytes(token: bytes, user_id: str) -> bytes:
    return decrypt_bytes_for_hash(token, tenant_hash(user_id))


def decrypt_bytes_for_hash(token: bytes, tenant: str) -> bytes:
    payload = parse_envelope(token)
    try:
        return fernet_for_hash(tenant).decrypt(payload)
    except InvalidToken as exc:
        raise ValueError("decryption failed") from exc
