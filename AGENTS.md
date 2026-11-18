# AGENTS.md — Google Apps Script reminders (LabelReminder / FollowUpReminder / AttachmentCleaner)

**Repo:** `/mnt/HDD1/dev/06-apps-script-google` · **Branch:** main · **Lang:** GAS V8 (JS) · **CI:** `.github/workflows/validate.yml`

**3 projects:** LabelReminder (label-based reminders, every 6h), FollowUpReminder (AWV case follow-up, weekly Tue/Thu), AttachmentCleaner (Gmail attachment cleanup, hourly). Shared `shared/AIProviders.gs` (Gemini → FreeLLMAPI → OpenRouter waterfall). Per-project `.clasp.json`; `filePushOrder` in root `.clasp.json` (stale — references non-existent `FollowUpReminder/src/`; see Pitfalls).

## Dev

- `npm run validate` (syntax + required functions + CONFIG check via `scripts/validate.js`)
- `npm run push:label` / `push:followup` / `push:attachment` (`clasp push --force`)
- `npm run pull:label` / `pull:followup` / `pull:attachment`
- `npm run login` / `logout`; `npm run list`
- `clasp run functionName` / `clasp tail-logs --simplified`
- **Tests:** never run in CI (`if: false`); run manually in editor via `runAllTests()` / `runAllAITests()` / `runAllCoreTests()`

## Setup (Script Properties)

`GEMINI_API_KEY` (comma-separated, primary) · `FREE_LLM_API_KEY` (optional) · `OPENROUTER_API_KEY` (optional). Fallback template when all AI unavailable. `setup()` in each `Code.gs` logs missing keys.

## Conventions / Anti-patterns

- Do NOT hard-code keys — Script Properties only.
- Do NOT edit `AIProviders.gs` per-project — canonical is `shared/AIProviders.gs`; per-project dups (`LabelReminder/AIProviders.gs`, `FollowUpReminder/AIProviders.gs`) are stale — remove on cleanup.
- Do NOT add `doGet`/`doPost` — time-triggered only.
- LabelReminder: `remind-every/{N}{unit}` (week/weeks/day/month/year, NL too); auto-pause replied threads → `remind-every/on-hold`; `CONFIG.CREATE_DRAFTS` true by default.
- FollowUpReminder: labels `FollowUp/Active`, `FollowUp/Closed`, `FollowUp/Escalated`, `FollowUp/{N}`; dossier code from `KM-2026-XXXXX`; escalation after `ESCALATE_AFTER` reminders (default 3); triggers are weekly Tue/Thu + daily label sync (docs saying "every 6h" wrong for FollowUpReminder; correct for LabelReminder only).
- AttachmentCleaner: Advanced Gmail API required; `CONFIG.SEARCH_QUERY` default `has:attachment larger:10M -label:bijlagen-verwerkt`; backup to Drive `Gmail Bijlagen Backup`; dry-run via `DRY_RUN`.
- All `.gs` files deployed via shared `filePushOrder`; keep order when adding new files.
- Per-project `AGENTS.md` exists (`LabelReminder/AGENTS.md`, `FollowUpReminder/AGENTS.md`).

## Gleaner webhook (`attachment-webhook-server/`)

- Multi-tenant: every storage op must go through `app/storage.py` with a `user_id`; never build a path from a request value directly. Files are Fernet-encrypted — do not add code that writes plaintext into `STORAGE_ROOT`.
- `WEBHOOK_SECRET` is gone; auth is per-user bearer tokens hashed in `STORAGE_ROOT/users.json`. `ADMIN_TOKEN` guards `/admin/users`.

## Pitfalls

- `.clasp.json` `filePushOrder` references `FollowUpReminder/src/*.gs` — **no `src/` directory exists** (functions are in `Code.gs` + new modules at root); `AttachmentCleaner/` missing from push order. Update when restructuring.
- `validate.yml` checks `rewriteWithLlm` (stale — should be `rewriteProse`) and doesn't list `AttachmentCleaner` checks. Local `validate.js` is canonical.
- `AttachmentCleaner/Code.gs` uses trailing `_` on helpers (`getOrCreateBackupFolder_`) — entry points (`processAttachments`, `dryRun`, `previewAttachments`, `setupTrigger`) have no `_`; CI checks entry points only.
- Beads (`bd`) is initialized (`BEADS_DIR=/mnt/HDD1/dev/06-apps-script-google/.beads`, `git config beads.role maintainer`). `bd list --pretty --status open` for kanban view. No BookStack/k3s content applies here.
