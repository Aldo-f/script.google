// Required OAuth scopes — forces Apps Script to request all permissions upfront
/* global DriveApp, GmailApp, UrlFetchApp, PropertiesService, ScriptApp, Utilities */

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
  FREE_LLM_MODEL:   'auto',
  GEMINI_MODEL:     'gemini-3.5-flash',

  WATCHLIST: [
    {
      address:         'mobiliteit@merelbeke-melle.be',
      escalateTo:      'hannah.gevers@merelbeke-melle.be',
      escalateCc:      ['klantendienst-awv@wegenenverkeer.be;Lena.De.Smaele@merelbeke-melle.be;Sandra.Arco@merelbeke-melle.be'],
      digestCc:        ['Lena.De.Smaele@merelbeke-melle.be', 'Sandra.Arco@merelbeke-melle.be'],
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
  perfLog('checkDigests.start');
  syncLabels();
  processFollowUps({ doDigest: true, doEscalate: false });
  perfLog('checkDigests.end');
}

function checkEscalations() {
  perfLog('checkEscalations.start');
  syncLabels();
  processFollowUps({ doDigest: false, doEscalate: true });
  perfLog('checkEscalations.end');
}

function processFollowUps({ doDigest, doEscalate }) {
  perfLog('processFollowUps.start');
  const escalatedLabel = getOrCreateLabel(CONFIG.LABELS.ESCALATED);
  const escalatedIds   = getLabeledThreadIds(escalatedLabel);
  const closedIds      = getLabeledThreadIds(getOrCreateLabel(CONFIG.LABELS.CLOSED));
  const cutoff         = daysAgo(CONFIG.WAIT_DAYS);

  CONFIG.WATCHLIST.forEach(entry => {
    perfLog(`processFollowUps.entry.${entry.address}.start`);
    const countMap = buildReminderCountMap(entry.address);
    const pending  = collectPending(entry.address, cutoff, escalatedIds, closedIds, countMap);

    if (pending.length === 0) {
      log(`[OK] No pending dossiers for ${entry.address}`);
      perfLog(`processFollowUps.entry.${entry.address}.end`);
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
      sendDigest(entry, pending);
    }
    perfLog(`processFollowUps.entry.${entry.address}.end`);
  });
  perfLog('processFollowUps.end');
}

function syncLabels() {
  perfLog('syncLabels.start');
  const closedLabel    = getOrCreateLabel(CONFIG.LABELS.CLOSED);
  const escalatedLabel = getOrCreateLabel(CONFIG.LABELS.ESCALATED);

  CONFIG.WATCHLIST.forEach(entry => {
    perfLog(`syncLabels.entry.${entry.address}.start`);
    const countMap = buildReminderCountMap(entry.address);
    // Limit search to last 180 days to avoid scanning years of closed threads
    const lookback  = formatDate(daysAgo(180));
    const threads   = GmailApp.search(awvDossierQuery(entry.address, `after:${lookback}`));

    threads.forEach(thread => {
      if (thread.getLabels().some(l => l.getName() === closedLabel.getName())) return;

      const subject    = subjectOf(thread);
      const ticketCode = extractTicketCode(subject);
      if (!ticketCode || !countMap.has(ticketCode)) return;

      const count = countMap.get(ticketCode) || 0;

      applyCorrectLabel(thread, count, escalatedLabel);
    });
    perfLog(`syncLabels.entry.${entry.address}.end`);
  });

  log('[SYNC] Labels bijgewerkt');
  perfLog('syncLabels.end');
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
  if (countMapCache[address]) {
    log(`[PERF] buildReminderCountMap.${address} — cached hit`);
    return countMapCache[address];
  }
  perfLog(`buildReminderCountMap.${address}.start`);

  // Limit to last 180 days to avoid scanning years of stale digest emails
  const after   = formatDate(daysAgo(180));
  const query   = `from:${CONFIG.MY_EMAIL} to:${address} subject:"${CONFIG.DIGEST_SUBJECT_PREFIX}" after:${after}`;
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
  perfLog(`buildReminderCountMap.${address}.end`);

  countMapCache[address] = map;
  return map;
}

// ─── COLLECT PENDING ─────────────────────────────────────────────────────────

function collectPending(address, cutoff, escalatedIds, closedIds, countMap) {
  perfLog(`collectPending.${address}.start`);
  // Limit search to last 90 days to avoid scanning years of old threads
  // that are almost certainly already closed/replied.
  const lookback = new Date(cutoff);
  lookback.setDate(lookback.getDate() - 90);
  const query   = awvDossierQuery(address, `before:${formatDate(cutoff)} after:${formatDate(lookback)}`);
  const threads = GmailApp.search(query);

  // First pass: collect candidates + gather ticket codes for batched cross-thread check
  const candidates = [];
  const ticketCodes = new Set();

  threads.forEach(thread => {
    if (closedIds.has(thread.getId()))    return;

    const subject    = subjectOf(thread);
    const ticketCode = extractTicketCode(subject);

    if (hasReply(thread, address)) return;

    if (!ticketCode) {
      // No ticket code — include anyway (edge case)
      candidates.push({ thread, subject, ticketCode: null });
      return;
    }

    ticketCodes.add(ticketCode);
    candidates.push({ thread, subject, ticketCode });
  });

  // Batch cross-thread check: ONE Gmail search for all ticket codes
  const crossRepliedCodes = batchCheckCrossThreadReply([...ticketCodes], address);
  perfLog(`collectPending.${address}.batchCrossCheck`);

  // Second pass: build pending list, skip cross-replied
  const result = [];
  candidates.forEach(({ thread, subject, ticketCode }) => {
    if (ticketCode && crossRepliedCodes.has(ticketCode)) return;

    const original      = thread.getMessages()[0];
    const reminderCount = countMap.get(ticketCode) || 0;

    result.push({
      thread,
      subject,
      ticketCode,
      reminderCount,
      sentDate: original.getDate(),
      context:  extractMailContext(original.getPlainBody()),
    });
  });

  perfLog(`collectPending.${address}.end — ${result.length} pending from ${threads.length} threads`);
  return result;
}

/**
 * Batch version of hasCrossThreadReply — searches Gmail with batched OR queries
 * to stay within the ~2048-char query limit (~50 codes per batch).
 * Returns a Set of ticket codes that have cross-thread replies from the watched address.
 */
function batchCheckCrossThreadReply(ticketCodes, watchedAddress) {
  if (ticketCodes.length === 0) return new Set();

  const BATCH_SIZE = 50;
  const watchedLower = watchedAddress.toLowerCase();
  const repliedCodes = new Set();

  // Process in batches of 50 to avoid Gmail query length limits
  for (let i = 0; i < ticketCodes.length; i += BATCH_SIZE) {
    const batch = ticketCodes.slice(i, i + BATCH_SIZE);
    const query = batch.map(c => `"${c}"`).join(' OR ');
    const threads = GmailApp.search(query);

    threads.forEach(thread => {
      const ticketCode = extractTicketCodeForCrossCheck(thread, watchedLower);
      if (ticketCode) repliedCodes.add(ticketCode);
    });
  }

  return repliedCodes;
}

/**
 * Pure-function helper: given a Gmail thread, extracts the ticket code
 * and checks if the watched address replied in it.
 * Returns the ticket code (string) or null.
 * This is a pure function (no GmailApp calls) — testable with mocks.
 */
function extractTicketCodeForCrossCheck(thread, watchedLower) {
  const subject = subjectOf(thread);
  const code    = extractTicketCode(subject);
  if (!code) return null;

  const hasReplyFromWatched = thread.getMessages().some(msg =>
    msg.getFrom().toLowerCase().includes(watchedLower)
  );
  return hasReplyFromWatched ? code : null;
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

function sendDigest(entry, pending) {
  perfLog(`sendDigest.${entry.address}.start — ${pending.length} items`);
  const body = buildFallbackDigest(pending);
  const pdf  = buildCombinedPdf(pending);
  const cc = [CONFIG.MY_EMAIL, ...(entry.digestCc || [])].join(',');
  deliverEmail({
    to:          entry.address,
    subject:     `${CONFIG.DIGEST_SUBJECT_PREFIX} - ${formatDateDisplay(new Date())}`,
    body,
    cc:          cc,
    attachments: [pdf],
  });
  perfLog(`sendDigest.${entry.address}.end`);
}

function sendEscalation(entry, pending, escalatedLabel) {
  perfLog(`sendEscalation.${entry.address}.start — ${pending.length} items`);
  const items = pending.map(({ ticketCode, sentDate, context, reminderCount }, i) => {
    const ref      = ticketCode || '-';
    const date     = sentDate.toLocaleDateString('nl-BE');
    const location = context.location || '(locatie onbekend)';
    return `  ${i + 1}. Ref. ${ref} - ${date} - ${location} (${reminderCount}x herinnerd)`;
  }).join('\n');
  const body = `Geachte mevrouw Gevers,\n\nVia AWV werden de volgende meldingen doorgestuurd naar ${entry.address}.\nNa ${CONFIG.ESCALATE_AFTER} herhaalde verzoeken om opvolging bleef een reactie uit.\n\nIk escaleer deze dossiers naar u als diensthoofd en stel AWV in kennis zodat zij op de hoogte zijn van het gebrek aan opvolging.\n\nOpenstaande dossiers (bijgevoegde PDF):\n${items}\n\nMag ik u verzoeken deze dossiers dringend op te nemen en mij te informeren over de verdere aanpak?\n\nMet vriendelijke groeten,\nAldo Fieuw`;
  const pdf  = buildCombinedPdf(pending);
  deliverEmail({
    to:          entry.escalateTo,
    subject:     entry.escalateSubject,
    body,
    cc:          [CONFIG.MY_EMAIL, ...(entry.escalateCc || [])].join(','),
    attachments: [pdf],
  }, () => {
    pending.forEach(({ thread }) => thread.addLabel(escalatedLabel));
  });
  perfLog(`sendEscalation.${entry.address}.end`);
}

// ─── AI PROSE REWRITE — WATERFALL (Gemini → FreeLLMAPI) ──────────────────────────
// Uses callAI() from shared/AIProviders.gs

/**
 * Rewrites a single prose paragraph using a strict prompt (Dutch).
 * Rules: no chain-of-thought, no hallucinated org names (always "AWV"),
 * strip markdown code fences from output, fallback to original if AI
 * output is suspiciously long (>3x input length).
 */
function rewriteProse(prose) {
  const prompt = [
    'Je bent Aldo, een burger die een beleefde herinnering stuurt.',
    'Verzin GEEN organisatienamen — gebruik altijd "AWV" (Agentschap Wegen en Verkeer).',
    'Herschrijf de onderstaande tekst in een vriendelijke, professionele toon.',
    'Behoud alle feitelijke informatie exact.',
    'Geef ALLEEN de herschreven tekst terug. Geen inleiding, geen uitleg, geen gedachtegang.',
    '- Gebruik GEEN em dashes (—) — gebruik altijd een gewoon minteken (-).',
    '',
    'Tekst om te herschrijven:',
    prose,
  ].join('\n');

  try {
    const raw = callAI(prompt).trim();
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '').trim();
    // Fallback if output is suspiciously long (>3x input)
    if (cleaned.length > prose.length * 3) {
      log(`[WARN] rewriteProse: output too long (${cleaned.length} vs ${prose.length}), using original`);
      return prose;
    }
    return cleaned;
  } catch (err) {
    log(`[WARN] rewriteProse failed (${err.message}), using original prose`);
    return prose;
  }
}

/**
 * Composes an email body by rewriting only the prose parts via AI
 * and inserting the list block verbatim.
 *
 * @param {string} introProse  - Introductory paragraph(s) to rewrite
 * @param {string} listBlock   - Markdown-style list (inserted verbatim)
 * @param {string} outroProse  - Closing paragraph(s) to rewrite
 * @returns {string} Full email body
 */
function composeBody(introProse, listBlock, outroProse) {
  const rewrittenIntro = rewriteProse(introProse);
  const rewrittenOutro = rewriteProse(outroProse);
  return [rewrittenIntro, '', listBlock, '', rewrittenOutro].join('\n');
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
  perfLog('buildCombinedPdf.start');
  const dateStr = formatDate(new Date());

  // Build HTML directly instead of creating a Google Doc — much faster
  const pageParts = pending.map(({ ticketCode, sentDate, subject, thread }, i) => {
    const ref      = ticketCode || 'onbekend';
    const mailBody = thread.getMessages()[0].getPlainBody();
    const cutAt    = mailBody.indexOf('Locatiegegevens:');
    const cleanBody = cutAt > -1 ? mailBody.slice(cutAt).trim() : mailBody;

    return `
<div style="page-break-before:${i > 0 ? 'always' : 'auto'}; font-family:sans-serif;margin:0;padding:0;">
  <h1>Dossier: ${escapeHtml(ref)}</h1>
  <p><strong>Doorgestuurd op:</strong> ${sentDate.toLocaleDateString('nl-BE')}</p>
  <p><strong>Onderwerp:</strong> ${escapeHtml(subject)}</p>
  <p><strong>Gegenereerd op:</strong> ${new Date().toLocaleDateString('nl-BE')}</p>
  <hr>
  <h2>Originele melding</h2>
  <pre style="white-space:pre-wrap;font-family:sans-serif;">${escapeHtml(cleanBody)}</pre>
</div>`;
  });

  const html = HtmlService.createHtmlOutput(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: Arial, sans-serif; margin: 2cm; }
      h1 { font-size: 18pt; }
      h2 { font-size: 14pt; }
      hr { border: 0; border-top: 1px solid #ccc; }
      pre { white-space: pre-wrap; font-size: 11pt; }
    </style></head><body>
    ${pageParts.join('\n')}
    </body></html>`
  ).getAs('application/pdf')
   .setName(`Meldingen_${dateStr}.pdf`);

  perfLog('buildCombinedPdf.end');
  return html;
}

/** Minimal HTML-escape to prevent XSS in PDF rendering. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
    'Mag ik u verzoeken de openstaande dossiers op te volgen',
    'en mij per dossier op de hoogte te stellen van de huidige status?',
    '',
    'Met vriendelijke groeten,',
    'Aldo Fieuw',
  ].join('\n');
}

function buildEscalationBody(entry, pending) {
  const items = pending.map(({ ticketCode, sentDate, context, reminderCount }, i) => {
    const ref      = ticketCode || '-';
    const date     = sentDate.toLocaleDateString('nl-BE');
    const location = context.location || '(locatie onbekend)';
    return `  ${i + 1}. Ref. ${ref} - ${date} - ${location} (${reminderCount}x herinnerd)`;
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
    `Mag ik u verzoeken deze dossiers dringend op te nemen`,
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

// ─── PERFORMANCE LOGGING ─────────────────────────────────────────────────────

/**
 * Performance logger — logs elapsed ms since the last call or since reset().
 * Usage:
 *   perfLog('step1');  // logs "[PERF] step1 — 0ms" (or close to 0)
 *   perfLog('step2');  // logs "[PERF] step2 — 1234ms" (elapsed since step1)
 */
const perfLog = (() => {
  let lastTs = Date.now();
  const fn = (label) => {
    const now  = Date.now();
    const diff = now - lastTs;
    lastTs     = now;
    const msg  = `[PERF] ${label} — ${diff}ms`;
    Logger.log(msg);
    return msg;
  };
  fn.reset = () => { lastTs = Date.now(); };
  return fn;
})();

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
    `Mag ik u verzoeken dit dossier op te volgen`,
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

  const items = pending.map(({ ticketCode, sentDate, context, reminderCount }, i) => {
    const ref      = ticketCode || '-';
    const date     = sentDate.toLocaleDateString('nl-BE');
    const location = context.location || '(locatie onbekend)';
    return `  ${i + 1}. Ref. ${ref} - ${date} - ${location} (${reminderCount}x herinnerd)`;
  }).join('\n');
  const pdf    = buildCombinedPdf(pending);
  const body   = composeBody(
    `Geachte mevrouw Gevers,\n\nVia AWV werden de volgende meldingen doorgestuurd naar ${entry.address}.\nNa ${CONFIG.ESCALATE_AFTER} herhaalde verzoeken om opvolging bleef een reactie uit.\n\nIk escaleer deze dossiers naar u als diensthoofd en stel AWV in kennis zodat zij op de hoogte zijn van het gebrek aan opvolging.\n\nOpenstaande dossiers (bijgevoegde PDF):`,
    items,
    `Mag ik u verzoeken deze dossiers dringend op te nemen en mij te informeren over de verdere aanpak?\n\nMet vriendelijke groeten,\nAldo Fieuw`
  );
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

  log('');
  log('Vergeet niet in Project Settings → Script Properties:');
  log('  - GEMINI_API_KEY   (komma-gescheiden voor meerdere keys)');
  log('  - FREE_LLM_API_KEY (fallback provider)');
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

  perfLog.reset();
  perfLog('dryRun.start');

  // Single syncLabels call — avoids redundant Gmail searches
  syncLabels();

  // Process both digest and escalation in one pass per watchlist entry
  // (checkDigests and checkEscalations each call syncLabels separately)
  processFollowUps({ doDigest: true, doEscalate: true });

  perfLog('dryRun.end');

  CONFIG.DRY_RUN       = prevDry;
  CONFIG.CREATE_DRAFTS = prevDrafts;
}