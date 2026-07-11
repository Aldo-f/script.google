# LabelReminder — Universal Label Reminders

**Part of `script.google` monorepo.** See root [AGENTS.md](../AGENTS.md) for shared context (AI providers, clasp config, CI).

## OVERVIEW
Scans Gmail for threads with `remind-every/*` labels, sends AI‑generated reminder replies after the interval elapses. Works on any inbox — not tied to a specific recipient.

## ENTRY POINTS
| Function | Trigger | Purpose |
|----------|---------|---------|
| `checkReminders()` | Every 6h | Core loop: auto-pause replied threads → send AI reminders |
| `previewReminders()` | Manual | Log thread status (on-hold, due now, remaining days) |
| `dryRun()` | Manual | Creates Gmail drafts instead of sending |
| `setup()` | One-time | Creates labels + installs 6h trigger |
| `pauseRepliedThreads()` / `resumeAll()` | Manual | Bulk pause/resume all threads |

## WHERE TO LOOK
| File | Role |
|------|------|
| `Code.gs` | Main logic (692 lines): CONFIG, all functions |
| `Test.gs` | 12 test suites, ~48 assertions, `runAllTests()` |
| `appsscript.json` | Manifest: Gmail v1, V8, 6 OAuth scopes |

## CONVENTIONS
- **Label pattern**: `remind-every/{N}{unit}` — supports `week`, `weeks`, `day`, `month`, `year` (and NL: `week`, `weken`, `dag`, `maand`, `jaar`).
- **Auto-pause**: Threads where recipient replied get `remind-every/on-hold` applied automatically.
- **AI language**: Detects original email language (NL/EN) and generates response in same language.
- **Recipient detection**: Scans all headers for non-self addresses (excludes ignored senders).
- **Config**: `CONFIG.CREATE_DRAFTS: true` by default — creates drafts, not sent emails.
- **Tests**: Pure-function unit tests via custom `assert(label, cond)` + `runAllTests()` runner.

## ANTI-PATTERNS
- **Do NOT** hard-code API keys — use Script Properties (`GEMINI_API_KEY`, `FREE_LLM_API_KEY`).
- **Do NOT** modify `AIProviders.gs` here — the canonical source is `shared/AIProviders.gs`.
- **Do NOT** add `doGet()`/`doPost()` — this is a time-triggered script, not a web app.

## KEY FILES
```
LabelReminder/
├── Code.gs         # All logic (692 lines)
├── Test.gs         # Unit tests (307 lines, 12 suites)
├── appsscript.json # Manifest
├── .clasp.json     # Per-project clasp config (minified)
└── AIProviders.gs  # DUPLICATE of shared/AIProviders.gs — remove on cleanup
```
