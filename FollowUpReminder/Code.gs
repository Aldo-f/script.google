// Required OAuth scopes — forces Apps Script to request all permissions upfront
/* global DriveApp, DocumentApp, GmailApp, UrlFetchApp, PropertiesService, ScriptApp, Utilities */

/**
 * FollowUpReminder.gs
 *
 * Every Tuesday: sends one combined digest per watchlist address.
 * After ESCALATE_AFTER digests, escalates with a single combined PDF.
 *
 * SETUP:
 *   1. script.google.com → New project → paste this file
 *   2. Project Settings → Script Properties → add GEMINI_API_KEY
 *   3. Run setup() once
 *   4. Run dryRun() to verify — creates drafts without sending
 *   5. Set CREATE_DRAFTS: false to send automatically
 */

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const CONFIG = {
  DRY_RUN:        false,
  CREATE_DRAFTS:  false,
  WAIT_DAYS:      7,
  ESCALATE_AFTER: 3,
  MY_EMAIL:       'aldo.fieuw@gmail.com',
  AWV_SENDER:     'klantendienst-awv@wegenenverkeer.be',

  DIGEST_SUBJECT_PREFIX: 'Opvolgingsoverzicht openstaande meldingen',

  LABELS: {
    PREFIX:    'FollowUp',
    ESCALATED: 'FollowUp/Escalated',
    CLOSED:    'FollowUp/Closed',
  },

  TICKET_REGEX: /[A-Z]{2,}-\d{4,}/g,

  // AI Providers — waterfall: FreeLLMAPI first, then Gemini
  FREE_LLM_API_URL: 'https://freellm.aldof.duckdns.org/v1/chat/completions',
  FREE_LLM_API_KEY: 'freellmapi-6887a86f4be99b516b912283dde20d7eb4ead65e3d0ae312',
  FREE_LLM_MODEL:   'auto',
  GEMINI_MODEL:     'gemini-2.0-flash',

  WATCHLIST: [
    {
      address:         'mobiliteit@merelbeke-melle.be',
      escalateTo:      'hannah.gevers@merelbeke-melle.be',
      escalateCc:      ['klantendienst-awv@wegenenverkeer.be'],
      escalateSubject: 'Escalatie: herhaaldelijk onbeantwoorde AWV-meldingen',
    },
    // {
    //   address:         'openbarewerken@nazarethdepinte.be',
    //   escalateTo:      'diensthoofd@nazarethdepinte.be',
    //   escalateCc:      ['klantendienst-awv@wegenenverkeer.be'],
    //   escalateSubject: 'Escalatie: herhaaldelijk onbeantwoorde AWV-meldingen',
    // },
  ],
};

// ─── AWV DOSSIER QUERY ───────────────────────────────────────────────────────

/**
 * Returns a Gmail query that matches only genuine AWV forwarded dossiers —
 * i.e. emails sent by AWV to the watchlist address with Aldo in CC.
 * Excludes digest reminder emails (also sent to watchlist with Aldo in CC).
 */
function awvDossierQuery(address, extra) {
  const base = `from:${CONFIG.AWV_SENDER} to:${address} cc:${CONFIG.MY_EMAIL}`;
  return extra ? `${base} ${extra}` : base;
}

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────

function checkDigests() {
  syncLabels();
  processFollowUps({ doDigest: true, doEscalate: false });
}

function checkEscalations() {
  syncLabels();
  processFollowUps({ doDigest: false, doEscalate: true });
}

function processFollowUps({ doDigest, doEscalate }) {
  const escalatedLabel = getOrCreateLabel(CONFIG.LABELS.ESCALATED);
  const escalatedIds   = getLabeledThreadIds(escalatedLabel);
  const closedIds      = getLabeledThreadIds(getOrCreateLabel(CONFIG.LABELS.CLOSED));
  const cutoff         = daysAgo(CONFIG.WAIT_DAYS);

  CONFIG.WATCHLIST.forEach(entry => {
    const countMap = buildReminderCountMap(entry.address);
    const pending  = collectPending(entry.address, cutoff, escalatedIds, closedIds, countMap);

    if (pending.length === 0) {
      log(`[OK] No pending dossiers for ${entry.address}`);
      return;
    }

    const toEscalate = pending.filter(p =>
      p.reminderCount >= CONFIG.ESCALATE_AFTER &&
      !escalatedIds.has(p.thread.getId())
    );

    if (doEscalate && toEscalate.length > 0) {
      sendEscalation(entry, toEscalate, escalatedLabel);
    }

    if (doDigest && pending.length > 0) {
      sendDigest(entry.address, pending);
    }
  });
}

