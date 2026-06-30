# Spec: AI Waterfall, Key Mgmt, Tests & DRY

## Overview

Four changes across both Google Apps Script projects. Shared code extracted to a
single file deployed to both projects to eliminate duplication.

---

## 1. AI Waterfall: Gemini first, then FreeLLMAPI

**Files affected**: `shared/AIProviders.gs` (new), `LabelReminder/Code.gs`,
`FollowUpReminder/Code.gs`, `FollowUpReminder/AIProviders.test.gs`

**Current order**: FreeLLMAPI → Gemini → fallback template

**New order**: Gemini (multi-key fallback) → FreeLLMAPI → fallback template

**Rationale**: Gemini is more reliable (Google infra). FreeLLMAPI is a
self-hosted fallback that may be unavailable.

### Changes

| File | Change |
|---|---|
| `shared/AIProviders.gs` | `callAI()` tries Gemini first, then FreeLLMAPI |
| `FollowUpReminder/AIProviders.test.gs` | Update `testCallAIWaterfall` expectations |
| Both `Code.gs` | Remove duplicated AI provider functions (handled by DRY step) |

---

## 2. FreeLLMAPI key → Script Properties

**Files affected**: `shared/AIProviders.gs`, `LabelReminder/Code.gs`,
`FollowUpReminder/Code.gs`, `README.md`, `FollowUpReminder/TestSetup.md` (via
setup functions)

**Current state**: `CONFIG.FREE_LLM_API_KEY` hardcoded in both `Code.gs` files.

**Target state**: Read `FREE_LLM_API_KEY` from Script Properties (same mechanism
as `GEMINI_API_KEY`).

### Changes

| File | Change |
|---|---|
| `shared/AIProviders.gs` | New `getFreeLLMApiKey()` reads from Script Properties (prop name: `FREE_LLM_API_KEY`) |
| `shared/AIProviders.gs` | `callFreeLLM()` uses `getFreeLLMApiKey()` instead of `CONFIG.FREE_LLM_API_KEY` |
| Both `Code.gs` | Remove `FREE_LLM_API_KEY` from CONFIG object |
| Both `Code.gs` | `setup()` prints instruction to add `FREE_LLM_API_KEY` |
| `README.md` | Add `FREE_LLM_API_KEY` to setup instructions alongside `GEMINI_API_KEY` |
| `scripts/validate.js` | No change needed — key is now a runtime property |

### Property name

| Key | Source | Reading function |
|---|---|---|
| `GEMINI_API_KEY` | Script Properties | `getGeminiApiKeys()` (existing) |
| `FREE_LLM_API_KEY` | Script Properties | `getFreeLLMApiKey()` (new) |

---

## 3. LabelReminder: Add tests

**Files affected**: `LabelReminder/Test.gs` (new), `.clasp.json` (filePushOrder)

**Pattern**: Same structure as `FollowUpReminder/Test.gs` — pure functions with
inline assertions, mock factories for Gmail dependencies.

### Test coverage

| Category | Functions | Tests |
|---|---|---|
| **Interval parsing** | `parseInterval`, `getIntervalFromLabel` | Valid intervals, invalid strings, edge cases (0, negative) |
| **Sender detection** | `isIgnoredSender` | AWV senders, normal senders, casing |
| **Language detection** | `detectLanguage` | Dutch text, English text, mixed, empty |
| **Header parsing** | `extractEmail`, `extractName` | `<email>`, `Name <email>`, raw email, null |
| **Subject cleaning** | `cleanSubject` | Re/Fw/Antw prefixes, multiple prefixes, no prefix |
| **Fallback text** | `buildFallbackText` | Dutch, English, missing sender name |
| **Date formatting** | `formatDateNL` | Various dates |
| **Reply detection** | `hasRecipientReplied`, `hasOnHold`, `getLastSentByMeDate` | Mock threads |
| **Recipient finder** | `findReminderRecipient` | Mock threads |

### CLI integration

