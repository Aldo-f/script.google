// Required OAuth scopes
/* global GmailApp, UrlFetchApp, PropertiesService, ScriptApp */

/**
 * LabelReminder.gs
 *
 * Automatische herinneringen op basis van Gmail-labels.
 *
 * Hoe het werkt:
 *   1. Plak "remind-every/2weeks" (of 1week, 1month, ...) op een e-maildraadje
 *   2. Script checkt: is de interval verstreken sinds de laatste keer dat
 *      iemand in de thread antwoordde?
 *   3. Zo ja → AI-herinnering sturen in dezelfde taal als de originele mail
 *   4. Als de ONTVANGER antwoordt → auto "remind-every/on-hold" label → pauze
 *   5. Verwijder "on-hold" manueel → reminders hervatten
 *   6. Verwijder beide labels → thread verdwijnt uit scope
 *
 * SETUP:
 *   1. Maak labels aan in Gmail: remind-every/1week, remind-every/2weeks, ...
 *   2. script.google.com → Nieuw project → plak dit bestand
 *   3. Project Settings → Script Properties → voeg GEMINI_API_KEY toe
 *   4. Run setup() één keer
 *   5. Run previewReminders() om te testen
 *   6. Run dryRun() om drafts te maken
 *   7. Zet CONFIG.CREATE_DRAFTS = false om live te gaan
 */

const CONFIG = {
  DRY_RUN:       false,
  CREATE_DRAFTS: true,
  MY_EMAIL:      'aldo.fieuw@gmail.com',
  SENDER_ALIAS:  'Aldo Fieuw',
  LABEL_PREFIX:  'remind-every',
  ON_HOLD:       'remind-every/on-hold',

  // Adressen die geen "echte antwoorden" zijn (AWV bevestigingen, etc.)
  IGNORE_SENDERS: [
    'wegenenverkeer.be',
    'klantendienst-awv@wegenenverkeer.be',
  ],
};

// ════════════════════════════════════════════════════════════════════════════
// INTERVAL PARSING
// ════════════════════════════════════════════════════════════════════════════

function parseInterval(suffix) {
  const match = suffix.match(/^(\d+)\s*(day|days|week|weeks|month|months|year|years)$/i);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers = {
    day: 1, days: 1,
    week: 7, weeks: 7,
    month: 30, months: 30,
    year: 365, years: 365,
  };
  return num * (multipliers[unit] || 1);
}

function getIntervalFromLabel(labelName) {
  const parts = labelName.split('/');
  if (parts.length < 2) return null;
  return parseInterval(parts.slice(1).join('/'));
}

// ════════════════════════════════════════════════════════════════════════════
// LABEL OPERATIONS
// ════════════════════════════════════════════════════════════════════════════

function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) ?? GmailApp.createLabel(name);
}

/** Vindt labels die overeenkomen met "remind-every/*" maar geen on-hold */
function getRemindEveryIntervalLabels() {
  const allLabels = GmailApp.getUserLabels();
  return allLabels.filter(label => {
    const name = label.getName();
    if (name === CONFIG.ON_HOLD) return false;
    return name.startsWith(CONFIG.LABEL_PREFIX + '/') && getIntervalFromLabel(name) !== null;
  });
}

/** Heeft deze thread het on-hold label? */
function hasOnHold(thread) {
  return thread.getLabels().some(l => l.getName() === CONFIG.ON_HOLD);
}

// ════════════════════════════════════════════════════════════════════════════
// LAATSTE VERZONDEN DATUM (uit de thread zelf)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Meest recente bericht dat door Aldo verzonden is in deze thread.
 * Of het nu een manueel antwoord of een automatische reminder was — telt beide.
 */
function getLastSentByMeDate(thread) {
  const messages = thread.getMessages();
  for (let i = messages.length - 1; i >= 0; i--) {
    const from = messages[i].getFrom();
    if (from.toLowerCase().includes(CONFIG.MY_EMAIL.toLowerCase())) {
      return messages[i].getDate();
    }
  }
  return thread.getLastMessageDate();
}

// ════════════════════════════════════════════════════════════════════════════
// REPLY DETECTIE — auto pauzeren
// ════════════════════════════════════════════════════════════════════════════

function isIgnoredSender(from) {
  const lower = from.toLowerCase();
  return CONFIG.IGNORE_SENDERS.some(s => lower.includes(s));
}

