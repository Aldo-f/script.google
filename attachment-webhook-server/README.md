# Gleaner Webhook — multi-tenant, encrypted

FastAPI service that receives Gmail attachments from per-user Apps Script
instances, encrypts them with a per-tenant key, stores them on a PVC, decrypts
on demand, and emails a signed download link.

It exists so Gmail attachments can be removed from mailboxes without losing
access to them. Files on the server are always encrypted; the server performs
the decryption when a valid download or owner API request is made.

## Security model

| Surface | Auth | Scope |
|---|---|---|
| `POST /webhook/gmail-attachments` | `Authorization: Bearer <user token>` | that user's tenant |
| `GET /download/{tenant}/{id}?sig=&exp=` | HMAC-SHA256 over `tenant:id:exp` | one item, until expiry/revocation |
| `GET /api/downloads*` | Bearer token or signed session cookie | that user's tenant |
| `POST /api/downloads/{id}/revoke` | owner token/session | blocks that capability link |
| `DELETE /api/downloads/{id}` | owner token/session | deletes that tenant item |
| `/admin/users` | `Authorization: Bearer <ADMIN_TOKEN>` | global |
| `POST /admin/users/{id}/revoke` | admin token | revoke a user and every token/session |
| `POST /admin/users/{id}/rotate-token` | admin token | issue a new token, invalidating the old one |
| `/login`, `/`, `/admin` (HTML UI) | token / admin-token session + CSRF | same scopes as above |

A signed download link is a capability: a receiver to whom the owner forwards
it can download that one item without logging in. Listing, deleting, and
revoking always require the owner.

Tenants cannot see each other's data: paths are `STORAGE_ROOT/users/<tenant_hash>/`,
where `tenant_hash = sha256(user_id)[:32]`. Only `sha256(token)` is persisted in
`users.json`; plaintext tokens are never stored.

## Web UI

A responsive, Google Material–style interface is served from Jinja2 templates
in `app/templates/`, with local assets in `app/static/`:

- **`/login`** — one token field, clear errors, show/hide toggle.
- **`/`** — owner dashboard: item count and size, client-side search, cards on
  mobile and a table-like list on desktop. Each item has a primary **Download**
  button plus **Revoke link** and **Delete** (confirmed in a dialog).
- **`/admin`** — admin sign-in, create users, rotate tokens, revoke users. New
  tokens are displayed once. The `/admin/users` API remains for scripting.
- **Error pages** — expired, tampered or revoked links get a friendly page with
  a sign-in button for browsers and JSON for API clients.

Downloads stay direct: the signed link returns the ZIP immediately, so a
receiver who opens a forwarded link needs no account. Material Web Components
are pinned to `@material/web@2.5.0` and loaded as ES modules from esm.sh;
native HTML controls remain usable if the CDN is unreachable. Session cookies
are HttpOnly/SameSite=Lax (Secure unless `SECURE_COOKIES=false`), and all
state-changing forms require a signed CSRF token.

## Encryption at rest

Both the ZIP and `meta.json` are Fernet-encrypted:

```text
key = HKDF-SHA256(
    USER_MASTER_KEY,
    salt = USER_KEY_SALT,
    info = "<tenant_hash>:v1"
)
ciphertext = "GLEANER-v1:" + Fernet(key).encrypt(plaintext)
```

The version is fixed; there is no rotation machinery or legacy-data migration.
The server decrypts in memory; no plaintext is written to the PVC. Changing
`USER_KEY_SALT` or losing `USER_MASTER_KEY` makes existing ciphertext
unreadable, so back up `USER_MASTER_KEY` before enabling uploads.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `USER_MASTER_KEY` | yes | root key for per-tenant derivation (hex or base64, ≥16 bytes) |
| `USER_KEY_SALT` | recommended | HKDF salt; changing it invalidates ciphertext |
| `SIGNING_SECRET` | yes | HMAC for download links and session cookies |
| `ADMIN_TOKEN` | yes | protects `/admin/users` |
| `PUBLIC_BASE_URL` | yes | prefix for emailed links |
| `STORAGE_ROOT` | yes | PVC mount, default `/data/gmail-attachments` |
| `DOWNLOAD_TTL_HOURS` | no | signed-link lifetime, default `168` (7 days); `0` = never |
| `RETENTION_DAYS` | no | purge old items, `0` = never |
| `SECURE_COOKIES` | no | set `Secure` on session cookies, default `true` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS`, `SMTP_USER`, `SMTP_PASSWORD` | yes | notification SMTP |
| `SMTP_FROM`, `SMTP_FROM_NAME` | no | notification sender identity |

The service refuses to start if a required secret is missing or still a
placeholder like `change-me-in-production`.

## Local test

```bash
pip install -r requirements.txt
python3 -m pytest -q
```

## API example

```bash
ADMIN=... 
TOKEN=$(curl -fsS -X POST http://localhost:8000/admin/users \
  -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"user_id":"alice@example.com"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

curl -fsS -X POST http://localhost:8000/webhook/gmail-attachments \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"threadId":"t1","messageId":"m1234567890","subject":"Test",
       "from":"Alice <alice@example.com>","date":"2026-01-02T10:00:00Z",
       "attachments":[{"filename":"a.txt","mimeType":"text/plain","base64Data":"aGVsbG8="}]}'
```

The response contains `downloadUrl`, `zipSize`, `attachmentCount`, and
`downloadId`. `downloadUrl` is emailed to the registered owner (or to the
optional `notifyEmail` in the payload); the owner may forward it. Links expire
after `DOWNLOAD_TTL_HOURS` and can be blocked with
`POST /api/downloads/{download_id}/revoke` without deleting the encrypted files.
