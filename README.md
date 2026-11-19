# Gmail scripts + Gleaner

This repo contains three Google Apps Script projects and the self-hosted webhook that powers Gleaner:

| Component | Purpose |
|---|---|
| `LabelReminder/` | AI-generated reminders for threads labelled `remind-every/*` |
| `FollowUpReminder/` | AWV follow-up digests and escalations |
| `AttachmentCleaner/` | Removes large attachments from Gmail and archives them in Gleaner |
| `attachment-webhook-server/` | Multi-tenant, encrypted attachment store with signed download links |

The primary goal of Gleaner is **freeing Google account storage**: large attachments are uploaded once, the email is replaced by a small attachment-free copy containing a download link, and the heavy original is permanently deleted.

## Architecture

```text
Gmail (large attachment)
  → AttachmentCleaner (hourly Apps Script trigger, under the owner's Google account)
      → POST /webhook/gmail-attachments  [Bearer WEBHOOK_TOKEN]
      → Gleaner webhook encrypts with a per-tenant key and stores on PVC
      → webhook emails a signed download link to the owner
      → Apps Script inserts a small rewritten email with the link
      → Apps Script permanently deletes the original message
  → owner opens the dashboard or forwards the signed link to a receiver
```

Files on the webhook server are Fernet-encrypted with a key derived per tenant from `USER_MASTER_KEY` (fixed `GLEANER-v1:` envelope; HKDF info `<tenant_hash>:v1`). The server decrypts on download; there is no browser-side encryption. Signed download links are capability links: whoever holds a valid, unexpired, unrevoked link can download that one item. Listing, deleting, and revoking require the owner's token/session.

The archive is clean-slate: there is no legacy Drive backup, no `Rollback.gs`, and no migration script. The webhook is the only storage path.

## Quick start

### 1. Webhook server

```bash
cd attachment-webhook-server
pip install -r requirements.txt
python3 -m pytest -q
```

Required environment variables:

| Variable | Purpose |
|---|---|
| `USER_MASTER_KEY` | root key for per-tenant HKDF derivation (hex or base64, ≥16 bytes) |
| `USER_KEY_SALT` | HKDF salt; changing it invalidates existing ciphertext |
| `SIGNING_SECRET` | HMAC for download links, sessions and CSRF tokens |
| `ADMIN_TOKEN` | protects `/admin/users` |
| `PUBLIC_BASE_URL` | public prefix for emailed links |
| `STORAGE_ROOT` | PVC mount point |
| `DOWNLOAD_TTL_HOURS` | signed-link lifetime (default 168; `0` = never) |
| `RETENTION_DAYS` | delete old items (`0` = never) |
| `SECURE_COOKIES` | set `Secure` on session cookies (default true) |
| `SMTP_*` | notification email settings |

Generate a user token:

```bash
curl -X POST https://gleaner.aldof.duckdns.org/admin/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"you@example.com"}'
```

### 2. AttachmentCleaner

Set these in **Project Settings → Script Properties**:

- `WEBHOOK_TOKEN` — the token returned above.
- `GLEANER_NOTIFY_EMAIL` — optional; defaults to the active Google user.

Then:

```bash
npm run push:attachment
clasp run testWebhookPayload        # verify token + payload shape
clasp run dryRun                    # non-mutating preview
clasp run processAttachments        # real run: upload, rewrite, delete originals
clasp run setupTrigger              # hourly automation
```

Configuration lives in `AttachmentCleaner/Code.gs` (`CONFIG`). Important flags:

- `PERMANENTLY_DELETE_ORIGINAL: true` — actually reclaim Gmail storage.
- `TRASH_MESSAGES` — fallback when permanent deletion is disabled.
- `DRY_RUN` — makes **no** changes to Gmail.

## Web UI

`https://gleaner.aldof.duckdns.org/` is a responsive, Google Material–style site.

- **`/login`** — sign in with your personal Gleaner token (the same one in `WEBHOOK_TOKEN`).
- **`/`** — your archive dashboard: summary cards, search, and one clear action per item. **Download** is primary; **Revoke link** blocks a forwarded link without deleting the archive; **Delete** asks for confirmation. Cards become a compact list on phones.
- **`/admin`** — sign in with `ADMIN_TOKEN` to create users, rotate tokens and revoke access. New tokens are shown once, so copy them immediately.
- **Download links** go straight to the ZIP and need no login; expired or revoked links show a friendly error page.

The UI uses pinned Material Web Components (v2.5.0) loaded from a CDN, with plain HTML fallbacks if it is unavailable. Rendering happens in Jinja2 templates (`attachment-webhook-server/app/templates/`) with local CSS/JS in `app/static/`. State-changing forms carry signed CSRF tokens; subject and sender are always HTML-escaped.

## Validation

```bash
npm run validate
npm run test:webhook
```

Both run in CI via `.github/workflows/validate.yml`.
