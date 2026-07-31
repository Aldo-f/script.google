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
  LOG_FILE:      'LabelReminder.log',  // Log file in ~/dev/06-apps-script-google/logs/

  // AI Providers — waterfall: Gemini → FreeLLMAPI → OpenRouter → fallback template
  GEMINI_MODEL:       'gemini-2.5-flash',  // Latest free Gemini model
  FREE_LLM_API_URL:   'https://freellm.aldof.duckdns.org/v1/chat/completions',
  FREE_LLM_MODEL:     'auto',  // Uses latest available free model
  OPENROUTER_API_URL: 'https://openrouter.ai/api/v1/chat/completions',
  OPENROUTER_MODEL:   'inclusionai/ling-3.0-flash:free',  // Free model on OpenRouter

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
    try {
      const name = label.getName();
      if (name === CONFIG.ON_HOLD) return false;
      return name.startsWith(CONFIG.LABEL_PREFIX + '/') && getIntervalFromLabel(name) !== null;
    } catch (e) {
      log(`[WARN] Label error: ${e.message}`);
      return false;
    }
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

/**
 * Laatste bericht in de thread dat NIET door Aldo verzonden is.
 * Hiermee kunnen we een reply sturen op het bericht van de ontvanger,
 * zodat de reminder als een antwoord verschijnt (met quote van origineel).
 */
