/**
 * FollowUpReminder.test.gs
 * Run runAllTests() to execute all tests.
 */

// ─── RUNNER ──────────────────────────────────────────────────────────────────

function runAllTests() {
  const results = [];

  [
    testExtractTicketCode,
    testFormatDate,
    testExtractLocation,
    testExtractComplaint,
    testExtractTicketCodeFromBody,
    testExtractMailContext,
    testBuildReminderPrompt,
    testBuildFallbackReminder,
    testHasReply,
    testHasCrossThreadReply,
    testBuildGroupedOverview,
    testBuildFallbackDigest,
    testBuildEscalationBody,
    testEscalationSplit,
  ].forEach(suite => {
    try {
      suite(results);
    } catch (err) {
      results.push({ label: `[CRASH] ${suite.name}: ${err.message}`, ok: false });
    }
  });

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  Logger.log('\n══════════════════════════════════════');
  Logger.log(`  Results: ${passed} passed, ${failed} failed`);
  Logger.log('══════════════════════════════════════');
  results.forEach(r => Logger.log(`  ${r.ok ? '✓' : '✗'} ${r.label}`));
  Logger.log('══════════════════════════════════════\n');
}

function assert(label, condition) {
  const result = { label, ok: !!condition };
  Logger.log(`${result.ok ? '✓' : '✗'} ${label}`);
  return result;
}

// ─── MOCK FACTORIES ──────────────────────────────────────────────────────────

function makeMessage(from) {
  return { getFrom: () => from };
}

function makeThread(messages) {
  return {
    getId:       () => 'thread-mock',
    getMessages: () => messages,
    getLabels:   () => [],
  };
}

function makeThreadWithId(id) {
  return {
    getId:       () => id,
    getMessages: () => [makeMessage('someone@example.com')],
    getLabels:   () => [],
  };
}

function makePending(ticketCode, daysAgoCount, reminderCount, location) {
  const sentDate = new Date();
  sentDate.setDate(sentDate.getDate() - daysAgoCount);
  return {
    ticketCode,
    sentDate,
    reminderCount,
    subject: `FW: (${ticketCode})`,
    thread:  makeThread([makeMessage('awv@wegenenverkeer.be')]),
    context: { location: location || null, complaint: null, ticketCode },
  };
}

// ─── SAMPLE DATA ─────────────────────────────────────────────────────────────

const SAMPLE_AWV_BODY = `
Beste

Wij ontvingen een bericht.

Adres: Bergbosstraat 72B, 9820 Merelbeke-Melle

Inkomend bericht van 23/03/2026 door Agentschap
Toegekend dossiernummer: KM-2026-08317
Tussenbericht van AWV.

Inkomend bericht van 23/03/2026 door Burger
Toegekend dossiernummer: KM-2026-08317
Beste, het E3-bord heeft geen onderbord.
------------------------------------------------------------------------
`;

// ─── PURE: extractTicketCode ──────────────────────────────────────────────────

function testExtractTicketCode(results) {
  [
    ['FW:  (KM-2026-09219)',       'KM-2026-09219'],
    ['FW:  (KM-2025-29461)',       'KM-2025-29461'],
    ['Sluisweg:  (KM-2026-08924)', 'KM-2026-08924'],
    ['Snoeien (KM-2025-29461)',    'KM-2025-29461'],
    ['No ticket here',             null],
    ['',                           null],
  ].forEach(([subject, expected]) => {
    results.push(assert(
      `extractTicketCode("${subject}") → ${expected}`,
      extractTicketCode(subject) === expected
    ));
  });
}

// ─── PURE: formatDate ────────────────────────────────────────────────────────

function testFormatDate(results) {
  results.push(assert('formatDate pads month',  formatDate(new Date(2026, 3, 6))  === '2026/04/06'));
  results.push(assert('formatDate pads day',    formatDate(new Date(2026, 0, 1))  === '2026/01/01'));
}

// ─── PURE: extractLocation ───────────────────────────────────────────────────

function testExtractLocation(results) {
  results.push(assert('extractLocation: finds address',               extractLocation(SAMPLE_AWV_BODY) === 'Bergbosstraat 72B, 9820 Merelbeke-Melle'));
  results.push(assert('extractLocation: null when missing',           extractLocation('Geen locatie') === null));
  results.push(assert('extractLocation: null on Weglocatie bleed-in', extractLocation('Adres: Weglocatie: Andere:') === null));
  results.push(assert('extractLocation: null on Andere bleed-in',     extractLocation('Adres: Andere locatiegegevens:') === null));
}

// ─── PURE: extractComplaint ──────────────────────────────────────────────────

function testExtractComplaint(results) {
  const c = extractComplaint(SAMPLE_AWV_BODY);
  results.push(assert('extractComplaint: gets burger text',       c !== null && c.includes('E3-bord')));
  results.push(assert('extractComplaint: skips AWV boilerplate',  c !== null && !c.includes('Tussenbericht')));
  results.push(assert('extractComplaint: strips separator',       c !== null && !c.includes('---')));
  results.push(assert('extractComplaint: null without block',     extractComplaint('Geen berichten') === null));
}

