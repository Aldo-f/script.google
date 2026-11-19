# AGENTS.md — Google Apps Script reminders + Gleaner webhook

**Repo:** Apps Script projects (LabelReminder / FollowUpReminder / AttachmentCleaner) plus the Gleaner FastAPI webhook. **Runtime:** GAS V8 (JS) + Python 3.12. **CI:** `.github/workflows/validate.yml` (GAS syntax/function checks + webhook pytest).

## Projects

| Project | Purpose | Trigger |
|---|---|---|
| `LabelReminder/` | Label-based reminder replies (`remind-every/*`) | every 6h |
| `FollowUpReminder/` | AWV case follow-up digests/escalations | weekly Tue/Thu + daily label sync |
| `AttachmentCleaner/` | Moves large Gmail attachments to Gleaner, frees Gmail storage | hourly |
| `attachment-webhook-server/` | Multi-tenant, encrypted attachment store | FastAPI service |
| `shared/AIProviders.gs` | Gemini → FreeLLMAPI → OpenRouter waterfall | deployed to both reminder projects |

## Dev commands

```bash
npm run validate                 # local GAS syntax + required functions + CONFIG
npm run push:label               # clasp push LabelReminder
npm run push:followup            # clasp push FollowUpReminder
npm run push:attachment          # clasp push AttachmentCleaner
npm run test:webhook              # webhook pytest
# or: cd attachment-webhook-server && python3 -m pytest -q
```

Tests in the Apps Script projects are run manually in the editor via `runAllTests()`, `runAllAITests()`, `runAllCoreTests()`. Python tests run in CI.

## Script Properties

- Reminder projects: `GEMINI_API_KEY`, `FREE_LLM_API_KEY`, `OPENROUTER_API_KEY` (all optional; fallback template when no AI provider is available).
- AttachmentCleaner:
  - `WEBHOOK_TOKEN` — per-user Gleaner bearer token (required).
  - `GLEANER_NOTIFY_EMAIL` — optional owner notification address; defaults to the active Google user.
  - Never hard-code tokens or keys in `.gs` files.

## Gleaner webhook security rules

- Identity is the bearer token; only `sha256(token)` is stored in `STORAGE_ROOT/users.json`.
- Tenant = `sha256(user_id)[:32]`; the raw email never appears in a filesystem path.
- All storage operations go through `app/storage.py` with a `user_id`. Never build a path directly from request input.
- Files on PVC are Fernet-encrypted with `HKDF-SHA256(USER_MASTER_KEY, salt=USER_KEY_SALT, info="<tenant_hash>:v1")` and stored under a fixed `GLEANER-v1:` envelope. No plaintext attachment or metadata may be written to `STORAGE_ROOT`.
- Downloads use signed capability links (`tenant:download_id:exp`) so a forwarded link works without login; listing, deleting, and revoking require the owner's token/session.
- The server decrypts. There is no browser-side crypto and no key in a URL fragment.
- `ADMIN_TOKEN` guards the admin API and `/admin` page; `SIGNING_SECRET` signs links, sessions and CSRF tokens; `USER_MASTER_KEY` loss means total data loss.

## AttachmentCleaner behaviour

- Workflow: upload attachments → rewrite the mail with a short Gleaner note + download link → permanently delete the original (configurable) so Gmail storage is actually reclaimed.
- `DRY_RUN` is non-mutating: no rewrite, no delete, no upload.
- Never delete an original unless upload + rewritten-message insert both succeeded.
- `PERMANENTLY_DELETE_ORIGINAL: true` by default; `TRASH_MESSAGES` is the fallback when permanent deletion is disabled.
- The webhook is the **only** backup path — there is no Drive fallback, no `Rollback.gs`, and no legacy migration script.

## Gleaner web UI

- Jinja2 templates live in `attachment-webhook-server/app/templates/`; local assets in `app/static/`. The Dockerfile copies the whole `app/` directory, so both are included.
- Material Web Components are pinned (`@material/web@2.5.0`) and loaded as ES modules from esm.sh in `app/static/js/app.js`. Native HTML controls remain as fallbacks if the CDN is unavailable.
- Pages: `/login` (owner token), `/` (dashboard with search, download, revoke, delete), `/admin` (create/revoke users, rotate tokens, admin sign-in). Download links still go straight to the ZIP.
- Every state-changing UI form carries a signed CSRF token; session cookies are HttpOnly/SameSite=Lax (Secure unless `SECURE_COOKIES=false`).
- Jinja2 autoescaping is always on — never mark user-supplied subject/sender as `safe`.

## Conventions / anti-patterns

- Do not hard-code API keys or tokens — Script Properties only.
- Do not edit per-project `AIProviders.gs`; canonical source is `shared/AIProviders.gs`.
- Do not add `doGet`/`doPost` to Apps Script projects — they are time-triggered.
- Keep `.clasp.json` `filePushOrder` in sync with actual files; the root list used to reference a non-existent `FollowUpReminder/src/` tree.
- `AttachmentCleaner` helper functions use a trailing `_`; entry points do not. CI checks entry points only.
- FollowUpReminder docs saying "every 6h" are wrong — it is weekly (Tue/Thu). LabelReminder is every 6h.
- Apps Script tests are syntax-checked in CI but never executed there.

## Deployment notes (infra repo, not here)

- Secrets come from Kubernetes Secret `gleaner-webhook-secrets`: `USER_MASTER_KEY`, `USER_KEY_SALT`, `SIGNING_SECRET`, `ADMIN_TOKEN`.
- PVC `gleaner-webhook-storage` must use `longhorn`; Helm must inject secrets via `envFrom`, not plaintext values.
- Back up `USER_MASTER_KEY` before enabling real uploads — losing it makes every archive unreadable. There is no key-rotation or legacy-migration tooling; start with a clean store.