function syncLabels() {
  const closedLabel    = getOrCreateLabel(CONFIG.LABELS.CLOSED);
  const escalatedLabel = getOrCreateLabel(CONFIG.LABELS.ESCALATED);

  CONFIG.WATCHLIST.forEach(entry => {
    const countMap = buildReminderCountMap(entry.address);
    const threads  = GmailApp.search(awvDossierQuery(entry.address));

    threads.forEach(thread => {
      if (thread.getLabels().some(l => l.getName() === closedLabel.getName())) return;

      const subject    = subjectOf(thread);
      const ticketCode = extractTicketCode(subject);
      if (!ticketCode || !countMap.has(ticketCode)) return;

      const count = countMap.get(ticketCode) || 0;

      applyCorrectLabel(thread, count, escalatedLabel);
    });
  });

  log('[SYNC] Labels bijgewerkt');
}

function applyCorrectLabel(thread, count, escalatedLabel) {
  const closedLabel = getOrCreateLabel(CONFIG.LABELS.CLOSED);
  const labels      = thread.getLabels();

  const isEscalated = labels.some(l => l.getName() === escalatedLabel.getName());
  const isClosed    = labels.some(l => l.getName() === closedLabel.getName());

  labels
    .filter(l => {
      const name = l.getName();
      return (
        name.startsWith(CONFIG.LABELS.PREFIX + '/') &&
        name !== CONFIG.LABELS.ESCALATED &&
        name !== CONFIG.LABELS.CLOSED
      );
    })
    .forEach(l => thread.removeLabel(l));

  if (isEscalated || isClosed || count === 0) return;

  const label = getOrCreateLabel(`${CONFIG.LABELS.PREFIX}/${count}`);
  thread.addLabel(label);
}

// ─── REMINDER COUNT MAP ───────────────────────────────────────────────────────

/**
 * Scans sent digest emails to `address` and counts how many times
 * each ticket code appeared. Returns Map<ticketCode, count>.
 *
 * Single source of truth for reminder counts — no labels needed,
 * works retroactively on existing sent mails.
 */
const countMapCache = {};

function buildReminderCountMap(address) {
  if (countMapCache[address]) return countMapCache[address];

  const query   = `from:${CONFIG.MY_EMAIL} to:${address} subject:"${CONFIG.DIGEST_SUBJECT_PREFIX}"`;
  const threads = GmailApp.search(query);
  const map     = new Map();

  threads.forEach(thread => {
    thread.getMessages().forEach(msg => {
      const body    = msg.getPlainBody();
      const matches = body.match(CONFIG.TICKET_REGEX) || [];
      // Deduplicate per message to avoid double-counting within one digest
      [...new Set(matches)].forEach(code => {
        map.set(code, (map.get(code) || 0) + 1);
      });
    });
  });

  log(`[COUNT MAP] Built for ${address}: ${map.size} ticket(s) tracked`);

  countMapCache[address] = map;
  return map;
}

// ─── COLLECT PENDING ─────────────────────────────────────────────────────────

function collectPending(address, cutoff, escalatedIds, closedIds, countMap) {
  const query   = awvDossierQuery(address, `before:${formatDate(cutoff)}`);
  const threads = GmailApp.search(query);

  return threads.reduce((acc, thread) => {
    if (closedIds.has(thread.getId()))    return acc;
    // REMOVED: escalated threads stay in rotation — only closed is excluded

    const subject    = subjectOf(thread);
    const ticketCode = extractTicketCode(subject);

    if (hasReply(thread, address)) {
      // thread.addLabel(getOrCreateLabel(CONFIG.LABELS.CLOSED));
      return acc;
    }

    if (ticketCode && hasCrossThreadReply(ticketCode, thread.getId(), address)) {
      // thread.addLabel(getOrCreateLabel(CONFIG.LABELS.CLOSED));
      return acc;
    }

    const original      = thread.getMessages()[0];
    const reminderCount = countMap.get(ticketCode) || 0;

    acc.push({
      thread,
      subject,
      ticketCode,
      reminderCount,
      sentDate: original.getDate(),
      context:  extractMailContext(original.getPlainBody()),
    });

    return acc;
  }, []);
}

