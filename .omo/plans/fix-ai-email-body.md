# Fix: AI Email Body (chain-of-thought + hallucination)

## TL;DR
- **Problem**: AI outputs chain-of-thought into email body, hallucinates org names
- **Root cause**: `rewriteWithLlm()` sends the entire body (including dossier list) through AI without proper guardrails
- **Fix**: 
  1. New `rewriteProse()` function with strict prompt (no chain-of-thought, no hallucination)
  2. New `composeBody()` function that splits intro/list/outro — only prose goes to AI
  3. Update `sendDigest()` and `sendEscalation()` to use the new functions
- **Test**: Run `dryRun()`, read drafts via Gmail API, verify body is correct

## Context
Current flow: `buildFallbackDigest() / buildEscalationBody()` → full body → `rewriteWithLlm()` → AI rewrites EVERYTHING including dossier list → AI hallucinates + outputs reasoning.

New flow: split into intro prose + list block + outro prose. Only intro/outro go through AI. List block is inserted verbatim.

## Implementation Steps

- [ ] 1. Add `rewriteProse(prose)` function (strict prompt, strip markdown fences, fallback)
- [ ] 2. Add `composeBody(introProse, listBlock, outroProse)` function
- [ ] 3. Rewrite `sendDigest()` to use `composeBody()`
- [ ] 4. Rewrite `sendEscalation()` to use `composeBody()`
- [ ] 5. Push to FollowUpReminder
- [ ] 6. Run `dryRun()` via clasp
- [ ] 7. Read drafts via Gmail API and verify

### 1. Add `rewriteProse()` (after line 376, before `// ─── PDF GENERATION`)
Prompt rules (Dutch):
- "Je bent Aldo, een gemeenteambtenaar die een beleefde herinnering stuurt."
- "Verzin GEEN organisatienamen — gebruik altijd 'AWV' (Agentschap Wegen en Verkeer)."
- "Geef ALLEEN de herschreven tekst terug. Geen inleiding, geen uitleg, geen gedachtegang."
- Strip markdown code fences from output
- Fallback to original if AI output is suspiciously long (>3x input length)

### 2. Add `composeBody()` 
```
composeBody(introProse, listBlock, outroProse):
  rewrittenIntro = rewriteProse(introProse)
  rewrittenOutro = rewriteProse(outroProse)
  return [rewrittenIntro, '', listBlock, '', rewrittenOutro].join('\n')
```

### 3. Update `sendDigest()`
Replace:
```
const body = rewriteWithLlm(buildFallbackDigest(pending));
```
With:
```
const overview = buildGroupedOverview(pending);
const body = composeBody(
  'Geachte,\n\nHierbij een overzicht van de meldingen die ik via AWV aan uw dienst doorzond en waarop ik tot op heden nog geen reactie of statusupdate ontving:',
  overview,
  'Mag ik u vriendelijk verzoeken de openstaande dossiers op te volgen en mij per dossier op de hoogte te stellen van de huidige status?\n\nMet vriendelijke groeten,\nAldo Fieuw'
);
```

### 4. Update `sendEscalation()`
Replace:
```
const body = rewriteWithLlm(buildEscalationBody(entry, pending));
```
With:
```
const items = pending.map(({ ticketCode, sentDate, context, reminderCount }, i) => {
    const ref      = ticketCode || '—';
    const date     = sentDate.toLocaleDateString('nl-BE');
    const location = context.location || '(locatie onbekend)';
    return `  ${i + 1}. Ref. ${ref} — ${date} — ${location} (${reminderCount}x herinnerd)`;
  }).join('\n');
const body = composeBody(
  `Geachte mevrouw Gevers,\n\nVia AWV werden de volgende meldingen doorgestuurd naar ${entry.address}.\nNa ${CONFIG.ESCALATE_AFTER} herhaalde verzoeken om opvolging bleef een reactie uit.\n\nIk escaleer deze dossiers naar u als diensthoofd en stel AWV in kennis zodat zij op de hoogte zijn van het gebrek aan opvolging.\n\nOpenstaande dossiers (bijgevoegde PDF):`,
  items,
  `Mag ik u vriendelijk verzoeken deze dossiers dringend op te nemen en mij te informeren over de verdere aanpak?\n\nMet vriendelijke groeten,\nAldo Fieuw`
);
```

### 5-7. Test cycle
Push → `clasp run dryRun` → read drafts via Gmail API → verify → iterate
