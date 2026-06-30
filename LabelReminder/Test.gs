/**
 * LabelReminder.test.gs
 * Run runAllTests() to execute all tests.
 */

// ─── RUNNER ──────────────────────────────────────────────────────────────────

function runAllTests() {
  const results = [];

  [
    testParseInterval,
    testGetIntervalFromLabel,
    testIsIgnoredSender,
    testDetectLanguage,
    testExtractEmail,
    testExtractName,
    testCleanSubject,
    testBuildFallbackText,
    testFormatDateNL,
    testHasOnHold,
    testHasRecipientReplied,
    testGetLastSentByMeDate,
    testFindReminderRecipient,
  ].forEach(suite => {
    try {
      suite(results);
    } catch (err) {
      results.push({ label: '[CRASH] ' + suite.name + ': ' + err.message, ok: false });
    }
  });

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  Logger.log('\n══════════════════════════════════════');
  Logger.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
  Logger.log('══════════════════════════════════════');
  results.forEach(r => Logger.log('  ' + (r.ok ? '✓' : '✗') + ' ' + r.label));
  Logger.log('══════════════════════════════════════\n');
}

function assert(label, condition) {
  const result = { label: label, ok: !!condition };
  Logger.log((result.ok ? '✓' : '✗') + ' ' + label);
  return result;
}

// ─── MOCK FACTORIES ──────────────────────────────────────────────────────────

function makeLabel(name) {
  return {
    getName: function() { return name; },
    getThreads: function() { return []; },
  };
}

function makeMessage(from, date, body, subject) {
  return {
    getFrom:       function() { return from || 'sender@example.com'; },
    getDate:       function() { return date || new Date(); },
    getPlainBody:  function() { return body || 'Test body content that is long enough to pass the 50-char check.'; },
    getSubject:    function() { return subject || 'Test Subject'; },
  };
}

function makeThread(messages, labels) {
  messages = messages || [makeMessage()];
  labels   = labels || [];
  return {
    getId:              function() { return 'thread-mock'; },
    getMessages:        function() { return messages; },
    getLabels:          function() { return labels; },
    getFirstMessageSubject: function() { return messages[0].getSubject(); },
    getLastMessageDate: function() { return messages[messages.length - 1].getDate(); },
    addLabel:           function() {},
    removeLabel:        function() {},
  };
}

// ─── PURE: parseInterval ──────────────────────────────────────────────────────

function testParseInterval(results) {
  results.push(assert('parseInterval("2weeks") → 14',           parseInterval('2weeks') === 14));
  results.push(assert('parseInterval("1week") → 7',             parseInterval('1week') === 7));
  results.push(assert('parseInterval("3days") → 3',             parseInterval('3days') === 3));
  results.push(assert('parseInterval("1month") → 30',           parseInterval('1month') === 30));
  results.push(assert('parseInterval("1year") → 365',           parseInterval('1year') === 365));
  results.push(assert('parseInterval("2 years") → 730',         parseInterval('2 years') === 730));
  results.push(assert('parseInterval("0days") → 0',             parseInterval('0days') === 0));
  results.push(assert('parseInterval("") → null',               parseInterval('') === null));
  results.push(assert('parseInterval("invalid") → null',        parseInterval('invalid') === null));
  results.push(assert('parseInterval("2weeks") case test',      parseInterval('2Weeks') === 14));
}

// ─── PURE: getIntervalFromLabel ───────────────────────────────────────────────

function testGetIntervalFromLabel(results) {
  results.push(assert('getIntervalFromLabel("remind-every/2weeks") → 14',  getIntervalFromLabel('remind-every/2weeks') === 14));
  results.push(assert('getIntervalFromLabel("remind-every/1month") → 30',  getIntervalFromLabel('remind-every/1month') === 30));
  results.push(assert('getIntervalFromLabel("remind-every/on-hold") → null', getIntervalFromLabel('remind-every/on-hold') === null));
  results.push(assert('getIntervalFromLabel("other") → null',             getIntervalFromLabel('other') === null));
  results.push(assert('getIntervalFromLabel("remind-every") → null',      getIntervalFromLabel('remind-every') === null));
}

// ─── PURE: isIgnoredSender ────────────────────────────────────────────────────