// ─── DELIVERY ─────────────────────────────────────────────────────────────────

/**
 * Single delivery handler. Respects DRY_RUN and CREATE_DRAFTS.
 * onSent is called only after an actual send (not draft/dry-run).
 */
function deliverEmail({ to, subject, body, cc, attachments }, onSent) {
  if (CONFIG.DRY_RUN) {
    log(`[DRY-RUN] → ${to} | ${subject}`);
    log(`[DRY-RUN] Body:\n${body}`);
    if (attachments) attachments.forEach(a => log(`[DRY-RUN] Attachment: ${a.getName()}`));
    return;
  }

  const options = { cc, attachments };

  if (CONFIG.CREATE_DRAFTS) {
    GmailApp.createDraft(to, subject, body, options);
    log(`[DRAFT] → ${to} | ${subject}`);
  } else {
    GmailApp.sendEmail(to, subject, body, options);
    log(`[SENT] → ${to} | ${subject}`);
    if (onSent) onSent();
  }
}

function sendDigest(toAddress, pending) {
  deliverEmail({
    to:          toAddress,
    subject:     `${CONFIG.DIGEST_SUBJECT_PREFIX} — ${formatDateDisplay(new Date())}`,
    body:        rewriteWithLlm(buildFallbackDigest(pending)),
    cc:          CONFIG.MY_EMAIL,
    attachments: [buildCombinedPdf(pending)],
  });
}

function sendEscalation(entry, pending, escalatedLabel) {
  deliverEmail({
    to:          entry.escalateTo,
    subject:     entry.escalateSubject,
    body:        rewriteWithLlm(buildEscalationBody(entry, pending)),
    cc:          [CONFIG.MY_EMAIL, ...(entry.escalateCc || [])].join(','),
    attachments: [buildCombinedPdf(pending)],
  }, () => {
    pending.forEach(({ thread }) => thread.addLabel(escalatedLabel));
  });
}

// ─── LLM REWRITE — WATERFALL (FreeLLMAPI → Gemini) ─────────────────────────────

/**
 * Parse comma-separated GEMINI_API_KEY from Script Properties.
 * "key1,key2,key3" → ["key1", "key2", "key3"]
 */
function getGeminiApiKeys() {
  const raw = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!raw) return [];
  return raw.split(',').map(k => k.trim()).filter(k => k.length > 0);
}

/**
 * Call FreeLLMAPI (OpenAI-compatible).
 * Returns text on success, throws on failure.
 */
function callFreeLLM(prompt) {
  const url = CONFIG.FREE_LLM_API_URL;
  const apiKey = CONFIG.FREE_LLM_API_KEY;
  const model = CONFIG.FREE_LLM_MODEL;

  if (!url || !apiKey) {
    throw new Error('FreeLLMAPI not configured');
  }

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    payload: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
      temperature: 0.7,
    }),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  const body = response.getContentText();

  if (code !== 200) {
    throw new Error(`FreeLLMAPI HTTP ${code}: ${body}`);
  }

  const parsed = JSON.parse(body);
  const text = parsed.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('FreeLLMAPI: empty response');
  return text;
}

/**
 * Call Gemini with multi-key fallback.
 * Returns text on success, throws if all keys fail.
 */
function callGemini(prompt) {
  const keys = getGeminiApiKeys();
  if (keys.length === 0) throw new Error('No GEMINI_API_KEY configured');

  const model = CONFIG.GEMINI_MODEL;

  for (const apiKey of keys) {
    try {
      const response = UrlFetchApp.fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'post',
          headers: { 'Content-Type': 'application/json' },
          payload: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 800, temperature: 0.7 },
          }),
          muteHttpExceptions: true,
        }
      );

      const code = response.getResponseCode();
      const body = response.getContentText();

      if (code !== 200) {
        throw new Error(`Gemini HTTP ${code}: ${body}`);
      }

      const result = JSON.parse(body)
        .candidates[0].content.parts[0].text.trim();
      return result;
    } catch (err) {
      log(`[WARN] Gemini key failed (${err.message}), trying next...`);
    }
  }
  throw new Error(`All ${keys.length} Gemini keys failed`);
}

