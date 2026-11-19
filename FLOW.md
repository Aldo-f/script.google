# Flow diagrams

## Gleaner: freeing Gmail storage

```mermaid
flowchart TD
    A[ Gmail message with large attachment ] --> B[ Hourly AttachmentCleaner trigger ]
    B --> C[ processAttachments: search CONFIG.SEARCH_QUERY ]
    C --> D{ DRY_RUN? }
    D -->|yes| E[ Log intended payload only. No Gmail changes. ]
    D -->|no| F[ uploadMessageAttachments_: base64 encode attachments ]
    F --> G[ POST /webhook/gmail-attachments with Bearer WEBHOOK_TOKEN ]
    G --> H[ Webhook: verify token to user_id to tenant_hash ]
    H --> I[ Webhook: build ZIP, encrypt with HKDF derived Fernet key, write .enc files ]
    I --> J[ Webhook: signed download link with exp, email to registered owner ]
    J --> K[ Apps Script: strip attachments from raw RFC 2822 message ]
    K --> L[ Apps Script: insert small rewritten email with note + download link ]
    L --> M{ PERMANENTLY_DELETE_ORIGINAL? }
    M -->|yes| N[ Gmail.Users.Messages.remove: permanent delete, storage freed ]
    M -->|no| O[ moveToTrash if TRASH_MESSAGES enabled. Storage freed only after Trash is emptied. ]
```

Download and management are deliberately different surfaces:

```mermaid
flowchart TD
    A[ Signed link in email or forwarded by owner ] --> B[ GET /download/tenant/id?sig&exp ]
    B --> C{ signature valid and not expired? }
    C -->|no| D[ 403 ]
    C -->|yes| E{ owner revoked this item? }
    E -->|yes| D
    E -->|no| F[ Webhook decrypts ciphertext in memory ]
    F --> G[ ZIP streamed to downloader. No login required. ]

    H[ Owner dashboard / API ] --> I[ Bearer token or signed session cookie ]
    I --> J[ List, delete, revoke: only that tenant's records ]
```

Tenant isolation and encryption:

```mermaid
flowchart LR
    TOKEN[ Bearer token ] --> USERS[ users.json: sha256 token only ]
    USERS --> UID[ user_id = owner email ]
    UID --> HASH[ tenant hash = sha256 user_id first 32 hex ]
    HASH --> DIR[ STORAGE_ROOT/users/tenant-hash/download-id ]
    HASH --> KEY[ HKDF USER_MASTER_KEY + salt, info=tenant-hash:v1 ]
    KEY --> FERNET[ Fernet encrypt zip and meta.json, GLEANER-v1 envelope ]
    FERNET --> DIR
```

The browser never decrypts: the web UI (`/login` → `/` dashboard → `/admin`) is a
manage-and-download surface only. Listing, revoking and deleting are
CSRF-protected owner actions; the public download endpoint stays a direct ZIP
response so forwarded capability links are one click for the receiver.

## FollowUpReminder

```text
AWV mail → FollowUp/Active label → weekly checkDigests/checkEscalations
         → collectPending → digest or escalation → label FollowUp/Escalated
```

## LabelReminder

```text
remind-every/{N}{unit} label → every 6h checkReminders
  → autoPauseOnReply (on-hold when recipient replied)
  → interval elapsed? → AI-generated threaded reminder
```

## Timing

| Job | Schedule |
|---|---|
| `AttachmentCleaner.processAttachments` | hourly |
| `LabelReminder.checkReminders` | every 6h |
| `FollowUpReminder.checkDigests` | weekly Tue 08:00 |
| `FollowUpReminder.checkEscalations` | weekly Thu 09:00 |
| `FollowUpReminder.syncLabels` | daily 06:00 |