function testIsIgnoredSender(results) {
  results.push(assert('isIgnoredSender: AWV system mail → true',
    isIgnoredSender('klantendienst-awv@wegenenverkeer.be') === true));
  results.push(assert('isIgnoredSender: wegenenverkeer.be → true',
    isIgnoredSender('info@wegenenverkeer.be') === true));
  results.push(assert('isIgnoredSender: normal sender → false',
    isIgnoredSender('someone@example.com') === false));
  results.push(assert('isIgnoredSender: empty string → false',
    isIgnoredSender('') === false));
  results.push(assert('isIgnoredSender: case insensitive',
    isIgnoredSender('KLANTENDIENST-AWV@WEGENENVERKEER.BE') === true));
}

// ─── PURE: detectLanguage ─────────────────────────────────────────────────────

function testDetectLanguage(results) {
  results.push(assert('detectLanguage: Dutch text → "nl"',
    detectLanguage('Dit is een test bericht voor de gemeente.') === 'nl'));
  results.push(assert('detectLanguage: English text → "en"',
    detectLanguage('This is a test message for the municipality.') === 'en'));
  results.push(assert('detectLanguage: mixed → "en" (fewer than 3 Dutch words)',
    detectLanguage('De test message for the municipality.') === 'en'));
  results.push(assert('detectLanguage: empty → "en"',
    detectLanguage('') === 'en'));
  results.push(assert('detectLanguage: full Dutch sentence',
    detectLanguage('Geachte heer, wij hebben uw bericht ontvangen en zijn er mee bezig.') === 'nl'));
}

// ─── PURE: extractEmail ───────────────────────────────────────────────────────

function testExtractEmail(results) {
  results.push(assert('extractEmail: Name <email>',
    extractEmail('John Doe <john@example.com>') === 'john@example.com'));
  results.push(assert('extractEmail: bare email',
    extractEmail('john@example.com') === 'john@example.com'));
  results.push(assert('extractEmail: quoted name',
    extractEmail('"John, Doe" <john@example.com>') === 'john@example.com'));
  results.push(assert('extractEmail: empty', extractEmail('') === ''));
  results.push(assert('extractEmail: no angle brackets',
    extractEmail('just text') === 'just text'));
}

// ─── PURE: extractName ────────────────────────────────────────────────────────

function testExtractName(results) {
  results.push(assert('extractName: Name <email>',
    extractName('John Doe <john@example.com>') === 'John Doe'));
  results.push(assert('extractName: quoted name',
    extractName('"John, Doe" <john@example.com>') === 'John, Doe'));
  results.push(assert('extractName: bare email → null',
    extractName('john@example.com') === null));
  results.push(assert('extractName: empty → null',
    extractName('') === null));
}

// ─── PURE: cleanSubject ───────────────────────────────────────────────────────

function testCleanSubject(results) {
  results.push(assert('cleanSubject: Re: prefix',       cleanSubject('Re: test') === 'test'));
  results.push(assert('cleanSubject: FW: prefix',       cleanSubject('FW: test') === 'test'));
  results.push(assert('cleanSubject: Antw: prefix',     cleanSubject('Antw: test') === 'test'));
  results.push(assert('cleanSubject: nested Re:',       cleanSubject('Re: Re: test') === 'test'));
  results.push(assert('cleanSubject: no prefix',        cleanSubject('test') === 'test'));
  results.push(assert('cleanSubject: empty',             cleanSubject('') === ''));
  results.push(assert('cleanSubject: AWV: prefix',      cleanSubject('AWV: melding') === 'melding'));
  results.push(assert('cleanSubject: Re/FW mixed',      cleanSubject('Re: FW: test') === 'test'));
}

// ─── PURE: buildFallbackText ──────────────────────────────────────────────────

function testBuildFallbackText(results) {
  const nlBody = buildFallbackText('Jan Jansen', 'Test onderwerp', 'nl');
  results.push(assert('buildFallbackText NL: contains name',     nlBody.includes('Jan Jansen')));
  results.push(assert('buildFallbackText NL: contains subject',  nlBody.includes('Test onderwerp')));
  results.push(assert('buildFallbackText NL: NL greeting',       nlBody.includes('Beste')));
  results.push(assert('buildFallbackText NL: NL closing',        nlBody.includes('Met vriendelijke groeten')));
  results.push(assert('buildFallbackText NL: signed',            nlBody.includes(CONFIG.SENDER_ALIAS)));

  const enBody = buildFallbackText('John Doe', 'Test subject', 'en');
  results.push(assert('buildFallbackText EN: contains name',     enBody.includes('John Doe')));
  results.push(assert('buildFallbackText EN: contains subject',  enBody.includes('Test subject')));
  results.push(assert('buildFallbackText EN: EN greeting',       enBody.includes('Dear')));
  results.push(assert('buildFallbackText EN: EN closing',        enBody.includes('Kind regards')));
  results.push(assert('buildFallbackText EN: signed',            enBody.includes(CONFIG.SENDER_ALIAS)));

  const noName = buildFallbackText(null, 'Subject', 'nl');
  results.push(assert('buildFallbackText: null name uses "there"', noName.includes('there')));

  results.push(assert('buildFallbackText: no null leaking',       !nlBody.includes('null')));
}

