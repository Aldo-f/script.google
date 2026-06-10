# Flow diagrams 📊

## FollowUpReminder

```
                    ┌──────────────────────────┐
                    │   AWV mail arrives in     │
                    │   Gmail inbox             │
                    └──────────┬───────────────┘
                               │
                               ▼
                    ┌──────────────────────────┐
                    │ FollowUp/Active label     │
                    │ applied (manual or auto)  │
                    └──────────┬───────────────┘
                               │
                    ┌──────────▼───────────────┐
                    │ Every 6h: checkDigests() │
                    │ Every 6h: checkEscalations│
                    └──────────┬───────────────┘
                               │
                               ▼
                    ┌──────────────────────────┐
                    │ syncLabels()             │
                    │ - count reminders        │
                    │ - set FollowUp/N label   │
                    └──────────┬───────────────┘
                               │
                               ▼
                    ┌──────────────────────────┐
                    │ collectPending()          │
                    │                           │
                    │ Filtert:                  │
                    │  ✅ Ouder dan WAIT_DAYS   │
                    │  ❌ FollowUp/Closed       │
                    │  ❌ Heeft reply van       │
                    │     ontvanger             │
                    │  ❌ Cross-thread reply    │
                    └──────────┬───────────────┘
                               │
                    ┌──────────▼───────────────┐
                    │ pending lijst             │
                    │                           │
                    │ voor elk pending item:    │
                    │   - thread                │
                    │   - subject               │
                    │   - ticketCode            │
                    │   - reminderCount         │
                    │   - sentDate              │
                    │   - context (snippet)     │
                    └──────────┬───────────────┘
                               │
                    ┌──────────▼───────────────┐
                    │ Split:                   │
                    │                           │
                    │ reminderCount <           │
                    │ ESCALATE_AFTER            │
                    │         │                 │
                    │         ▼                 │
                    │   toDigest                │
                    │   ─────────               │
                    │   sendDigest():           │
                    │   samenvatting naar       │
                    │   mobiliteit@...          │
                    │                           │
                    │ reminderCount >=          │
                    │ ESCALATE_AFTER            │
                    │   && NIET geëscaleerd     │
                    │         │                 │
                    │         ▼                 │
                    │   toEscalate              │
                    │   ──────────              │
                    │   sendEscalation():       │
                    │   - aparte mail naar      │
                    │     big chief             │
                    │   - FollowUp/Escalated    │
                    │     label toevoegen       │
                    └──────────┬───────────────┘
                               │
                    ┌──────────▼───────────────┐
                    │ Volgende cyclus:          │
                    │                           │
                    │ ✅ Geëscaleerde threads   │
                    │    blijven in pending     │
                    │    (dus nog in digest)    │
                    │                           │
                    │ ❌ Geen nieuwe escalatie  │
                    │    voor reeds             │
                    │    geëscaleerde threads   │
                    └──────────────────────────┘
```

## LabelReminder

```
                    ┌──────────────────────────┐
                    │ Plak remind-every/2weeks  │
                    │ op eender welke e-mail    │
                    └──────────┬───────────────┘
                               │
                    ┌──────────▼───────────────┐
                    │ Elke 6u: checkReminders()│
                    └──────────┬───────────────┘
                               │
                    ┌──────────▼───────────────┐
                    │ Stap 1: autoPauseOnReply()│
                    │                           │
                    │ Voor elke remind-every/*  │
                    │ thread:                   │
                    │                           │
                    │ Heeft ontvanger ge-       │
                    │ antwoord? (niet Aldo,     │
                    │ niet AWV-systeemmails)    │
                    │         │                 │
                    │   Ja ───┴──→ Plak         │
                    │              remind-every │
                    │              /on-hold     │
                    │                           │
                    │   Nee ────→ Niets doen    │
                    └──────────┬───────────────┘
                               │
                    ┌──────────▼───────────────┐
                    │ Stap 2: Reminders sturen  │
                    │                           │
                    │ Filter:                   │
                    │  ✅ remind-every/* label  │
                    │  ❌ remind-every/on-hold  │
                    │                           │
                    │ Voor elke actieve thread: │
                    │                           │
                    │ Interval verstreken sinds │
                    │ laatste bericht van Aldo? │
                    │ (manueel of automatisch)  │
                    │         │                 │
                    │   Ja ───┴──→ Genereer     │
                    │              herinnering: │
                    │              1. Detecteer │
                    │                 taal      │
                    │                 (NL/EN)   │
                    │              2. Gemini    │
                    │                 prompt   │
                    │              3. Verstuur │
                    │                 als       │
                    │                 threaded  │
                    │                 reply     │
                    │                           │
                    │   Nee ────→ Skip, wacht   │
                    │              tot volgende │
                    │              check        │
                    └──────────────────────────┘
```

## Label lifecycle (per thread)

```
Thread status        Labels                          Gedrag
─────────────────────────────────────────────────────────────────
Nieuw                remind-every/2weeks             Wordt gemonitord
Ontvanger replyt     + remind-every/on-hold          Gepauzeerd ⏸
Jij verwijdert       remind-every/2weeks             Hervat ▶️
  on-hold
Jij verwijdert       (geen labels)                   Uit scope 🗑
  beide labels
Jij antwoordt        remind-every/2weeks             Timer reset
  manueel
```

## Timing

```
FollowUpReminder:
  checkDigests()    → elke 6 uur (digest met openstaande dossiers)
  checkEscalations() → elke 6 uur (escalatie na N reminders)

LabelReminder:
  checkReminders()  → elke 6 uur (auto-pause + reminders)
```
