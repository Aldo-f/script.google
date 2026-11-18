# Gleaner Webhook (multi-user, encrypted)

FastAPI service that receives Gmail attachments from per-user Apps Script
instances, encrypts them with a per-user key, stores them on a PVC, and emails
a signed download link.

## Security model

| Surface | Auth | Scope |
|---|---|---|
| `POST /webhook/gmail-attachments` | `Authorization: Bearer <user token>` | that user's tenant |
| `GET /download/{tenant}/{id}?sig=` | HMAC-SHA256 over `tenant:id` | one file |
| `GET /api/downloads*` | `Authorization: Bearer <user token>` | that user's tenant |
| Dashboard `/` | signed HttpOnly session cookie | that user's tenant |
| `/admin/users` | `Authorization: Bearer <ADMIN_TOKEN>` | global |

Files on disk are Fernet-encrypted. The key is
`HKDF-SHA256(USER_MASTER_KEY, salt=USER_KEY_SALT, info=tenant_hash)`.
There is no plaintext attachment or metadata on the PVC.

## Environment

| Var | Required | Purpose |
|---|---|---|
| `USER_MASTER_KEY` | yes | root key for per-user derivation (hex or base64, ≥16 bytes) |
| `USER_KEY_SALT` | recommended | HKDF salt; changing it invalidates existing ciphertext |
| `SIGNING_SECRET` | yes | download URL HMAC + session cookie HMAC |
| `ADMIN_TOKEN` | yes | protects `/admin/users` |
| `STORAGE_ROOT` | yes | PVC mount, default `/data/gmail-attachments` |
| `PUBLIC_BASE_URL` | yes | prefix for emailed links |
| `SMTP_*` | yes | notification mail |
| `RETENTION_DAYS` | no | `0` = never delete |

## Local test

```bash
pip install -r requirements.txt
pytest -q
```

## Rotating `USER_MASTER_KEY`

Rotation is **not** automatic: existing files are encrypted with the old key.
Procedure: stop the deployment, run `scripts/rotate_key.py` (see its `--help`)
which decrypts every tenant file with the old key and re-encrypts with the new
one, update the Secret, restart.
