# AI Email Body Fix Plan

## Objectives
1. **Prevent hard newlines** in AI‑rewritten body (keep prose verbatim). 
2. **Maintain verbatim dossier list** (no AI mutation). 
3. **Accurate addressing** (use correct recipient, not “Beste Aldo”).
4. **Minimize hallucinations** (ticket numbers, dates). 
5. **Pass tests** (TDD). 

## Bullet‑point plan
- [ ] Add `rewriteParagraph()` function that rewrites only short prose.
- [ ] Update `sendDigest()` & `sendEscalation()` to split email body into paragraphs & list sections.
- [ ] For prose segments call `callAI()` with prompt “You are Aldo… rewrite only the prose.”
- [ ] Remove any `
` after “doorzond” in the input to the AI. 
- [ ] Preserve dossier list verbatim – insert directly after the prose block. 
- [ ] Ensure the subject line and recipient are correct. 
- [ ] Add tests in `FollowUpReminder/Test.gs`:\n  - `testRewriteParagraph`  – ensures no newlines inserted within the updated sentence.\n  - `testSendDigestBody` – verifies that the dossiers list remains unchanged.\n  - `testAddressing` – checks that the greeting uses recipient name, not sender.\n- [ ] Run all tests locally, confirm `npm run validate` passes. 
- [ ] Deploy changes via `npm run push:followup`. 
- [ ] Verify in Gmail: digest emails display single‑line line; no AI hallucination. 
- [ ] Document in README update if necessary.

## Deliverables
- Updated Code.gs with new functions and refactored email composition.
- Updated Test.gs with new test cases.
- Verify CI passes.
- Push to remote.

---

**Estimated effort:** 2‑3 hours of TDD implementation.  
**Priority:** High – fixes core user complaint.

---

### Saison de la fri angel
- 1: Draft plan file saved.  
- 2: Mark OpenTask as completed.