- Add `LabelReminder/Test.gs` to `.clasp.json` `filePushOrder`
- Validate script (`scripts/validate.js`): update `REQUIRED_FUNCTIONS` so
  `LabelReminder` does NOT include `callFreeLLM`/`callGemini`/`callAI`/`getGeminiApiKeys`
  (they'll be in `shared/`).

---

## 4. DRY: Extract shared AI provider module

**Files affected**: `shared/AIProviders.gs` (new), both `Code.gs` (remove
duplicated blocks), `.clasp.json` (add to filePushOrder), `scripts/validate.js`
(update required functions)

### Current duplication

The following four functions are byte-for-byte near-identical in both projects
(differing only in `max_tokens` value):

- `getGeminiApiKeys()` — identical
- `callFreeLLM(prompt)` — identical except hardcoded `max_tokens` (500 vs 800)
- `callGemini(prompt)` — identical except `maxOutputTokens` (500 vs 800)
- `callAI(prompt)` — identical except comments

### Solution: Shared file, same project scope

Google Apps Script has no cross-project import, but `clasp` pushes ALL `.gs`
files under `rootDir` to the **same** project when pushing. By deploying
`shared/AIProviders.gs` to both projects:

- Each project gets its own copy in its Apps Script runtime
- No library infrastructure needed
- Single source of truth in this repo

### Shared module design

```
shared/AIProviders.gs
├── getGeminiApiKeys()         // reads GEMINI_API_KEY from Script Properties
├── getFreeLLMApiKey()         // reads FREE_LLM_API_KEY from Script Properties
├── callFreeLLM(prompt, opts)  // POST to FreeLLMAPI, opts.maxTokens default 800
├── callGemini(prompt, opts)   // POST to Gemini, multi-key fallback, opts.maxTokens default 800
└── callAI(prompt, opts)       // waterfall: Gemini → FreeLLMAPI → throws
```

**Parameter signature change**: Both `callFreeLLM` and `callGemini` now accept
an optional `maxTokens` parameter instead of a hardcoded value. `callAI` also
passes it through.

### Callers (unchanged interface)

```js
// LabelReminder (generates reminder text)
const body = callAI(prompt);               // gets default 800 tokens
const body = callAI(prompt, { maxTokens: 500 });  // explicit

// FollowUpReminder (rewrites digest)
const body = callAI(prompt);               // gets default 800 tokens
```

The `maxTokens` default of 800 is safe for both use cases (reminder text is
~100 words, digest body is ~300 words).

### Files to modify

| File | Change |
|---|---|
| **NEW** `shared/AIProviders.gs` | Extract all 4 AI provider functions with parameterized maxTokens |
| `LabelReminder/Code.gs` | Delete `getGeminiApiKeys()`, `callFreeLLM()`, `callGemini()`, `callAI()` |
| `FollowUpReminder/Code.gs` | Delete `getGeminiApiKeys()`, `callFreeLLM()`, `callGemini()`, `callAI()` |
| `.clasp.json` | Add `shared/AIProviders.gs` to `filePushOrder` |
| `scripts/validate.js` | Remove `callFreeLLM`, `callGemini`, `callAI`, `getGeminiApiKeys` from `REQUIRED_FUNCTIONS` per-project (they're in shared/) |
| `FollowUpReminder/AIProviders.test.gs` | These are integration tests that call the shared functions — no structural change, they'll continue working |
| `.github/workflows/validate.yml` | Add `shared/` to the `.gs` file discovery glob |

---

## Dependencies & Ordering

```
                 ┌──────────────────────┐
                 │ shared/AIProviders.gs │ ← new file, no dependencies
                 └──────────────────────┘
                    ▲              ▲
                    │ deploys to   │ deploys to
               ┌────┴─────┐  ┌────┴──────────┐
               │ LabelRem. │  │ FollowUpRem.  │
               │ Code.gs   │  │ Code.gs       │
               │ Test.gs   │  │ Test.gs       │
               └───────────┘  │ AIProv.test   │
                              └───────────────┘
```

All changes are independent of each other EXCEPT: the DRY step must happen AFTER
the waterfall swap (step 1) and the key move (step 2), otherwise we'd be
duplicating the old code into the shared module then fixing it.

### Implementation order

1. **Create `shared/AIProviders.gs`** with:
   - Waterfall: Gemini → FreeLLMAPI (step 1)
   - `getFreeLLMApiKey()` reading from Script Properties (step 2)
   - Parameterized `maxTokens` (step 4)

2. **Update `LabelReminder/Code.gs`**:
   - Remove duplicated AI provider functions
   - Remove `FREE_LLM_API_KEY` from CONFIG
   - Update `setup()` to mention `FREE_LLM_API_KEY`

3. **Update `FollowUpReminder/Code.gs`**:
   - Remove duplicated AI provider functions
   - Remove `FREE_LLM_API_KEY` from CONFIG
   - Update `setup()` to mention `FREE_LLM_API_KEY`

4. **Create `LabelReminder/Test.gs`** with pure-function tests

5. **Update config files**:
   - `.clasp.json` — add `shared/AIProviders.gs` and `LabelReminder/Test.gs`
   - `scripts/validate.js` — update REQUIRED_FUNCTIONS for both projects
   - `.github/workflows/validate.yml` — include `shared/` in file scan

6. **Update `README.md`** with FREE_LLM_API_KEY setup instructions

---

## Side Effects, Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Deploying shared file**: Apps Script runtime sees 2 top-level functions named the same | They're different Apps Script projects — no collision |
| **MaxTokens change**: 800 vs 500 might change AI response length | 800 is larger, both callers accept any length. No truncation issues. |
| **Missing Script Property**: Existing deployments lack `FREE_LLM_API_KEY` | `callFreeLLM` throws with clear error → caller falls back gracefully. No crash. |
| **README stale**: User forgets to add property | `setup()` logs the instruction. README updated. |
| **CI validation**: Shared functions not in individual Code.gs | Updated `REQUIRED_FUNCTIONS` list; validation scans all `.gs` files |