function hasRecipientReplied(thread) {
  const messages = thread.getMessages();
  // Als er een bericht is (niet eerste, niet van Aldo, niet genegeerd) → reply
  for (let i = 1; i < messages.length; i++) {
    const from = messages[i].getFrom();
    if (from.toLowerCase().includes(CONFIG.MY_EMAIL.toLowerCase())) continue;
    if (isIgnoredSender(from)) continue;
    return true;
  }
  return false;
}

/**
 * Doorloopt alle threads met een remind-every/* label.
 * Als de ontvanger geantwoord heeft, wordt on-hold toegevoegd.
 */
function autoPauseOnReply() {
  const labels = getRemindEveryIntervalLabels();
  const onHoldLabel = getOrCreateLabel(CONFIG.ON_HOLD);
  let paused = 0;

  labels.forEach(label => {
    label.getThreads().forEach(thread => {
      if (hasOnHold(thread)) return;            // al gepauzeerd
      if (!hasRecipientReplied(thread)) return; // nog geen reply

      thread.addLabel(onHoldLabel);
      paused++;
      log(`[PAUSED] ${label.getName()} | ${thread.getFirstMessageSubject()}`);
    });
  });

  if (paused > 0) log(`[AUTO-PAUSE] ${paused} draadje(s) op on-hold gezet wegens reply`);
}

// ════════════════════════════════════════════════════════════════════════════
// TAALDETECTIE
// ════════════════════════════════════════════════════════════════════════════

function detectLanguage(text) {
  const dutchWords = ['de', 'het', 'een', 'van', 'voor', 'met', 'op', 'in',
    'dat', 'niet', 'maar', 'wordt', 'heeft', 'zijn', 'uw', 'geachte', 'beste',
    'graag', 'bedankt', 'bericht', 'melding', 'vriendelijke', 'groeten',
    'antwoord', 'vraag', 'dossier', 'locatie', 'wegens', 'hierbij'];
  const lower = ' ' + text.toLowerCase() + ' ';
  let count = 0;
  dutchWords.forEach(w => {
    if (lower.includes(' ' + w + ' ')) count++;
  });
  return count >= 3 ? 'nl' : 'en';
}

// ════════════════════════════════════════════════════════════════════════════
// GEMINI REMINDER
// ════════════════════════════════════════════════════════════════════════════

/**
 * Parst GEMINI_API_KEY als komma-gescheiden lijst.
 * "key1,key2,key3" → ["key1", "key2", "key3"]
 */
function getApiKeys() {
  const raw = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!raw) return [];
  return raw.split(',').map(k => k.trim()).filter(k => k.length > 0);
}

function generateReminderText(originalSubject, originalSnippet, senderName, lang) {
  const langInstruction = lang === 'nl'
      ? 'Schrijf de e-mail in het Nederlands.'
      : 'Write the email in English.';

  const prompt = [
    langInstruction,
    '',
    'Schrijf een korte, vriendelijke herinneringsmail.',
    'De ontvanger heeft nog niet gereageerd op een eerder verzonden e-mail.',
    'Vraag beleefd of ze al de tijd hebben gehad om te antwoorden.',
    'Toon begrip, geen urgentie. Houd het kort en professioneel.',
    '',
    'Context:',
    `- Origineel onderwerp: "${originalSubject}"`,
    `- Korte inhoud: "${originalSnippet}"`,
    '',
    `Enkel de body, geen onderwerpregel. Maximaal 100 woorden.`,
    `Sluit af met "Met vriendelijke groeten,\n${CONFIG.SENDER_ALIAS}"`,
  ].join('\n');

  // Meerdere API keys: probeer ze één voor één tot er eentje werkt
  const keys = getApiKeys();
  if (keys.length === 0) return buildFallbackText(senderName, originalSubject, lang);

  for (const apiKey of keys) {
    try {
      const response = UrlFetchApp.fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'post',
          headers: { 'Content-Type': 'application/json' },
          payload: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          }),
        }
      );
      const result = JSON.parse(response.getContentText())
        .candidates[0].content.parts[0].text.trim();
      return result;
    } catch (err) {
      log(`[WARN] Gemini key failed (${err.message}), trying next...`);
    }
  }

  log(`[WARN] Alle ${keys.length} API keys failed, using fallback`);
  return buildFallbackText(senderName, originalSubject, lang);
}

// ════════════════════════════════════════════════════════════════════════════
// FALLBACK
// ════════════════════════════════════════════════════════════════════════════

