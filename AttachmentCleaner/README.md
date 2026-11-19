# Gmail Attachment Cleaner

Frees Google Account storage by uploading large Gmail attachments to the
self-hosted Gleaner archive, inserting a small rewritten message in the same
thread, and permanently deleting the heavy original. The Gleaner webhook is the
**only** backup path — there is no legacy Drive fallback and no rollback script.

## Features

- **Large attachment detection** — `has:attachment larger:10M older_than:1y` by default.
- **Gleaner archive** — attachments are uploaded to the webhook and replaced by a short plain-text note with a signed download link.
- **Metadata preservation** — original date, sender, recipients, subject and body are kept in the rewritten email.
- **Advanced Gmail API** — the rewritten message is inserted with `internalDateSource: "dateHeader"` so it keeps its original timestamp.
- **Real storage reclaim** — after a successful upload **and** insert, the original is permanently deleted.
- **Safety** — the original is never touched if upload or rewrite fails.
- **Dry-run mode** — `DRY_RUN` makes **no** changes: no upload, no rewrite, no delete/trash. It only logs what would happen.
- **Periodic cleanup** — an hourly trigger processes new large emails automatically.
- **Robust error handling** — one message's failure does not stop the batch.

## Files

| File | Purpose |
|---|---|
| `Code.gs` | All script logic and `CONFIG` |
| `TestCore.gs` | Manual tests — run `runAllCoreTests()` in the editor |
| `appsscript.json` | Manifest: Gmail API advanced service and OAuth scopes |

`.clasp.json` keeps `filePushOrder` in sync; no `Rollback.gs` or Drive helpers remain.

## Setup

### 1. Enable the Gmail API

In the Apps Script editor: **Resources → Advanced Google services → Gmail API: ON**.
Then enable Gmail API in the linked Google Cloud project (**APIs & Services → Library**).

### 2. Create your Gleaner account

Ask the administrator to create one and give you the one-time token:

```bash
curl -X POST https://gleaner.aldof.duckdns.org/admin/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"you@example.com"}'
```

You can also do this in the browser at `/admin`. Store the returned token.

### 3. Script Properties

Under **Project Settings → Script Properties**:

| Property | Required | Description |
|---|---|---|
| `WEBHOOK_TOKEN` | yes | Your per-user Gleaner bearer token. Never hard-code it in `.gs` files. |
| `GLEANER_NOTIFY_EMAIL` | no | Notification address sent as `notifyEmail`; defaults to the active Google user. |

Run `testWebhookPayload()` once to confirm the token is picked up and the payload shape is correct.

### 4. Authorize and run

Run `setupTrigger()` once to grant scopes and create the hourly trigger. Required scopes are `gmail.modify`, `script.scriptapp` and `script.external_request` — no Drive scopes.

```bash
npm run push:attachment        # from the repo root
```

In the editor: run `dryRun()` first (read-only), then `processAttachments()` for real.

## How it works

1. **Search** — find threads matching `SEARCH_QUERY`, limited by `BATCH_SIZE`.
2. **Upload** — fetch each raw message, send attachments to `POST /webhook/gmail-attachments` with your bearer token; count raw attachment count and bytes.
3. **Rewrite** — strip attachment MIME parts from the raw RFC 2822 message, insert a note listing the files plus a `Download: <url>` line, and insert the cleaned message into the same thread with `internalDateSource: "dateHeader"`.
4. **Delete** — only after upload + insert: permanently delete the original via `Gmail.Users.Messages.remove`. If permanent deletion fails and `TRASH_MESSAGES` is true, move it to trash instead. If `PERMANENTLY_DELETE_ORIGINAL` is false, trash when `TRASH_MESSAGES` is true; otherwise leave it untouched.
5. **Report** — log processed count, attachments, bytes freed and any errors.

In `DRY_RUN`, steps 2–4 never run: no upload, no raw fetch, no rewrite, no delete, no trash.

## Configuration reference

Edit `CONFIG` at the top of `Code.gs`:

| Setting | Default | Description |
|---|---|---|
| `SEARCH_QUERY` | `has:attachment larger:10M older_than:1y` | Gmail search filter |
| `WEBHOOK_URL` | `https://gleaner.aldof.duckdns.org/webhook/gmail-attachments` | Gleaner endpoint |
| `PERMANENTLY_DELETE_ORIGINAL` | `true` | Delete the original after a successful upload + insert |
| `TRASH_MESSAGES` | `true` | Fallback: trash instead of permanent delete |
| `DRY_RUN` | `false` | If true, log only — no changes to Gmail |
| `BATCH_SIZE` | `10` | Messages per execution (avoids the 6-minute limit) |

Note: `WEBHOOK_TOKEN` and `GLEANER_NOTIFY_EMAIL` are Script Properties, not `CONFIG` values.

## Trigger management

- **Start**: `setupTrigger()` (hourly)
- **Stop**: `removeTrigger()`
- **Inspect**: the **Triggers** sidebar in the Apps Script editor

## Manual testing

1. Keep `DRY_RUN = true`; run `processAttachments()` or `dryRun()` — no Gmail changes are made.
2. Check the log for the intended attachments and actions.
3. Set `DRY_RUN = false` and run once for real.
4. Run `runAllCoreTests()` to exercise the pure helpers and mocked dry-run/delete-order tests.
5. Open `https://gleaner.aldof.duckdns.org/`, sign in, and confirm the archive appears with a working download link.

## Notes

- Original timestamps are preserved by `internalDateSource: "dateHeader"`.
- Byte totals come from the raw attachments, not the zipped upload size.
- Errors are logged per message without halting the batch.
- Each user runs their own copy of this script under their own Google account, with their own `WEBHOOK_TOKEN`. Tenants are isolated on the server.
