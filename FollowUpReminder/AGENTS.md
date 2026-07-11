# FollowUpReminder — AWV Case Follow-Up

**Part of `script.google` monorepo.** See root [AGENTS.md](../AGENTS.md) for shared context (AI providers, clasp config, CI).

## OVERVIEW
Automated follow-up of AWV notification cases for the municipality of Merelbeke-Melle. Scans Gmail for unanswered dossiers, sends digest summaries, escalates stubborn cases.

## ENTRY POINTS
| Function | Trigger | Purpose |
|----------|---------|---------|
| `checkDigests()` | Weekly Tue 08:00 | Sync labels + send digests for pending dossiers |
| `checkEscalations()` | Weekly Thu 09:00 | Sync labels + escalate overdue dossiers |
| `syncLabels()` | Daily 06:00 | Sync reminder count labels (`FollowUp/1`…`FollowUp/N`) |
| `previewPending()` | Manual | Show threads grouped by status (PENDING/DUE/ESCALATE/REPLIED) |
| `dryRun()` | Manual | Creates drafts for all pending digests+escalations |
| `testEscalationDraft()` | Manual | Debug: creates escalation draft with 3 real dossiers (bypasses config) |
| `setup()` | One-time | Creates labels + installs 3 scheduled triggers |

## WHERE TO LOOK
| File | Role |
|------|------|
| `Code.gs` | Main logic (879 lines): CONFIG, digests, escalations, PDF, email |
| `Test.gs` | 18 test suites, ~78 assertions, `runAllTests()` |
| `AIProviders.test.gs` | 6 integration tests, `runAllAITests()` — tests real AI waterfall |
| `appsscript.json` | Manifest: Gmail v1, V8, 6 OAuth scopes |

## CONVENTIONS
- **Label scheme**: `FollowUp/Active`, `FollowUp/Closed`, `FollowUp/Escalated`, `FollowUp/{N}` (reminder count).
- **Dossier identification**: Extracts ticket code from subject (`KM-2026-XXXXX`), body, or location.
- **Cross-thread reply detection**: `batchCheckCrossThreadReply()` matches ticket codes across threads.
- **Escalation**: After `ESCALATE_AFTER` reminders (default: 3), sends separate escalation email + applies `FollowUp/Escalated`.
- **PDF**: `buildCombinedPdf()` merges all pending case PDF attachments into one.
- **AI digest**: `rewriteProse()` uses Gemini to rewrite official text into citizen-friendly language.
- **Fallback**: If AI fails, `buildFallbackDigest()` generates a plain-text digest.
- **Triggers**: Weekly digest (Tue) + escalation (Thu) + daily label sync (all via `ScriptApp.newTrigger()` with `.timeBased().onWeekDay()`).
- **Tests**: Pure-function unit tests + manual `testEscalationDraft()` integration test.

## ANTI-PATTERNS
- **Do NOT** hard-code API keys — use Script Properties (`GEMINI_API_KEY`, `FREE_LLM_API_KEY`).
- **Do NOT** modify `AIProviders.gs` here — the canonical source is `shared/AIProviders.gs`.
- **Do NOT** add `doGet()`/`doPost()` — time-triggered only.
- **Do NOT** rely on docs saying "every 6h" — actual trigger schedule is weekly (Tue/Thu). See `setup()`.
- **Do NOT** leave `testEscalationDraft()` drafts in Gmail — they bypass `DRY_RUN` and always create real drafts.

## KEY FILES
```
FollowUpReminder/
├── Code.gs              # All logic (879 lines)
├── Test.gs              # Unit tests (390 lines, 18 suites)
├── AIProviders.test.gs  # AI integration tests (149 lines, 6 suites)
├── appsscript.json      # Manifest
├── .clasp.json          # Per-project clasp config
└── AIProviders.gs       # DUPLICATE of shared/AIProviders.gs — remove on cleanup
```