/**
 * Waterfall: try FreeLLMAPI first, then Gemini multi-key.
 * Returns AI text or throws if all fail.
 */
function callAI(prompt) {
  // 1. Try FreeLLMAPI
  try {
    const text = callFreeLLM(prompt);
    log('[AI] FreeLLMAPI success');
    return text;
  } catch (err) {
    log(`[WARN] FreeLLMAPI failed: ${err.message}, falling back to Gemini`);
  }

  // 2. Try Gemini (multi-key)
  try {
    const text = callGemini(prompt);
    log('[AI] Gemini success');
    return text;
  } catch (err) {
    log(`[WARN] Gemini failed: ${err.message}`);
  }

  // 3. All failed
  throw new Error('All AI providers failed');
}

/**
 * Rewrites a fallback-generated email body using AI (waterfall) to make it
 * sound more natural, while preserving all factual content.
 * Falls back to the original body if all AI providers fail.
 */
function rewriteWithLlm(body) {
  const prompt = [
    'Herschrijf de onderstaande e-mail in een meer persoonlijke, menselijke schrijfstijl.',
    'Behoud alle feitelijke informatie exact (referentienummers, datums, locaties, aantallen).',
    'Maak de toon vriendelijk maar professioneel.',
    'Geen onderwerpregel, enkel de bodytekst.',
    'Sluit af op dezelfde manier als het origineel (Met vriendelijke groeten, Aldo Fieuw).',
    '',
    'Originele e-mail:',
    body,
  ].join('\n');

  try {
    return callAI(prompt);
  } catch (err) {
    log(`[WARN] All AI providers failed (${err.message}), using fallback body`);
    return body;
  }
}

// ─── PDF GENERATION ──────────────────────────────────────────────────────────

/**
 * Builds one Google Doc with all dossiers (one per page), exports as PDF,
 * then deletes the temporary Doc.
 *
 * The AWV email body structure is:
 *   [AWV boilerplate]
 *   Contactgegevens van de afzender: (Aldo's details — omitted)
 *   ----
 *   Locatiegegevens: (kept)
 *   Berichten: (kept — contains complaint text)
 *
 * We slice from 'Locatiegegevens:' to keep location + complaint,
 * dropping both the AWV boilerplate and Aldo's personal contact block.
 */
function buildCombinedPdf(pending) {
  const doc     = DocumentApp.create(`Meldingen_${formatDate(new Date())}`);
  const docBody = doc.getBody();

  pending.forEach(({ ticketCode, sentDate, subject, thread }, i) => {
    if (i > 0) docBody.appendPageBreak();

    const ref      = ticketCode || 'onbekend';
    const mailBody = thread.getMessages()[0].getPlainBody();
    const cutAt    = mailBody.indexOf('Locatiegegevens:');
    const cleanBody = cutAt > -1 ? mailBody.slice(cutAt).trim() : mailBody;

    docBody.appendParagraph(`Dossier: ${ref}`)
           .setHeading(DocumentApp.ParagraphHeading.HEADING1);
    docBody.appendParagraph(`Doorgestuurd op: ${sentDate.toLocaleDateString('nl-BE')}`);
    docBody.appendParagraph(`Onderwerp: ${subject}`);
    docBody.appendParagraph(`Gegenereerd op: ${new Date().toLocaleDateString('nl-BE')}`);
    docBody.appendHorizontalRule();
    docBody.appendParagraph('Originele melding')
           .setHeading(DocumentApp.ParagraphHeading.HEADING2);
    docBody.appendParagraph(cleanBody);
  });

  doc.saveAndClose();

  const file = DriveApp.getFileById(doc.getId());
  const pdf  = file.getAs('application/pdf')
                   .setName(`Meldingen_${formatDate(new Date())}.pdf`);
  file.setTrashed(true);

  return pdf;
}

// ─── BODY BUILDERS ───────────────────────────────────────────────────────────