function buildFallbackText(senderName, subject, lang) {
  const name = senderName || 'there';
  if (lang === 'nl') {
    return [
      `Beste ${name},`,
      '',
      `Enkele tijd geleden stuurde ik u een e-mail met als onderwerp:`,
      `"${subject}".`,
      '',
      'Ik wou even vriendelijk navragen of u al de tijd heeft gehad',
      'om hierop te antwoorden?',
      '',
      'Alvast bedankt voor uw opvolging.',
      '',
      'Met vriendelijke groeten,',
      CONFIG.SENDER_ALIAS,
    ].join('\n');
  }
  return [
    `Dear ${name},`,
    '',
    `Some time ago I sent you an email with the subject:`,
    `"${subject}".`,
    '',
    'I just wanted to kindly ask if you have had the opportunity to reply?',
    '',
    'Thank you for your follow-up.',
    '',
    'Kind regards,',
    CONFIG.SENDER_ALIAS,
  ].join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
// ONTVANGER DETECTIE
// ════════════════════════════════════════════════════════════════════════════

function findReminderRecipient(thread) {
  const messages = thread.getMessages();
  for (const msg of messages) {
    const from = msg.getFrom();
    if (!from.toLowerCase().includes(CONFIG.MY_EMAIL.toLowerCase())) {
      return {
        email: extractEmail(from),
        name: extractName(from) || 'there',
      };
    }
  }
  const first = messages[0];
  const toField = first.getTo();
  const toEmail = extractEmail(toField);
  return { email: toEmail || CONFIG.MY_EMAIL, name: 'there' };
}

function extractEmail(fromHeader) {
  const match = fromHeader.match(/<([^>]+)>/);
  return match ? match[1].trim() : fromHeader.trim();
}

function extractName(fromHeader) {
  const match = fromHeader.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// VERZENDING
// ════════════════════════════════════════════════════════════════════════════

function cleanSubject(subject) {
  const prefixes = /^(\s*(?:Re|RE|Re|Fwd|FW|Antw|AW|Doorst|SV|VS|TR|REF?)\s*[:/-]\s*)+/;
  let cleaned = subject.replace(prefixes, '').trim();
  return cleaned || subject;
}

function sendReminder({ to, originalSubject, body, thread }) {
  const subject = `Re: ${cleanSubject(originalSubject)}`;

  if (CONFIG.DRY_RUN) {
    log(`[DRY-RUN] → ${to} | ${subject}`);
    log(`[DRY-RUN] Body:\n${body}`);
    return;
  }

  const options = {};
  if (thread) options.threadId = thread.getId();

  if (CONFIG.CREATE_DRAFTS) {
    GmailApp.createDraft(to, subject, body, options);
    log(`[DRAFT] → ${to} | ${subject}`);
  } else {
    GmailApp.sendEmail(to, subject, body, options);
    log(`[SENT] → ${to} | ${subject}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HOOFDFUNCTIE
// ════════════════════════════════════════════════════════════════════════════

function checkReminders() {
  // Stap 1: threads met reply auto pauzeren
  autoPauseOnReply();

  // Stap 2: reminders sturen voor niet-gepauzeerde threads
  const remindLabels = getRemindEveryIntervalLabels();
  if (remindLabels.length === 0) {
    log('[OK] Geen remind-every labels gevonden');
    return;
  }

  let totalSent = 0;

  remindLabels.forEach(label => {
    const intervalDays = getIntervalFromLabel(label.getName());
    if (!intervalDays) return;

    const threads = label.getThreads();
    let labelSent = 0;

    // Filter: skip on-hold threads
    const active = threads.filter(t => !hasOnHold(t));
    if (active.length === 0) return;

    log(`[CHECK] "${label.getName()}": ${active.length}/${threads.length} actief (${threads.length - active.length} on-hold)`);

    active.forEach(thread => {
      const referenceDate = getLastSentByMeDate(thread);
      const now = new Date();
      const elapsedDays = (now - referenceDate) / 86400000;

      if (elapsedDays < intervalDays) return;

      // Ontvanger
      const recipient = findReminderRecipient(thread);

      // Bronbericht
      const messages = thread.getMessages();
      let sourceMsg = messages[0];
      for (let i = 0; i < messages.length; i++) {
        const body = messages[i].getPlainBody();
        if (body && body.trim().length > 50) {
          sourceMsg = messages[i];
          break;
        }
      }

      const originalSubject = sourceMsg.getSubject();
      const snippet = sourceMsg.getPlainBody().substring(0, 500);

      // Taal en body
      const lang = detectLanguage(sourceMsg.getPlainBody());
      const body = generateReminderText(originalSubject, snippet, recipient.name, lang);

      // Versturen
      sendReminder({ to: recipient.email, originalSubject, body, thread });
      labelSent++;
    });

    log(`[DONE] ${label.getName()}: ${labelSent} herinnering(en)`);
    totalSent += labelSent;
  });

  log(`[SUMMARY] Totaal: ${totalSent} herinnering(en) verwerkt`);
}

// ════════════════════════════════════════════════════════════════════════════
// PREVIEW
// ════════════════════════════════════════════════════════════════════════════

function previewReminders() {
  const remindLabels = getRemindEveryIntervalLabels();

  if (remindLabels.length === 0) {
    log('Geen remind-every labels gevonden.');
    log('Maak ze aan in Gmail — bv. "remind-every/2weeks" — en plak ze op een bericht.');
    return;
  }

  const now = new Date();

  remindLabels.forEach(label => {
    const intervalDays = getIntervalFromLabel(label.getName());
    if (!intervalDays) return;

    const threads = label.getThreads();
    log(`\n══ ${label.getName()} (elke ${intervalDays} dagen) ══`);

    if (threads.length === 0) {
      log('  (geen threads met dit label)');
      return;
    }

    threads.forEach(thread => {
      const onHold = hasOnHold(thread);
      const referenceDate = getLastSentByMeDate(thread);
      const elapsedDays = (now - referenceDate) / 86400000;
      const due = !onHold && elapsedDays >= intervalDays;
      const remaining = Math.round(intervalDays - elapsedDays);

      const status = onHold
        ? '⏸ ON-HOLD'
        : due ? '🔴 NU'
        : `⏳ ${remaining} dagen`;

      const subject = thread.getFirstMessageSubject();
      const recipient = findReminderRecipient(thread);

      log(`  ${status} | laatst door mij: ${formatDateNL(referenceDate)} | → ${recipient.email} | ${subject}`);
    });
  });

  log(`\n══ Totaal: ${remindLabels.length} label(s) ══`);
}

// ════════════════════════════════════════════════════════════════════════════
// MANUEEL: pauzeer alle threads met reply
// ════════════════════════════════════════════════════════════════════════════

function pauseRepliedThreads() {
  autoPauseOnReply();
}

/** Verwijder on-hold van alle threads (alles hervatten) */
function resumeAll() {
  const onHoldLabel = GmailApp.getUserLabelByName(CONFIG.ON_HOLD);
  if (!onHoldLabel) {
    log('Geen on-hold label gevonden.');
    return;
  }
  const threads = onHoldLabel.getThreads();
  threads.forEach(t => t.removeLabel(onHoldLabel));
  log(`[RESUME] ${threads.length} draadje(s) hervat`);
}

// ════════════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════════════

function setup() {
  const examples = [
    'remind-every/1week',
    'remind-every/2weeks',
    'remind-every/3weeks',
    'remind-every/1month',
    'remind-every/3months',
    'remind-every/1year',
  ];

  // On-hold label maken
  getOrCreateLabel(CONFIG.ON_HOLD);

  // Intervallabels maken
  examples.forEach(name => getOrCreateLabel(name));

  // Triggers
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkReminders').timeBased().everyHours(6).create();

  log('Setup voltooid:');
  log(`  - Labels: ${examples.join(', ')}`);
  log(`  - On-hold: ${CONFIG.ON_HOLD}`);
  log('  - Trigger: checkReminders om de 6 uur');
  log('');
  log('Volgende stappen:');
  log('  1. Voeg GEMINI_API_KEY toe in Project Settings → Script Properties');
  log('  2. Plak een remind-every/* label op een e-mail in Gmail');
  log('  3. Run previewReminders() om te testen');
  log('  4. Run dryRun() om drafts te bekijken');
  log('  5. Zet CONFIG.CREATE_DRAFTS = false om live te gaan');
}

function dryRun() {
  const prevDry = CONFIG.DRY_RUN;
  const prevDrafts = CONFIG.CREATE_DRAFTS;

  CONFIG.DRY_RUN = false;
  CONFIG.CREATE_DRAFTS = true;

  checkReminders();

  CONFIG.DRY_RUN = prevDry;
  CONFIG.CREATE_DRAFTS = prevDrafts;
}

// ════════════════════════════════════════════════════════════════════════════
// HULPFUNCTIES
// ════════════════════════════════════════════════════════════════════════════

function formatDateNL(date) {
  return date.toLocaleDateString('nl-BE', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

function log(msg) {
  Logger.log(msg);
}
