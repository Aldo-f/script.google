# Test Coverage Summary

## Project: ~/dev/06-apps-script-google

### Test Files

| Project | Test File | Purpose | Suites |
|---------|-----------|---------|--------|
| **FollowUpReminder** | `Test.gs` | Core parsing/extraction/building functions | 19 |
| **FollowUpReminder** | `AIProviders.test.gs` | AI waterfall integration tests | 7 |
| **FollowUpReminder** | `TestCore.gs` | Core workflow functions (new) | 18 |
| **LabelReminder** | `Test.gs` | Core parsing/language/fallback functions | 14 |
| **LabelReminder** | `TestCore.gs` | Core workflow functions (new) | 16 |
| **AttachmentCleaner** | `TestCore.gs` | Core workflow / pure functions (new) | 11 |

### Master Test Runners

- `runAllTestsMaster()` - runs ALL tests for FollowUpReminder (3 test files)
- `runAllTestsMaster()` - runs ALL tests for LabelReminder (2 test files)

### Running Tests

```bash
# Local validation (syntax only)
npm run validate

# In Apps Script editor (actual execution):
# 1. clasp push
# 2. Run runAllTestsMaster() in each project
```

### CI Integration

The GitHub Actions workflow (`.github/workflows/validate.yml`) has a **disabled** step to run tests via `clasp run` against a test Apps Script project. Enable by:

1. Create a test Apps Script project
2. Add secrets: `CLASP_CREDENTIALS` and `CLASP_TEST_PROJECT_ID`
3. Change `if: false` to `if: true` in the workflow

### Coverage Gaps (Remaining)

| Function Category | Status | Notes |
|-------------------|--------|-------|
| Pure parsing/extraction | ✅ Well covered | Test.gs files |
| AI waterfall | ✅ Covered | AIProviders.test.gs |
| Core workflow (checkReminders, checkDigests, etc.) | 🔄 Stubs added | TestCore.gs - mocks need improvement |
| GmailApp integration | ❌ Not testable in CI | Requires real Gmail access |
| Trigger/setup functions | 🔄 Stubs added | TestCore.gs - function existence only |

### Test Commands

```bash
# Validate syntax locally
npm run validate

# Push to Apps Script (requires clasp login)
npm run push:label
npm run push:followup

# Run tests in Apps Script editor:
# - FollowUpReminder: runAllTestsMaster()
# - LabelReminder: runAllTestsMaster()
```

### Next Steps

1. **Enable CI test execution** - Add test project and secrets
2. **Improve mocks** - TestCore.gs functions need better GmailApp mocking for meaningful tests
3. **Add edge case tests** - More boundary conditions for pure functions
4. **Consider test project automation** - Script to provision test project via Apps Script API