/**
 * Groups pending dossiers by date. Pure function.
 */
function buildGroupedOverview(pending) {
  const now    = new Date();
  const groups = {};

  pending.forEach(({ ticketCode, sentDate, reminderCount }) => {
    const dateKey   = sentDate.toLocaleDateString('nl-BE');
    const daysOld   = Math.floor((now - sentDate) / 86400000);
    const ref       = ticketCode || 'geen ref';
    const countNote = reminderCount > 0 ? ` [${reminderCount}e herinnering]` : '';

    if (!groups[dateKey]) groups[dateKey] = { daysOld, refs: [] };
    groups[dateKey].refs.push(`${ref}${countNote}`);
  });

  const parseNlDate = d => {
    const [dd, mm, yy] = d.split('/');
    return new Date(yy, mm - 1, dd);
  };

  return Object.entries(groups)
    .sort(([a], [b]) => parseNlDate(a) - parseNlDate(b))
    .map(([date, { daysOld, refs }]) => {
      const label = refs.length === 1 ? 'melding' : 'meldingen';
      return `- ${date} (${refs.length} ${label}, ${daysOld} dagen): ${refs.join(', ')}`;
    })
    .join('\n');
}

function buildFallbackDigest(pending) {
  return [
    'Geachte,',
    '',
    'Hierbij een overzicht van de meldingen die ik via AWV aan uw dienst doorzond',
    'en waarop ik tot op heden nog geen reactie of statusupdate ontving:',
    '',
    buildGroupedOverview(pending),
    '',
    'Mag ik u vriendelijk verzoeken de openstaande dossiers op te volgen',
    'en mij per dossier op de hoogte te stellen van de huidige status?',
    '',
    'Met vriendelijke groeten,',
    'Aldo Fieuw',
  ].join('\n');
}

function buildEscalationBody(entry, pending) {
  const items = pending.map(({ ticketCode, sentDate, context, reminderCount }, i) => {
    const ref      = ticketCode || '—';
    const date     = sentDate.toLocaleDateString('nl-BE');
    const location = context.location || '(locatie onbekend)';
    return `  ${i + 1}. Ref. ${ref} — ${date} — ${location} (${reminderCount}x herinnerd)`;
  }).join('\n');

  return [
    `Geachte mevrouw Gevers,`,
    ``,
    `Via AWV werden de volgende meldingen doorgestuurd naar ${entry.address}.`,
    `Na ${CONFIG.ESCALATE_AFTER} herhaalde verzoeken om opvolging bleef een reactie uit.`,
    ``,
    `Ik escaleer deze dossiers naar u als diensthoofd en stel AWV in kennis`,
    `zodat zij op de hoogte zijn van het gebrek aan opvolging.`,
    ``,
    `Openstaande dossiers (bijgevoegde PDF):`,
    items,
    ``,
    `Mag ik u vriendelijk verzoeken deze dossiers dringend op te nemen`,
    `en mij te informeren over de verdere aanpak?`,
    ``,
    `Met vriendelijke groeten,`,
    `Aldo Fieuw`,
  ].join('\n');
}

// ─── MAIL PARSING ────────────────────────────────────────────────────────────

function extractMailContext(body) {
  return {
    location:   extractLocation(body),
    complaint:  extractComplaint(body),
    ticketCode: extractTicketCodeFromBody(body),
  };
}

function extractLocation(body) {
  const match = body.match(/Adres:\s*(.+)/);
  if (!match) return null;
  const value = match[1].trim();
  if (!value ||
      value.startsWith('Weglocatie') ||
      value.startsWith('Andere') ||
      value.startsWith('Extra')) return null;
  return value;
}

function extractComplaint(body) {
  const blocks = body.split('Inkomend bericht van');
  if (blocks.length < 2) return null;
  const lastBlock = blocks[blocks.length - 1];
  const content   = lastBlock.replace(/^[^\n]*\n[^\n]*\n/, '').trim();
  const cutAt     = content.indexOf('---');
  return cutAt > -1 ? content.slice(0, cutAt).trim() : content.trim();
}

function extractTicketCodeFromBody(body) {
  const match = body.match(/[A-Z]{2,}-\d{4}-\d{4,}/);
  return match ? match[0] : null;
}

