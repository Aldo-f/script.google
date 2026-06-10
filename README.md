# Gmail Reminder Scripts 🤖📧

Twee Google Apps Script projecten voor automatische e-mailherinneringen via Gmail-labels.

---

## 📦 Projecten

### 1. FollowUpReminder — AWV Dossier Opvolging

**Doel:** Automatische opvolging van AWV-meldingsdossiers voor de gemeente Merelbeke-Melle.

Scant Gmail op onbeantwoarde dossiers, stuurt samenvattende digest-e-mails, en escaleert hardnekkige dossiers naar de "big chief".

**Flow:**

```
AWV mail komt binnen
       │
       ▼
FollowUpReminder detecteert (search query + label FollowUp/Active)
       │
       ▼
Om de X dagen: collectPending()
  │  ┌── skip closed (FollowUp/Closed)
  │  └── skip replied (recipient heeft geantwoord)  
  │
  ▼
processFollowUps()
  │
  ├── pending met < ESCALATE_AFTER reminders → toDigest
  │     └── sendDigest(): samenvattende mail met alle openstaande dossiers
  │
  └── pending met >= ESCALATE_AFTER reminders → toEscalate
        └── sendEscalation(): aparte mail naar big chief + FollowUp/Escalated label
```

**✅ Sinds de fix:** Geëscaleerde threads blijven in de digest! Ze worden niet opnieuw geëscaleerd, maar de gewone reminder-digests blijven komen tot het dossier gesloten is.

**Labels:** `FollowUp/Active`, `FollowUp/Closed`, `FollowUp/Escalated`, `FollowUp/1` t/m `FollowUp/N`

**Ontvanger:** `mobiliteit@merelbeke-melle.be`

---

### 2. LabelReminder — Universele Label Herinneringen

**Doel:** Plak een label op **eender welke** e-mail, krijg een AI-herinnering na een bepaalde tijd.

Werkt op elke inbox, niet gebonden aan specifieke ontvangers. Gebruikt Gemini AI om de herinnering in de juiste taal (NL/EN) te genereren.

**Flow:**

```
Plak remind-every/2weeks op een e-mail in Gmail
       │
       ▼
Check om de 6 uur: checkReminders()
  │
  ├── Stap 1: autoPauseOnReply()
  │     └── Ontvanger geantwoord? → plak remind-every/on-hold (pauze)
  │
  └── Stap 2: reminders sturen
        └── Filter on-hold eruit
              └── Interval verstreken sinds laatste bericht van Aldo?
                    └── Ja → AI-herinnering (Gemini) in taal van originele mail
```

**Jouw controle:**

| Wat je doet | Wat gebeurt |
|---|---|
| Recipient replyt | `on-hold` wordt auto toegevoegd ⏸ |
| Jij verwijdert `on-hold` | Hervatten bij volgende check ▶️ |
| Jij voegt `on-hold` toe | Reminders gestopt |
| Jij verwijdert `remind-every/2weeks` | Thread uit scope 🗑 |
| Jij antwoordt manueel | Timer reset (laatste bericht van Aldo) |

**Ondersteunde labels:** `remind-every/1week`, `remind-every/2weeks`, `remind-every/1month`, `remind-every/1year`, enz. (elke combinatie van getal + day/week/month/year)

**Gebruikt Gemini API** voor het genereren van gepersonaliseerde herinneringen.

---

## ⚙️ Technische details

**Taal:** Google Apps Script (JavaScript V8 runtime)

**API's:**
- Gmail API (lezen, labels, verzenden)
- Gemini API (AI-reminders via UrlFetchApp)
- Apps Script API (triggers)

**Triggers:** Tijdgestuurd, om de 6 uur (`checkReminders` / `checkDigests` / `checkEscalations`)

## 🚀 Lokaal ontwikkelen

De scripts zijn geëxporteerd vanuit Google Apps Script en staan in deze repo.
Wijzig lokaal, test in de Apps Script editor, en commit.

```bash
# Structuur
gmail-reminder-scripts/
├── FollowUpReminder/
│   ├── Code.gs          # Hoofdscript
│   ├── Test.gs          # Tests
│   └── appsscript.json  # Manifest
├── LabelReminder/
│   ├── Code.gs          # Hoofdscript
│   └── appsscript.json  # Manifest
├── README.md            # Dit bestand
└── FLOW.md              # Gedetailleerde flows
```