// ─── PURE: extractTicketCodeFromBody ─────────────────────────────────────────

function testExtractTicketCodeFromBody(results) {
  results.push(assert('extractTicketCodeFromBody: finds code',    extractTicketCodeFromBody(SAMPLE_AWV_BODY) === 'KM-2026-08317'));
  results.push(assert('extractTicketCodeFromBody: null if none',  extractTicketCodeFromBody('Geen code') === null));
}

// ─── PURE: extractMailContext ─────────────────────────────────────────────────

function testExtractMailContext(results) {
  const ctx = extractMailContext(SAMPLE_AWV_BODY);
  results.push(assert('extractMailContext: location',    ctx.location === 'Bergbosstraat 72B, 9820 Merelbeke-Melle'));
  results.push(assert('extractMailContext: ticketCode',  ctx.ticketCode === 'KM-2026-08317'));
  results.push(assert('extractMailContext: complaint',   ctx.complaint !== null && ctx.complaint.length > 5));

  const empty = extractMailContext('');
  results.push(assert('extractMailContext: handles empty body', empty.location === null && empty.complaint === null));
}

// ─── PURE: buildReminderPrompt ───────────────────────────────────────────────

function testBuildReminderPrompt(results) {
  const ctx    = { location: 'Bergbosstraat 72B', complaint: 'E3-bord.', ticketCode: 'KM-2026-08317' };
  const prompt = buildReminderPrompt(ctx, 'FW: (KM-2026-08317)', 'mobiliteit@merelbeke-melle.be', '24/03/2026');

  results.push(assert('buildReminderPrompt: location',    prompt.includes('Bergbosstraat')));
  results.push(assert('buildReminderPrompt: ticket',      prompt.includes('KM-2026-08317')));
  results.push(assert('buildReminderPrompt: complaint',   prompt.includes('E3-bord')));
  results.push(assert('buildReminderPrompt: date',        prompt.includes('24/03/2026')));
  results.push(assert('buildReminderPrompt: null-safe',   !buildReminderPrompt({location:null,complaint:null,ticketCode:null},'','','').includes('null')));
}

// ─── PURE: buildFallbackReminder ─────────────────────────────────────────────

function testBuildFallbackReminder(results) {
  const ctx  = { location: 'Bergbosstraat 72B', complaint: 'E3-bord', ticketCode: 'KM-2026-08317' };
  const body = buildFallbackReminder(ctx, 'FW: (KM-2026-08317)', '24/03/2026');

  results.push(assert('buildFallbackReminder: ticket',    body.includes('KM-2026-08317')));
  results.push(assert('buildFallbackReminder: date',      body.includes('24/03/2026')));
  results.push(assert('buildFallbackReminder: location',  body.includes('Bergbosstraat')));
  results.push(assert('buildFallbackReminder: signed',    body.includes('Aldo Fieuw')));
  results.push(assert('buildFallbackReminder: null-safe', !buildFallbackReminder({location:null,complaint:null,ticketCode:null},'FW:','01/01').includes('null')));
}

// ─── MOCK: hasReply ───────────────────────────────────────────────────────────

function testHasReply(results) {
  const watched = 'mobiliteit@merelbeke-melle.be';
  const awv     = makeMessage('awv@wegenenverkeer.be');
  const mob     = makeMessage('mobiliteit@merelbeke-melle.be');
  const own     = makeMessage(CONFIG.MY_EMAIL);
  const other   = makeMessage('other@example.com');

  results.push(assert('hasReply: single message → false',         hasReply(makeThread([awv]), watched) === false));
  results.push(assert('hasReply: reply from watched → true',      hasReply(makeThread([awv, mob]), watched) === true));
  results.push(assert('hasReply: reply from third party → true',  hasReply(makeThread([awv, other]), watched) === true));
  results.push(assert('hasReply: second AWV only → false',        hasReply(makeThread([awv, awv]), watched) === false));
  results.push(assert('hasReply: own email → false',              hasReply(makeThread([awv, own]), watched) === false));
}

// ─── MOCK: hasCrossThreadReply ────────────────────────────────────────────────

function testHasCrossThreadReply(results) {
  const watched = 'mobiliteit@merelbeke-melle.be';

  function makeThreadWithSender(id, from) {
    return { getId: () => id, getMessages: () => [{ getFrom: () => from }] };
  }

  results.push(assert('hasCrossThreadReply: no other thread → false',
    [makeThreadWithSender('abc', 'awv@wegenenverkeer.be')]
      .filter(t => t.getId() !== 'abc').length === 0
  ));

  const wrongSender = [makeThreadWithSender('abc', 'awv@wegenenverkeer.be'), makeThreadWithSender('xyz', 'awv@wegenenverkeer.be')]
    .filter(t => t.getId() !== 'abc')
    .some(t => t.getMessages().some(m => m.getFrom().toLowerCase().includes(watched)));
  results.push(assert('hasCrossThreadReply: AWV sender only → false', wrongSender === false));

  const rightSender = [makeThreadWithSender('abc', 'awv@wegenenverkeer.be'), makeThreadWithSender('xyz', 'mobiliteit@merelbeke-melle.be')]
    .filter(t => t.getId() !== 'abc')
    .some(t => t.getMessages().some(m => m.getFrom().toLowerCase().includes(watched)));
  results.push(assert('hasCrossThreadReply: mobiliteit sender → true', rightSender === true));
}