// ─── REPLY DETECTION ─────────────────────────────────────────────────────────

function hasReply(thread, watchedAddress) {
  return thread.getMessages().slice(1).some(msg => {
    const from = msg.getFrom().toLowerCase();
    return !from.includes(CONFIG.MY_EMAIL.toLowerCase()) &&
           !from.includes('wegenenverkeer.be');
  });
}

function hasCrossThreadReply(ticketCode, originalThreadId, watchedAddress) {
  return GmailApp.search(`"${ticketCode}"`)
    .filter(thread => thread.getId() !== originalThreadId)
    .some(thread =>
      thread.getMessages().some(msg =>
        msg.getFrom().toLowerCase().includes(watchedAddress.toLowerCase())
      )
    );
}

// ─── PREVIEW ─────────────────────────────────────────────────────────────────

function previewPending() {
  const escalatedLabel = getOrCreateLabel(CONFIG.LABELS.ESCALATED);
  const escalatedIds   = getLabeledThreadIds(escalatedLabel);
  const cutoff         = daysAgo(CONFIG.WAIT_DAYS);
  const now            = new Date();

  CONFIG.WATCHLIST.forEach(({ address }) => {
    const countMap = buildReminderCountMap(address);
    const threads  = GmailApp.search(awvDossierQuery(address));
    const rows     = { PENDING: [], DUE: [], ESCALATE: [], REPLIED: [] };

    threads.forEach(thread => {
      const subject  = subjectOf(thread);
      const sentDate = thread.getMessages()[0].getDate();
      const daysOld  = Math.floor((now - sentDate) / 86400000);
      const ticket   = extractTicketCode(subject) || '—';
      const count    = countMap.get(ticket) || 0;
      const label    = `${ticket} | ${daysOld}d | reminded:${count}x | ${subject}`;

      if (escalatedIds.has(thread.getId())) {
        rows.ESCALATE.push(label);
      } else if (hasReply(thread, address)) {
        rows.REPLIED.push(label);
      } else if (ticket !== '—' && hasCrossThreadReply(ticket, thread.getId(), address)) {
        rows.REPLIED.push(`${label} (cross-thread)`);
      } else if (sentDate < cutoff) {
        rows[count >= CONFIG.ESCALATE_AFTER ? 'ESCALATE' : 'DUE'].push(label);
      } else {
        rows.PENDING.push(label);
      }
    });

    log(`\n══ ${address} ══`);
    log(`  ⏳ PENDING   (${rows.PENDING.length}) — nog geen ${CONFIG.WAIT_DAYS} dagen:`);
    rows.PENDING.forEach(r => log(`     ${r}`));
    log(`  🔴 DUE       (${rows.DUE.length}) — volgende digest:`);
    rows.DUE.forEach(r => log(`     ${r}`));
    log(`  🚨 ESCALATE  (${rows.ESCALATE.length}) — klaar voor escalatie:`);
    rows.ESCALATE.forEach(r => log(`     ${r}`));
    log(`  ✅ REPLIED   (${rows.REPLIED.length}) — antwoord ontvangen:`);
    rows.REPLIED.forEach(r => log(`     ${r}`));
  });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function extractTicketCode(subject) {
  const matches = subject.match(CONFIG.TICKET_REGEX);
  return matches ? matches[0] : null;
}

function subjectOf(thread)      { return thread.getFirstMessageSubject(); }
function log(msg)               { Logger.log(msg); }
function getOrCreateLabel(name) { return GmailApp.getUserLabelByName(name) ?? GmailApp.createLabel(name); }

function getLabeledThreadIds(label) {
  const ids = new Set();
  label.getThreads().forEach(t => ids.add(t.getId()));
  return ids;
}

function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

function formatDateDisplay(date) {
  return date.toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ─── TEST HELPERS (used by FollowUpReminder.test.gs) ─────────────────────────

function buildReminderPrompt(context, subject, toAddress, sentDate) {
  const lines = [
    'Schrijf een korte, professionele herinneringsmail in het Nederlands.',
    'De ontvanger heeft een doorgestuurde melding niet beantwoord.',
    'Verwijs concreet naar de inhoud van de melding.',
    'Toon begrip maar vraag duidelijk om opvolging.',
    'Sluit af met "Met vriendelijke groeten,\nAldo Fieuw".',
    'Geen onderwerpregel, enkel de bodytekst. Maximaal 150 woorden.',
    '',
    `Doorgestuurd op: ${sentDate}`,
    `Onderwerp: ${subject}`,
  ];
  if (context.ticketCode) lines.push(`Referentie: ${context.ticketCode}`);
  if (context.location)   lines.push(`Locatie: ${context.location}`);
  if (context.complaint)  lines.push(`Melding:\n${context.complaint}`);
  return lines.join('\n');
}

function buildFallbackReminder(context, subject, sentDate) {
  const ref      = context.ticketCode ? ` (ref. ${context.ticketCode})` : '';
  const location = context.location   ? `\nLocatie: ${context.location}` : '';
  return [
    `Geachte,`, ``,
    `Op ${sentDate} ontving u een doorgestuurde melding via AWV${ref}`,
    `met als onderwerp "${subject}".${location}`,
    ``,
    `Tot op heden ontving ik nog geen reactie of statusupdate.`,
    `Mag ik u vriendelijk verzoeken dit dossier op te volgen`,
    `en mij op de hoogte te stellen van het verdere verloop?`,
    ``,
    `Met vriendelijke groeten,`,
    `Aldo Fieuw`,
  ].join('\n');
}

// ─── ESCALATION DRAFT TEST ────────────────────────────────────────────────────

/**
 * Manually triggers an escalation draft using real threads from Gmail.
 * Always creates a draft regardless of DRY_RUN/CREATE_DRAFTS settings.
 * Run once to verify PDF generation, then delete the draft.
 */
function testEscalationDraft() {
  const ESCALATION_TEST_COUNT = 3;
  const entry        = CONFIG.WATCHLIST[0];
  const countMap     = buildReminderCountMap(entry.address);
  const escalatedIds = getLabeledThreadIds(getOrCreateLabel(CONFIG.LABELS.ESCALATED));
  const closedIds    = getLabeledThreadIds(getOrCreateLabel(CONFIG.LABELS.CLOSED));
  const pending      = collectPending(entry.address, daysAgo(CONFIG.WAIT_DAYS), escalatedIds, closedIds, countMap)
                         .slice(0, ESCALATION_TEST_COUNT);

  if (pending.length === 0) {
    log('[TEST] No pending dossiers found.');
    return;
  }

  log(`[TEST] Building escalation draft with ${pending.length} dossier(s)...`);

  const pdf    = buildCombinedPdf(pending);
  const body   = rewriteWithLlm(buildEscalationBody(entry, pending));
  const ccList = [CONFIG.MY_EMAIL, ...(entry.escalateCc || [])].join(',');

  GmailApp.createDraft(entry.escalateTo, `[TEST] ${entry.escalateSubject}`, body, {
    cc: ccList, attachments: [pdf],
  });

  log(`[TEST] Draft → ${entry.escalateTo} | PDF: ${pdf.getName()}`);
}

// ─── SETUP ───────────────────────────────────────────────────────────────────

function setup() {
  getOrCreateLabel(CONFIG.LABELS.ESCALATED);
  [1, 2, 3, 4].forEach(n => getOrCreateLabel(`${CONFIG.LABELS.PREFIX}/${n}`));

  ScriptApp.getProjectTriggers()
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('checkDigests')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.TUESDAY)
    .atHour(8)
    .create();

  ScriptApp.newTrigger('checkEscalations')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.THURSDAY)
    .atHour(9)
    .create();

  ScriptApp.newTrigger('syncLabels')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();

  log('Setup complete: digest + escalation scheduled separately.');
}

/**
 * Creates drafts for all pending digests and escalations without sending.
 * Use this to review everything before going live.
 */
function dryRun() {
  const prevDry    = CONFIG.DRY_RUN;
  const prevDrafts = CONFIG.CREATE_DRAFTS;

  CONFIG.DRY_RUN       = false;
  CONFIG.CREATE_DRAFTS = true;

  checkDigests();
  checkEscalations();

  CONFIG.DRY_RUN       = prevDry;
  CONFIG.CREATE_DRAFTS = prevDrafts;
}