function getLastNonOwnMessage(thread) {
  const messages = thread.getMessages();
  for (let i = messages.length - 1; i >= 0; i--) {
    const from = messages[i].getFrom();
    if (!from.toLowerCase().includes(CONFIG.MY_EMAIL.toLowerCase())) {
      return messages[i];
    }
  }
  return null;
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
// AI REMINDER — uses callAI() from shared/AIProviders.gs
// ════════════════════════════════════════════════════════════════════════════

/**
 * Verwijdert AI-toelichting/redenering uit het antwoord.
 * Sommige modellen geven naast de body ook uitleg — dat wordt hier weggefilterd.
 */
function cleanAIResponse(text) {
  if (!text) return text;

  // Verwijder alles vanaf een standalone "---" lijn (sectiescheider)
  const sepIdx = text.search(/^---\s*$/m);
  if (sepIdx >= 0) {
    text = text.substring(0, sepIdx).trim();
  }

  // Verwijder markdown bold-kopjes zoals "**E-mailbody (max 100 woorden)**"
  text = text.replace(/^\*{2}.+\*{2}\s*$/gm, '').trim();

  // Verwijder lijnen die beginnen met "Redenering", "Toelichting", "Uitleg", etc.
  text = text.replace(/^#*\s*(Redenering|Toelichting|Uitleg|Explanation|Reasoning).*/gim, '').trim();

  // Maximaal 2 opeenvolgende newlines
  text = text.replace(/\n{3,}/g, '\n\n');

  return text;
}

// ════════════════════════════════════════════════════════════════════════════
// REMINDER COUNT TRACKING
// ════════════════════════════════════════════════════════════════════════════

/**
 * Get the number of reminders already sent for a thread
 */
function getReminderCount(threadId) {
  const props = PropertiesService.getScriptProperties();
  const key = `reminderCount_${threadId}`;
  const count = props.getProperty(key);
  return count ? parseInt(count, 10) : 0;
}

/**
 * Increment the reminder count for a thread
 */
function incrementReminderCount(threadId) {
  const props = PropertiesService.getScriptProperties();
  const key = `reminderCount_${threadId}`;
  const current = getReminderCount(threadId);
  props.setProperty(key, (current + 1).toString());
  return current + 1;
}

// ════════════════════════════════════════════════════════════════════════════
// TONE DETERMINATION BASED ON REMINDER COUNT AND FIRST MESSAGE DATE
// ════════════════════════════════════════════════════════════════════════════

function getToneFromContext(reminderCount, firstMessageDate) {
  const now = new Date();
  const daysSinceFirst = (now - firstMessageDate) / 86400000;

  // Combined logic: tone increases with both reminders sent AND time passed
  if (reminderCount >= 3 || daysSinceFirst > 60) {
    return 'zeer dringend, vastberaden en bezorgd over de veiligheid';
  } else if (reminderCount >= 1 || daysSinceFirst > 30) {
    return 'zakelijk, vastberaden en wijzend op het veiligheidsrisico';
  }
  return 'kort, vriendelijk en professioneel';
}

function generateReminderText(originalSubject, originalSnippet, senderName, lang, reminderCount, firstMessageDate) {
  const tone = getToneFromContext(reminderCount, firstMessageDate);

  const dossierMatch = originalSnippet.match(/KM-\d{4}-\d{5}/);
  const dossierInfo = dossierMatch ? `\n- Dossiernummer: ${dossierMatch[0]}` : '';

  const langInstruction = lang === 'nl'
      ? 'Schrijf de e-mail in het Nederlands.'
      : 'Write the email in English.';

  // Adjust tone instructions based on reminder count
  let toneInstruction = '';
  if (reminderCount >= 3) {
    toneInstruction = 'Wees zeer dringend, vastberaden en uitdrukkelijk bezorgd over de veiligheid. De situatie is al lang onopgelost en vormt een ernstig risico.';
  } else if (reminderCount >= 1) {
    toneInstruction = 'Wees zakelijk, vastberaden en wijzend op het veiligheidsrisico. Dit is geen eerste herinnering meer.';
  } else {
    toneInstruction = 'Schrijf een korte, vriendelijke herinneringsmail. Vraag beleefd of ze al de tijd hebben gehad om te antwoorden. Toon begrip, geen urgentie. Houd het kort en professioneel.';
  }

  const prompt = [
    langInstruction,
    '',
    toneInstruction,
    '',
    'BELANGRIJK: Geef ENKEL de e-mail body. Geen toelichting, geen uitleg,',
    'geen redenering, geen kopjes, geen markeringen, geen scheidingslijnen.',
    'Niet vertellen wat je gedaan hebt of waarom. Alleen de e-mail tekst zelf.',
    'Geen vetgedrukte tekst, geen opsommingen met nummers, geen markdown.',
    '',
    'Context:',
    `- Origineel onderwerp: "${originalSubject}"`,
    dossierInfo,
    `- Korte inhoud: "${originalSnippet.substring(0, 500)}"`,
    '',
    `Maximaal 100 woorden. Geen onderwerpregel.`,
    `Sluit af met "Met vriendelijke groeten,\n${CONFIG.SENDER_ALIAS}"`,
  ].join('\n');

  try {
    return cleanAIResponse(callAI(prompt));
  } catch (err) {
    log(`[WARN] All AI providers failed (${err.message}), using fallback`);
    return cleanAIResponse(buildFallbackText(senderName, originalSubject, lang));
  }
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
  // 1. Search for a sender that is neither us nor an ignored sender (e.g. AWV)
  const messages = thread.getMessages();
  for (const msg of messages) {
    const from = msg.getFrom();
    if (from.toLowerCase().includes(CONFIG.MY_EMAIL.toLowerCase())) continue;
    if (isIgnoredSender(from)) continue;
    return {
      email: extractEmail(from),
      name: extractName(from) || 'there',
    };
  }
  // 2. If no appropriate sender found, fall back to the primary recipient in the To field
  const firstMsg = messages[0];
  const toField = firstMsg.getTo();
  // Extract all email addresses from the To field (handles "Name <email>" format)
  const emails = extractAllEmails(toField);
  for (const email of emails) {
    const lower = email.toLowerCase();
    if (lower.includes(CONFIG.MY_EMAIL.toLowerCase())) continue;
    if (isIgnoredSender(email)) continue;
    return { email: email, name: 'there' };
  }
  // 3. As a last resort, return the To field as-is
  return { email: extractEmail(toField), name: 'there' };
}

/**
 * Extract all email addresses from a header field (To, Cc, From).
 * Handles "Name <email>" format and bare email addresses.
 */
function extractAllEmails(header) {
  // 1. Try to find all <email> patterns
  const angleMatches = [...header.matchAll(/<([^>]+)>/g)];
  if (angleMatches.length > 0) {
    return angleMatches.map(m => m[1].trim());
  }
  // 2. Fallback: find bare email pattern
  const bareMatches = header.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  return bareMatches ? bareMatches.map(m => m.trim()) : [];
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
  const prefixes = /^(\s*(?:Re|RE|Re|Fwd|FW|Antw|AW|AWV|Doorst|SV|VS|TR|REF?)\s*[:/-]\s*)+/;
  let cleaned = subject.replace(prefixes, '').trim();
  return cleaned || subject;
}

/**
 * Maakt een draft (of verzendt) via de Gmail API met aangepaste ontvanger,
 * maar wel in dezelfde thread (met In-Reply-To voor correcte threading).
 */
function createReplyDraft(toEmail, subject, body, rfcMessageId, threadId) {
  const token = ScriptApp.getOAuthToken();
  const rawMessage = [
    'To: ' + toEmail,
    'Subject: ' + subject,
    'Content-Type: text/plain; charset=UTF-8',
    'MIME-Version: 1.0',
    'In-Reply-To: ' + rfcMessageId,
    'References: ' + rfcMessageId,
    '',
    body,
  ].join('\r\n');

  const raw = Utilities.base64EncodeWebSafe(
    Utilities.newBlob(rawMessage, 'UTF-8').getBytes()
  );

  const isDraft = CONFIG.CREATE_DRAFTS;
  const endpoint = isDraft
    ? 'https://gmail.googleapis.com/gmail/v1/users/me/drafts'
    : 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

  const payload = isDraft
    ? JSON.stringify({ message: { raw: raw, threadId: threadId } })
    : JSON.stringify({ raw: raw, threadId: threadId });

  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    headers: { Authorization: 'Bearer ' + token },
    contentType: 'application/json',
    payload: payload,
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('Gmail API error: ' + response.getContentText());
  }
}

function sendReminder({ to, originalSubject, body, thread }) {
  const replyToMsg = thread ? getLastNonOwnMessage(thread) : null;

  if (replyToMsg) {
    if (isIgnoredSender(replyToMsg.getFrom())) {
      // Bericht van AWV (of andere genegeerde afzender) → reply naar de echte ontvanger
      // via de Gmail API, zodat het in dezelfde thread blijft
      const subject = `Re: ${cleanSubject(originalSubject)}`;

      if (CONFIG.DRY_RUN) {
        log(`[DRY-RUN] (API reply) → ${to} | ${subject} | thread: ${thread.getId()}`);
        log(`[DRY-RUN] Body:\n${body}`);
        return;
      }

      // Haal het RFC 2822 Message‑ID op via de Gmail API voor correcte threading
      try {
        const rfcMsgId = getRfcMessageId(replyToMsg.getId());
        createReplyDraft(to, subject, body, rfcMsgId, thread.getId());
        log(`${CONFIG.CREATE_DRAFTS ? '[DRAFT]' : '[SENT]'} (API reply) → ${to} | ${subject}`);
        log(`Body: ${body.replace(/\n/g, ' ').substring(0, 150)}...`);  // Log email body preview for review
      } catch (err) {
        log(`[WARN] Gmail API failed (${err.message}), fallback to createDraft`);
        GmailApp.createDraft(to, subject, body, { threadId: thread.getId() });
        log(`[DRAFT] (fallback) → ${to} | ${subject}`);
        log(`Body: ${body.replace(/\n/g, ' ').substring(0, 150)}...`);  // Log email body preview for review
      }
      return;
    }

    // Normale reply (niet genegeerd)
    if (CONFIG.DRY_RUN) {
      log(`[DRY-RUN] (reply) → ${replyToMsg.getFrom()} | Re: ${originalSubject}`);
      log(`[DRY-RUN] Body:\n${body}`);
      return;
    }
    if (CONFIG.CREATE_DRAFTS) {
      replyToMsg.createDraftReply(body);
      log(`[DRAFT] (reply) → ${replyToMsg.getFrom()} | Re: ${originalSubject}`);
      log(`Body: ${body.replace(/\n/g, ' ').substring(0, 150)}...`);  // Log email body preview for review
    } else {
      replyToMsg.reply(body);
      log(`[SENT] (reply) → ${replyToMsg.getFrom()} | Re: ${originalSubject}`);
      log(`Body: ${body.replace(/\n/g, ' ').substring(0, 150)}...`);  // Log email body preview for review
    }
    return;
  }

  // Helemaal geen reply‑bericht → nieuwe mail
  const subject = `Re: ${cleanSubject(originalSubject)}`;
  const options = {};
  if (thread) options.threadId = thread.getId();

  if (CONFIG.DRY_RUN) {
    log(`[DRY-RUN] → ${to} | ${subject}`);
    log(`[DRY-RUN] Body:\n${body}`);
    return;
  }

  if (CONFIG.CREATE_DRAFTS) {
    GmailApp.createDraft(to, subject, body, options);
    log(`[DRAFT] → ${to} | ${subject}`);
    log(`Body: ${body.replace(/\n/g, ' ').substring(0, 150)}...`);  // Log email body preview for review
  } else {
    GmailApp.sendEmail(to, subject, body, options);
    log(`[SENT] → ${to} | ${subject}`);
    log(`Body: ${body.replace(/\n/g, ' ').substring(0, 150)}...`);  // Log email body preview for review
  }
}

/**
 * Haalt het RFC 2822 Message‑ID van een bericht op via de Gmail API.
 */
function getRfcMessageId(gmailMessageId) {
  const token = ScriptApp.getOAuthToken();
  const response = UrlFetchApp.fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMessageId}?format=metadata&metadataHeaders=Message-ID`,
    {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true,
    }
  );
  if (response.getResponseCode() !== 200) {
    throw new Error('Gmail API getMessage error: ' + response.getContentText());
  }
  const data = JSON.parse(response.getContentText());
  // Zoek de Message-ID header
  const headers = data.payload?.headers || [];
  const msgIdHeader = headers.find(h => h.name === 'Message-ID');
  return {
    gmailId: data.id,
    rfcId: msgIdHeader ? msgIdHeader.value : `<${data.id}@gmail.com>`,
  };
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
      const reminderCount = getReminderCount(thread.getId());
      const firstMessageDate = getLastSentByMeDate(thread);
      const body = generateReminderText(originalSubject, snippet, recipient.name, lang, reminderCount, firstMessageDate);

      // Versturen (met bronbericht voor forward-context)
      sendReminder({ to: recipient.email, originalSubject, body, thread });
      incrementReminderCount(thread.getId());
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
  log('  1. Voeg GEMINI_API_KEY toe in Project Settings → Script Properties (komma-gescheiden voor meerdere keys)');
  log('  2. Voeg FREE_LLM_API_KEY toe in Project Settings → Script Properties (fallback provider)');
  log('  3. Plak een remind-every/* label op een e-mail in Gmail');
  log('  4. Run previewReminders() om te testen');
  log('  5. Run dryRun() om drafts te bekijken');
  log('  6. Zet CONFIG.CREATE_DRAFTS = false om live te gaan');
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
  // Write to local log file when running from repository
  // Note: Apps Script cannot directly write to local filesystem
  // Use `clasp tail-logs --simplified > logs/LabelReminder.log` to capture
}