// ─── PURE: formatDateNL ───────────────────────────────────────────────────────

function testFormatDateNL(results) {
  const date = new Date(2026, 5, 19); // June 19, 2026
  const formatted = formatDateNL(date);
  results.push(assert('formatDateNL: contains day number',  formatted.includes('19')));
  results.push(assert('formatDateNL: contains month',       formatted.includes('juni') || formatted.includes('June')));
  results.push(assert('formatDateNL: contains year',        formatted.includes('2026')));
}

// ─── MOCK: hasOnHold ──────────────────────────────────────────────────────────

function testHasOnHold(results) {
  const onHoldLabel  = makeLabel(CONFIG.ON_HOLD);
  const otherLabel   = makeLabel('remind-every/2weeks');

  const threadOnHold    = makeThread([], [onHoldLabel]);
  const threadOther     = makeThread([], [otherLabel]);
  const threadNoLabels  = makeThread([], []);

  results.push(assert('hasOnHold: on-hold present → true',  hasOnHold(threadOnHold) === true));
  results.push(assert('hasOnHold: other label → false',     hasOnHold(threadOther) === false));
  results.push(assert('hasOnHold: no labels → false',       hasOnHold(threadNoLabels) === false));
}

// ─── MOCK: hasRecipientReplied ────────────────────────────────────────────────

function testHasRecipientReplied(results) {
  const my      = CONFIG.MY_EMAIL;
  const awv     = 'awv@wegenenverkeer.be';
  const other   = 'burger@example.com';

  const onlyAwv  = makeThread([makeMessage(awv)]);
  const awvThenOther = makeThread([makeMessage(awv), makeMessage(other)]);
  const awvThenAwv2  = makeThread([makeMessage(awv), makeMessage(awv)]);
  const awvThenMe    = makeThread([makeMessage(awv), makeMessage(my)]);

  results.push(assert('hasRecipientReplied: single message → false',  hasRecipientReplied(onlyAwv) === false));
  results.push(assert('hasRecipientReplied: third party → true',      hasRecipientReplied(awvThenOther) === true));
  results.push(assert('hasRecipientReplied: AWV only → false',        hasRecipientReplied(awvThenAwv2) === false));
  results.push(assert('hasRecipientReplied: my own → false',          hasRecipientReplied(awvThenMe) === false));
}

// ─── MOCK: getLastSentByMeDate ────────────────────────────────────────────────

function testGetLastSentByMeDate(results) {
  const my    = CONFIG.MY_EMAIL;
  const other = 'someone@example.com';
  const now   = new Date();
  const older = new Date(now.getTime() - 86400000); // 1 day ago

  const myMessage    = makeMessage(my, now);
  const otherMessage = makeMessage(other, older);
  const thread       = makeThread([otherMessage, myMessage]);

  const result = getLastSentByMeDate(thread);
  results.push(assert('getLastSentByMeDate: finds my latest message', result.getTime() === now.getTime()));

  const noReply  = makeThread([makeMessage(other, older)]);
  const result2  = getLastSentByMeDate(noReply);
  results.push(assert('getLastSentByMeDate: falls back to last message date', result2.getTime() === older.getTime()));
}

// ─── MOCK: findReminderRecipient ──────────────────────────────────────────────

function testFindReminderRecipient(results) {
  const my    = CONFIG.MY_EMAIL;
  const other = 'burger@example.com';

  // Thread with recipient who replied
  const thread    = makeThread([makeMessage(other), makeMessage(my)]);
  const recipient = findReminderRecipient(thread);

  results.push(assert('findReminderRecipient: finds email',  recipient.email === 'burger@example.com'));

  // Thread with only my messages — falls back to To field
  const myOnly         = makeThread([makeMessage(my)]);
  const fallbackRecip  = findReminderRecipient(myOnly);
  results.push(assert('findReminderRecipient: fallback exists', fallbackRecip.email !== null));
}
