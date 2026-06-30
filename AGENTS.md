# AGENTS.md – Quick Reference for OpenCode Sessions

## Repository Overview
- **Projects**: `LabelReminder` (generic label‑based reminders) and `FollowUpReminder` (AWV case follow‑up).
- **Language**: Google Apps Script (JavaScript V8 runtime).
- **Key Concepts**:
  - **AI Waterfall** – `Gemini` → `FreeLLMAPI` → fallback template (see `shared/AIProviders.gs`).
  - **DRY** – Shared AI provider moved to `shared/AIProviders.gs`; both projects import it via `clasp` push order.
  - **Script Properties** – `GEMINI_API_KEY` (required) and `FREE_LLM_API_KEY` (optional) must be set in the Apps Script editor.

## Common Commands
| Task | Command |
|------|---------|
| Validate locally | `npm run validate` (runs `scripts/validate.js`)
| Push LabelReminder | `npm run push:label`
| Push FollowUpReminder | `npm run push:followup`
| Pull LabelReminder | `npm run pull:label`
| Pull FollowUpReminder | `npm run pull:followup`
| Login to clasp | `npm run login`
| Logout from clasp | `npm run logout`
| List clasp projects | `npm run list`

## CI / Validation
- **GitHub Action** `.github/workflows/validate.yml` runs on every push/PR to `main`.
- It parses all `*.gs` files, substitutes Apps Script globals, and checks syntax with `node --check`.
- It also verifies required functions exist for each project and that a `CONFIG` object is declared.
- Ensure any new functions are added to the validation lists.

## Script Properties (Setup)
1. Open the Apps Script project (`script.google.com`).
2. Go to **Project Settings → Script Properties**.
3. Add:
   - `GEMINI_API_KEY` – comma‑separated API keys (primary).
   - `FREE_LLM_API_KEY` – optional fallback key.
4. The `setup()` function in each project's `Code.gs` logs missing keys.

## AI Provider (`shared/AIProviders.gs`)
- Exposes: `getGeminiApiKeys()`, `getFreeLLMApiKey()`, `callGemini(prompt, opts)`, `callFreeLLM(prompt, opts)`, `callAI(prompt, opts)`.
- Default `maxTokens` = 800 (override via `{maxTokens}`).
- Both projects call `callAI()` for reminder text or digest generation.

## Testing Conventions
- Tests live in `LabelReminder/Test.gs` and `FollowUpReminder/Test.gs` (pure‑function style, inline assertions).
- Integration test for AI providers is `FollowUpReminder/AIProviders.test.gs`.
- New tests must be listed in `.clasp.json` under `filePushOrder`.
- Run `npm run validate` to ensure tests compile.

## `clasp` Push Order (`.clasp.json`)
```json
"filePushOrder": [
  "shared/AIProviders.gs",
  "LabelReminder/appsscript.json",
  "LabelReminder/Code.gs",
  "LabelReminder/Test.gs",
  "FollowUpReminder/appsscript.json",
  "FollowUpReminder/Code.gs",
  "FollowUpReminder/Test.gs",
  "FollowUpReminder/AIProviders.test.gs"
]
```
- Keep this order when adding new `.gs` files.

## Helpful Gotchas
- **Do not hard‑code API keys** – they belong in Script Properties.
- The validation workflow expects `CONFIG` object in each `Code.gs`; missing it will break CI.
- When adding new required functions, update the corresponding loop in `validate.yml`.
- All `.gs` files are deployed to both Apps Script projects via the shared `filePushOrder`.

---
*This file is intentionally compact. Add new entries only when an agent would otherwise miss critical repo‑specific behavior.*
