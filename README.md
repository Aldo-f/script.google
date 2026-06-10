# Gmail Reminder Scripts 🤖📧

Two Google Apps Script projects for automated email reminders via Gmail labels.

---

## 🧪 Preview & Dry-Run Modes

The script has **three ways** to preview what would happen without actually sending:

- **`previewReminders()`** — Logs status of all threads: ⏸ on-hold, 🔴 due now, ⏳ remaining days. Quickest check.
- **`dryRun()`** — Creates Gmail drafts instead of sending. See the exact AI-generated body.
- **`CONFIG.DRY_RUN = true`** — Logs everything, nothing created in Gmail. Full output in Execution log.

**Default:** `CREATE_DRAFTS: true` — all reminders are created as drafts first.
Set `CREATE_DRAFTS = false` only when ready to go live.

### Example

```javascript
// Step 1: check status
previewReminders();

// Step 2: view drafts in Gmail → Drafts
dryRun();

// Step 3: go live
// Edit CONFIG.CREATE_DRAFTS = false in code OR
// just let the trigger run normally
checkReminders(); // actually sends
```

---

## 📦 Projects

### 1. FollowUpReminder — AWV Case Follow-Up

**Purpose:** Automated follow-up of AWV notification cases for the municipality of Merelbeke-Melle.

Scans Gmail for unanswered cases, sends summary digest emails, and escalates stubborn cases to the "big chief".

**Flow:**

```
AWV email arrives
       │
       ▼
FollowUpReminder detects (search query + FollowUp/Active label)
       │
       ▼
Every X days: collectPending()
  │  ┌── skip closed (FollowUp/Closed)
  │  └── skip replied (recipient has answered)  
  │
  ▼
processFollowUps()
  │
  ├── pending with < ESCALATE_AFTER reminders → toDigest
  │     └── sendDigest(): summary email with all open cases
  │
  └── pending with >= ESCALATE_AFTER reminders → toEscalate
        └── sendEscalation(): separate email to big chief + FollowUp/Escalated label
```

**✅ After fix:** Escalated threads stay in the digest! They won't be re-escalated, but regular reminder digests continue until the case is closed.

**Labels:** `FollowUp/Active`, `FollowUp/Closed`, `FollowUp/Escalated`, `FollowUp/1` through `FollowUp/N`

**Recipient:** `mobiliteit@merelbeke-melle.be`

---

### 2. LabelReminder — Universal Label Reminders

**Purpose:** Apply a label to **any** email, get an AI reminder after a specified time.

Works on any inbox, not tied to specific recipients. Uses Gemini AI to generate reminders in the correct language (NL/EN).

**Flow:**

```
Apply remind-every/2weeks to any email in Gmail
       │
       ▼
Every 6h: checkReminders()
  │
  ├── Step 1: autoPauseOnReply()
  │     └── Recipient replied? → apply remind-every/on-hold (pause)
  │
  └── Step 2: send reminders
        └── Filter out on-hold
              └── Interval elapsed since last message from Aldo?
                    └── Yes → AI reminder (Gemini) in language of original email
```

**Your control:**

| What you do | What happens |
|---|---|
| Recipient replies | `on-hold` auto-applied ⏸ |
| You remove `on-hold` | Resumes on next check ▶️ |
| You add `on-hold` | Reminders stopped |
| You remove `remind-every/2weeks` | Thread out of scope 🗑 |
| You reply manually | Timer resets (last message from Aldo) |

**Supported labels:** `remind-every/1week`, `remind-every/2weeks`, `remind-every/1month`, `remind-every/1year`, etc. (any number + day/week/month/year combination)

**Uses Gemini API** for generating personalized reminders.

---

## ⚙️ Technical Details

**Language:** Google Apps Script (JavaScript V8 runtime)

**APIs:**
- Gmail API (read, labels, send)
- Gemini API (AI reminders via UrlFetchApp)
- Apps Script API (triggers)

**Triggers:** Time-based, every 6 hours (`checkReminders` / `checkDigests` / `checkEscalations`)

---

## 🚀 Local Development

Scripts are exported from Google Apps Script and live in this repo.
Edit locally, test in the Apps Script editor, and commit.

```bash
# Structure
gmail-reminder-scripts/
├── FollowUpReminder/
│   ├── Code.gs          # Main script
│   ├── Test.gs          # Tests
│   └── appsscript.json  # Manifest
├── LabelReminder/
│   ├── Code.gs          # Main script
│   └── appsscript.json  # Manifest
├── README.md            # This file
└── FLOW.md              # Detailed flow diagrams
```