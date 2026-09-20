# Rollback Plan for AttachmentCleaner

## Overview

The AttachmentCleaner script performs three main actions on each processed email:
1. **Saves** all attachments to a dedicated Google Drive folder (`Gmail Bijlagen Backup`)
2. **Strips** attachments from the message body
3. **Trashes** the original email (moved to trash)
4. **Rewrites** the message without attachments (preserving original content)

## What Needs to Be Restored

To fully roll back to the original state, we need:

| Item | Location | Purpose |
|------|----------|----------|
| Original email (with attachments) | Gmail (original thread) | Full original message |
| `.eml` backup file | `AttachmentCleaner/AttachmentCleaner/` | Raw RFC 2822 message (already saved) |
| Processed message metadata | N/A | Which messages were processed (manifest) |

## Current State

- **Processed messages**: All emails matching `has:attachment larger:10M -label:bijlagen-verwerkt` have been processed.
- **Backup files**: Each processed email has a `.eml` file in `AttachmentCleaner/AttachmentCleaner/` (e.g., `2026-09-18-labelreminder-20260918.eml`).
- **Original messages**: Trashed (not recoverable from trash unless deleted recently).
- **Manifest**: No explicit manifest of processed message IDs exists.

## Rollback Strategy

### Step 1: Identify Processed Emails
We need a list of message IDs that were processed. Since there's no manifest, we can derive it from the backup files:
- Scan `AttachmentCleaner/AttachmentCleaner/` for `.eml` files
- Extract the email subject/thread ID from each `.eml` filename
- Map to Gmail message IDs (requires accessing the original email in Gmail)

### Step 2: Re-insert Original Messages
For each processed email, re-insert the original `.eml` file back into Gmail:
1. Use `Gmail.Users.Messages.insert()` with the `.eml` file content
2. The insertion will create a new message with the same subject/thread ID
3. Attachments will be restored automatically

### Step 3: Restore Original Body (if needed)
If the original message was edited after processing (unlikely), we can restore from the `.eml` file by re-running the rewrite logic.

### Step 4: Clean Up
- Optionally delete the backup `.eml` files after successful re-insertion
- Remove the processed message from trash (if desired)

## Data Needed for Rollback

To perform a complete rollback, we need:

1. **List of processed message IDs** (currently unknown - no manifest)
2. **Original `.eml` files** (already present in `AttachmentCleaner/AttachmentCleaner/`)
3. **A way to re-insert emails** (requires Gmail API access)

## Practical Rollback Steps

### Option A: Full Restoration (Recommended)
1. For each `.eml` file in `AttachmentCleaner/AttachmentCleaner/`:
   - Extract the email subject and thread ID from the filename
   - Open the `.eml` file and copy its content
   - Use `Gmail.Users.Messages.insert()` to re-insert the message
   - This restores the original message with attachments

### Option B: Partial Rollback (Restore only some emails)
1. Identify which emails were processed (by scanning the `.eml` files)
2. Select a subset to restore
3. Re-insert selected `.eml` files

## Important Notes

- **Trash recovery**: Original messages were trashed. Recovery is limited to the trash retention period (typically 30 days). If the trash was emptied, restoration is impossible.
- **Thread ordering**: Re-inserted messages will appear at the end of their thread (since the original was trashed). This is acceptable for most use cases.
- **Backup integrity**: The `.eml` files are stored in subfolders named `YYYY-MM-DD-subject`. They are complete RFC 2822 messages.
- **No permanent deletion**: As long as the `.eml` files remain, the original content is preserved. The rollback simply re-adds them to Gmail.

## Execution

Once you decide to rollback:

1. **Identify which emails to restore** (from the `.eml` files in the project)
2. **Re-insert each `.eml` file** using the Gmail API (via `processAttachments()` with `DRY_RUN=false`)
3. **Verify** the restored messages have their attachments
4. **Optionally clean up** backup files if desired

## Verification

After rollback:
- Check that all previously processed emails now have their original attachments
- Confirm the `.eml` files are still present (they serve as proof of restoration)
- Ensure no orphaned `.eml` files remain (optional cleanup)

---

**Summary**: The AttachmentCleaner script has already saved all attachments to Drive. To rollback, re-insert the original `.eml` files back into Gmail. The only irreversible loss is the original message in Gmail (now in trash). The `.eml` files provide a perfect backup of the original state.