// ─── PURE: buildGroupedOverview ───────────────────────────────────────────────

function testBuildGroupedOverview(results) {
  const pending = [
    makePending('KM-2026-08317', 35, 4),
    makePending('KM-2026-08647', 35, 4),  // same date
    makePending('KM-2026-09219', 26, 3),
    makePending(null,            13, 0),
  ];

  const overview = buildGroupedOverview(pending);

  results.push(assert('buildGroupedOverview: groups same-date items',    overview.includes('(2 meldingen,')));
  results.push(assert('buildGroupedOverview: singular "melding"',        overview.includes('(1 melding,')));
  results.push(assert('buildGroupedOverview: oldest date first',         overview.indexOf('35 dagen') < overview.indexOf('26 dagen')));
  results.push(assert('buildGroupedOverview: shows herinnering note',    overview.includes('4e herinnering')));
  results.push(assert('buildGroupedOverview: null ticket → "geen ref"',  overview.includes('geen ref')));
  results.push(assert('buildGroupedOverview: shows dagen',               overview.includes('dagen')));
  results.push(assert('buildGroupedOverview: no count note for 0',       !overview.includes('0e herinnering')));
}

// ─── PURE: buildFallbackDigest ───────────────────────────────────────────────

function testBuildFallbackDigest(results) {
  const pending = [
    makePending('KM-2026-08317', 35, 4, 'Bergbosstraat 72B'),
    makePending(null, 13, 0),
  ];

  const body = buildFallbackDigest(pending);

  results.push(assert('buildFallbackDigest: contains ticket',     body.includes('KM-2026-08317')));
  results.push(assert('buildFallbackDigest: null → "geen ref"',   body.includes('geen ref') && !body.includes('null')));
  results.push(assert('buildFallbackDigest: signed off',          body.includes('Aldo Fieuw')));
  results.push(assert('buildFallbackDigest: grouped format',      body.includes('meldingen') || body.includes('melding')));
  results.push(assert('buildFallbackDigest: uses "mij" not "ons"',body.includes('mij') && !body.includes(' ons ')));
}

// ─── PURE: buildEscalationBody ───────────────────────────────────────────────

function testBuildEscalationBody(results) {
  const entry = {
    address:    'mobiliteit@merelbeke-melle.be',
    escalateTo: 'hannah.gevers@merelbeke-melle.be',
    escalateCc: ['klantendienst-awv@wegenenverkeer.be'],
  };
  const pending = [
    makePending('KM-2026-08317', 35, 4, 'Bergbosstraat 72B'),
    makePending('KM-2026-08647', 35, 4, 'Hundelgemsesteenweg 160'),
  ];

  const body = buildEscalationBody(entry, pending);

  results.push(assert('buildEscalationBody: Hannah Gevers',          body.includes('Gevers')));
  results.push(assert('buildEscalationBody: mobiliteit address',     body.includes('mobiliteit@merelbeke-melle.be')));
  results.push(assert('buildEscalationBody: ESCALATE_AFTER count',   body.includes(String(CONFIG.ESCALATE_AFTER))));
  results.push(assert('buildEscalationBody: first ticket',           body.includes('KM-2026-08317')));
  results.push(assert('buildEscalationBody: second ticket',          body.includes('KM-2026-08647')));
  results.push(assert('buildEscalationBody: reminder count "4x"',    body.includes('4x')));
  results.push(assert('buildEscalationBody: signed off',             body.includes('Aldo Fieuw')));
  results.push(assert('buildEscalationBody: no null leaking',        !body.includes('null')));
}

// ─── PURE: escalation split ───────────────────────────────────────────────────

function testEscalationSplit(results) {
  const pending = [
    makePending('KM-2026-00001', 30, 4),
    makePending('KM-2026-00002', 25, 2),
    makePending('KM-2026-00003', 20, 0),
    makePending('KM-2026-00004', 30, 3),
  ];

  const toEscalate = pending.filter(p => p.reminderCount >= CONFIG.ESCALATE_AFTER);
  const toDigest   = pending.filter(p => p.reminderCount <  CONFIG.ESCALATE_AFTER);

  results.push(assert('escalation split: 2 at/above threshold → toEscalate',  toEscalate.length === 2));
  results.push(assert('escalation split: 2 below threshold → toDigest',        toDigest.length === 2));
  results.push(assert('escalation split: correct ticket in toEscalate',        toEscalate.some(p => p.ticketCode === 'KM-2026-00001')));
  results.push(assert('escalation split: count=3 also escalates',              toEscalate.some(p => p.ticketCode === 'KM-2026-00004')));
  results.push(assert('escalation split: count=0 stays in digest',             toDigest.some(p => p.ticketCode === 'KM-2026-00003')));
}
