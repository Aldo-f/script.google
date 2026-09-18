# Gmail Attachment Cleaner

Automatically removes large attachments from Gmail to save storage space while preserving the email message itself (original date, sender, recipients, formatting, and text). All attachments are first safely backed up to a dedicated folder on Google Drive.

## Features

- **Large attachment detection** – Finds emails with attachments larger than 10 MB using the query `has:attachment larger:10M -label:bijlagen-verwerkt`
- **Automatic backup** – All attachments are saved to a dedicated Google Drive folder (`Gmail Bijlagen Backup`)
- **Metadata preservation** – Original send date, sender, recipients, subject, and full message body are kept in the rewritten email
- **Advanced Gmail API** – Uses `Gmail.Users.Messages.insert` with `internalDateSource: "dateHeader"` to preserve original timestamps
- **Safety** – Original messages are moved to trash after processing (unless `DRY_RUN` is enabled)
- **Duplicate prevention** – If a file with the same name already exists in the backup folder, a timestamped version is created
- **Dry-run mode** – Test the script without making any changes
- **Robust error handling** – Individual message failures don't stop the entire process

## Files

1. **Code.gs** – Main script with all functionality
2. **appsscript.json** – Google Apps Script manifest with required scopes and Advanced Gmail Service enabled
3. **README.md** – This documentation file

## Setup

### 1. Enable Advanced Gmail Service
   - In the Apps Script editor: **Resources → Advanced Google services**
   - Toggle **Gmail API** to ON
   - Click OK

### 2. Enable Gmail API in Google Cloud
   - Click the **Google Cloud Platform project** link in the dialog above
   - In the Cloud Console, navigate to **APIs & Services → Library**
   - Search for and enable **Gmail API**

### 3. Configure the Script
   Edit the `CONFIG` object at the top of `Code.gs`:
   - `SEARCH_QUERY` – Gmail search query (default: `'has:attachment larger:10M -label:bijlagen-verwerkt'`)
   - `DRIVE_FOLDER_NAME` – Name of the Google Drive folder for backups (default: `'Gmail Bijlagen Backup'`)
   - `PROCESSED_LABEL` – Label applied to processed messages (default: `'bijlagen-verwerkt'`)
   - `DRIVE_FOLDER_ID` – Optional: ID of an existing Drive folder (leave empty to use folder name)
   - `BATCH_SIZE` – Max messages per run (default: `10` to prevent 6-minute timeout)
   - `DRY_RUN` – Set to `true` for testing without making changes
   - `TRASH_MESSAGES` – Set to `false` to skip trashing originals

### 4. Grant Permissions
   Run `processAttachments()` once and authorize required scopes when prompted:
   - `https://www.googleapis.com/auth/gmail.modify` (read, write, delete Gmail)
   - `https://www.googleapis.com/auth/drive.file` (create/edit Drive files)
   - `https://www.googleapis.com/auth/script.scriptapp` (manage triggers)

### 5. Run the Script
   - Manual test: Run `processAttachments()` once
   - Or run `dryRun()` for a quick single-message test

## How It Works

1. **Search** – Finds threads matching `SEARCH_QUERY` (limited by `BATCH_SIZE`)
2. **Backup** – For each message:
   - Saves all attachments to the Google Drive folder
   - Generates unique filenames to avoid collisions (adds timestamp if needed)
3. **Rewrite** – Uses Advanced Gmail API:
   - Fetches raw RFC 2822 message
   - Strips attachment MIME parts while preserving text/html body
   - Adds note: `[Bijlage "filename" verwijderd en opgeslagen in Google Drive]`
   - Inserts cleaned message back into same thread with `internalDateSource: "dateHeader"`
4. **Cleanup**:
   - Trashes original message (with heavy attachments)
   - Applies `PROCESSED_LABEL` to new message to prevent reprocessing
5. **Logging** – Reports processed count, attachments saved, space freed, and any errors

## Configuration Reference

| Setting | Default | Description |
|---------|---------|-------------|
| `SEARCH_QUERY` | `has:attachment larger:10M -label:bijlagen-verwerkt` | Gmail search filter |
| `DRIVE_FOLDER_NAME` | `Gmail Bijlagen Backup` | Backup folder name in Drive |
| `PROCESSED_LABEL` | `bijlagen-verwerkt` | Label for processed messages |
| `DRIVE_FOLDER_ID` | *(empty)* | Optional Drive folder ID |
| `BATCH_SIZE` | `10` | Messages per execution (prevents timeout) |
| `DRY_RUN` | `false` | If true, skips actual changes |
| `TRASH_MESSAGES` | `true` | If false, originals not trashed |

## Manual Testing

1. Set `DRY_RUN = true` in CONFIG
2. Run `processAttachments()` – see detailed logs without changes
3. Verify attachment backup behavior in logs
4. Set `DRY_RUN = false` and run again for actual processing
5. Or run `dryRun()` function for a quick single-message test

## Notes

- Preserves original email date using `internalDateSource: "dateHeader"` – emails won't appear as "today"
- Processes up to `BATCH_SIZE` messages per run to stay within Apps Script 6-minute limit
- The backup folder is automatically created if it doesn't exist
- Each attachment saves with metadata: original filename, size, and Drive file ID
- Errors are logged per-message but don't halt the entire batch
- Requires enabling the **Gmail API** Advanced Service in the script project

## Example Log Output

```
[DRIVE] Created new folder: "Gmail Bijlagen Backup" (ID: 1A2b3C4d5E6f7G8h9I0j)
[SEARCH] Found 5 thread(s) to process (batch size: 10)
[PROCESS] 1/5 — Thread: 1abc123DEF
[PROCESS] Message ID: 19xyz789 — Attachments: 3
[DRIVE] Saved: "report_Q3.pdf" (4523912 bytes)
[DRIVE] Saved: "presentation.pptx" (8910234 bytes)
[DRIVE] Saved: "data.xlsx" (12457890 bytes)
[DRIVE] Name collision: "image.png" → "image_20260918_153045_1abc123D.png"
[REBUILD] Stripping attachment: "report_Q3.pdf"
[REBUILD] Stripping attachment: "presentation.pptx"
[REBUILD] Stripping attachment: "data.xlsx"
[REBUILD] Stripping attachment: "image.png"
[REBUILD] Inserted rewritten message into thread 1abc123DEF (new message ID: 2def456GHI)
[TRASH] Original message trashed: 19xyz789
[SUMMARY] Processed: 1/5 messages
[SUMMARY] Attachments saved: 4, total: 25.89 MB
[SUMMARY] Errors: 0
[SUMMARY] Elapsed: 4s
```