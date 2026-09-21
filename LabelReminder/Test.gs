/**
 * LabelReminder.test.gs
 * Run runAllTests() to execute all tests.
 */

// ─── RUNNER ──────────────────────────────────────────────────────────────────

function runAllTests() {
  const results = [];

  [
    testParseInterval_,
    testGetIntervalFromLabel_,
    testIsIgnoredSender_,
    testDetectLanguage_,
    testExtractEmail_,
    testExtractName_,
    testCleanSubject_,
    testBuildFallbackText_,
    testFormatDateNL_,
    testHasOnHold_,
    testHasRecipientReplied_,
    testGetLastSentByMeDate_,
    testFindReminderRecipient_,
    testGetLastNonOwnMessage_,
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

function makeMessage(from, date, body, subject, to) {
  return {
    getFrom:       function() { return from || 'sender@example.com'; },
    getDate:       function() { return date || new Date(); },
    getPlainBody:  function() { return body || 'Test body content that is long enough to pass the 50-char check.'; },
    getSubject:    function() { return subject || 'Test Subject'; },
    getTo:         function() { return to || 'recipient@example.com'; },
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

// ─── PURE: parseInterval_ ──────────────────────────────────────────────────────

function testParseInterval_(results) {
  results.push(assert('parseInterval_("2weeks") → 14',           parseInterval_('2weeks') === 14));
  results.push(assert('parseInterval_("1week") → 7',             parseInterval_('1week') === 7));
  results.push(assert('parseInterval_("3days") → 3',             parseInterval_('3days') === 3));
  results.push(assert('parseInterval_("1month") → 30',           parseInterval_('1month') === 30));
  results.push(assert('parseInterval_("1year") → 365',           parseInterval_('1year') === 365));
  results.push(assert('parseInterval_("2 years") → 730',         parseInterval_('2 years') === 730));
  results.push(assert('parseInterval_("0days") → 0',             parseInterval_('0days') === 0));
  results.push(assert('parseInterval_("") → null',               parseInterval_('') === null));
  results.push(assert('parseInterval_("invalid") → null',        parseInterval_('invalid') === null));
  results.push(assert('parseInterval_("2weeks") case test',      parseInterval_('2Weeks') === 14));
}

// ─── PURE: getIntervalFromLabel_ ───────────────────────────────────────────────

function testGetIntervalFromLabel_(results) {
  results.push(assert('getIntervalFromLabel_("remind-every/2weeks") → 14',  getIntervalFromLabel_('remind-every/2weeks') === 14));
  results.push(assert('getIntervalFromLabel_("remind-every/1month") → 30',  getIntervalFromLabel_('remind-every/1month') === 30));
  results.push(assert('getIntervalFromLabel_("remind-every/on-hold") → null', getIntervalFromLabel_('remind-every/on-hold') === null));
  results.push(assert('getIntervalFromLabel_("other") → null',             getIntervalFromLabel_('other') === null));
  results.push(assert('getIntervalFromLabel_("remind-every") → null',      getIntervalFromLabel_('remind-every') === null));
}

// ─── PURE: isIgnoredSender_ ────────────────────────────────────────────────────

function testIsIgnoredSender_(results) {
  results.push(assert('isIgnoredSender_: AWV system mail → true',
    isIgnoredSender_('klantendienst-awv@wegenenverkeer.be') === true));
  results.push(assert('isIgnoredSender_: wegenenverkeer.be → true',
    isIgnoredSender_('info@wegenenverkeer.be') === true));
  results.push(assert('isIgnoredSender_: normal sender → false',
    isIgnoredSender_('someone@example.com') === false));
  results.push(assert('isIgnoredSender_: empty string → false',
    isIgnoredSender_('') === false));
  results.push(assert('isIgnoredSender_: case insensitive',
    isIgnoredSender_('KLANTENDIENST-AWV@WEGENENVERKEER.BE') === true));
}

// ─── PURE: detectLanguage_ ─────────────────────────────────────────────────────

function testDetectLanguage_(results) {
  results.push(assert('detectLanguage_: Dutch text → "nl"',
    detectLanguage_('Dit is een test bericht voor de gemeente.') === 'nl'));
  results.push(assert('detectLanguage_: English text → "en"',
    detectLanguage_('This is a test message for the municipality.') === 'en'));
  results.push(assert('detectLanguage_: mixed → "en" (fewer than 3 Dutch words)',
    detectLanguage_('De test message for the municipality.') === 'en'));
  results.push(assert('detectLanguage_: empty → "en"',
    detectLanguage_('') === 'en'));
  results.push(assert('detectLanguage_: full Dutch sentence',
    detectLanguage_('Geachte heer, wij hebben uw bericht ontvangen en zijn er mee bezig.') === 'nl'));
}

// ─── PURE: extractEmail_ ───────────────────────────────────────────────────────

function testExtractEmail_(results) {
  results.push(assert('extractEmail_: Name <email>',
    extractEmail_('John Doe <john@example.com>') === 'john@example.com'));
  results.push(assert('extractEmail_: bare email',
    extractEmail_('john@example.com') === 'john@example.com'));
  results.push(assert('extractEmail_: quoted name',
    extractEmail_('"John, Doe" <john@example.com>') === 'john@example.com'));
  results.push(assert('extractEmail_: empty', extractEmail_('') === ''));
  results.push(assert('extractEmail_: no angle brackets',
    extractEmail_('just text') === 'just text'));
}

// ─── PURE: extractName_ ────────────────────────────────────────────────────────

function testExtractName_(results) {
  results.push(assert('extractName_: Name <email>',
    extractName_('John Doe <john@example.com>') === 'John Doe'));
  results.push(assert('extractName_: quoted name',
    extractName_('"John, Doe" <john@example.com>') === 'John, Doe'));
  results.push(assert('extractName_: bare email → null',
    extractName_('john@example.com') === null));
  results.push(assert('extractName_: empty → null',
    extractName_('') === null));
}

// ─── PURE: cleanSubject_ ───────────────────────────────────────────────────────

function testCleanSubject_(results) {
  results.push(assert('cleanSubject_: Re: prefix',       cleanSubject_('Re: test') === 'test'));
  results.push(assert('cleanSubject_: FW: prefix',       cleanSubject_('FW: test') === 'test'));
  results.push(assert('cleanSubject_: Antw: prefix',     cleanSubject_('Antw: test') === 'test'));
  results.push(assert('cleanSubject_: nested Re:',       cleanSubject_('Re: Re: test') === 'test'));
  results.push(assert('cleanSubject_: no prefix',        cleanSubject_('test') === 'test'));
  results.push(assert('cleanSubject_: empty',             cleanSubject_('') === ''));
  results.push(assert('cleanSubject_: AWV: prefix',      cleanSubject_('AWV: melding') === 'melding'));
  results.push(assert('cleanSubject_: Re/FW mixed',      cleanSubject_('Re: FW: test') === 'test'));
}

// ─── PURE: buildFallbackText_ ──────────────────────────────────────────────────

function testBuildFallbackText_(results) {
  const nlBody = buildFallbackText_('Jan Jansen', 'Test onderwerp', 'nl');
  results.push(assert('buildFallbackText_ NL: contains name',     nlBody.includes('Jan Jansen')));
  results.push(assert('buildFallbackText_ NL: contains subject',  nlBody.includes('Test onderwerp')));
  results.push(assert('buildFallbackText_ NL: NL greeting',       nlBody.includes('Beste')));
  results.push(assert('buildFallbackText_ NL: NL closing',        nlBody.includes('Met vriendelijke groeten')));
  results.push(assert('buildFallbackText_ NL: signed',            nlBody.includes(CONFIG.SENDER_ALIAS)));

  const enBody = buildFallbackText_('John Doe', 'Test subject', 'en');
  results.push(assert('buildFallbackText_ EN: contains name',     enBody.includes('John Doe')));
  results.push(assert('buildFallbackText_ EN: contains subject',  enBody.includes('Test subject')));
  results.push(assert('buildFallbackText_ EN: EN greeting',       enBody.includes('Dear')));
  results.push(assert('buildFallbackText_ EN: EN closing',        enBody.includes('Kind regards')));
  results.push(assert('buildFallbackText_ EN: signed',            enBody.includes(CONFIG.SENDER_ALIAS)));

  const noName = buildFallbackText_(null, 'Subject', 'nl');
  results.push(assert('buildFallbackText_: null name uses "there"', noName.includes('there')));

  results.push(assert('buildFallbackText_: no null leaking',       !nlBody.includes('null')));
}

// ─── PURE: formatDateNL_ ───────────────────────────────────────────────────────

function testFormatDateNL_(results) {
  const date = new Date(2026, 5, 19); // June 19, 2026
  const formatted = formatDateNL_(date);
  results.push(assert('formatDateNL_: contains day number',  formatted.includes('19')));
  results.push(assert('formatDateNL_: contains month',       formatted.includes('juni') || formatted.includes('June')));
  results.push(assert('formatDateNL_: contains year',        formatted.includes('2026')));
}

// ─── MOCK: hasOnHold_ ──────────────────────────────────────────────────────────

function testHasOnHold_(results) {
  const onHoldLabel  = makeLabel(CONFIG.ON_HOLD);
  const otherLabel   = makeLabel('remind-every/2weeks');

  const threadOnHold    = makeThread([], [onHoldLabel]);
  const threadOther     = makeThread([], [otherLabel]);
  const threadNoLabels  = makeThread([], []);

  results.push(assert('hasOnHold_: on-hold present → true',  hasOnHold_(threadOnHold) === true));
  results.push(assert('hasOnHold_: other label → false',     hasOnHold_(threadOther) === false));
  results.push(assert('hasOnHold_: no labels → false',       hasOnHold_(threadNoLabels) === false));
}

// ─── MOCK: hasRecipientReplied_ ────────────────────────────────────────────────

function testHasRecipientReplied_(results) {
  const my      = CONFIG.MY_EMAIL;
  const awv     = 'awv@wegenenverkeer.be';
  const other   = 'burger@example.com';

  const onlyAwv  = makeThread([makeMessage(awv)]);
  const awvThenOther = makeThread([makeMessage(awv), makeMessage(other)]);
  const awvThenAwv2  = makeThread([makeMessage(awv), makeMessage(awv)]);
  const awvThenMe    = makeThread([makeMessage(awv), makeMessage(my)]);

  results.push(assert('hasRecipientReplied_: single message → false',  hasRecipientReplied_(onlyAwv) === false));
  results.push(assert('hasRecipientReplied_: third party → true',      hasRecipientReplied_(awvThenOther) === true));
  results.push(assert('hasRecipientReplied_: AWV only → false',        hasRecipientReplied_(awvThenAwv2) === false));
  results.push(assert('hasRecipientReplied_: my own → false',          hasRecipientReplied_(awvThenMe) === false));
}

// ─── MOCK: getLastSentByMeDate_ ────────────────────────────────────────────────

function testGetLastSentByMeDate_(results) {
  const my    = CONFIG.MY_EMAIL;
  const other = 'someone@example.com';
  const now   = new Date();
  const older = new Date(now.getTime() - 86400000); // 1 day ago

  const myMessage    = makeMessage(my, now);
  const otherMessage = makeMessage(other, older);
  const thread       = makeThread([otherMessage, myMessage]);

  const result = getLastSentByMeDate_(thread);
  results.push(assert('getLastSentByMeDate_: finds my latest message', result.getTime() === now.getTime()));

  const noReply  = makeThread([makeMessage(other, older)]);
  const result2  = getLastSentByMeDate_(noReply);
  results.push(assert('getLastSentByMeDate_: falls back to last message date', result2.getTime() === older.getTime()));
}

// ─── MOCK: getLastNonOwnMessage_ ───────────────────────────────────────────────

function testGetLastNonOwnMessage_(results) {
  const my    = CONFIG.MY_EMAIL;
  const other = 'burger@example.com';

  const myMsg     = makeMessage(my);
  const otherMsg  = makeMessage(other);

  const mixed     = makeThread([myMsg, otherMsg, myMsg]);
  const noOther   = makeThread([myMsg, myMsg]);
  const onlyOther = makeThread([otherMsg]);

  results.push(assert('getLastNonOwnMessage_: finds last non-own message',
    getLastNonOwnMessage_(mixed) === otherMsg));
  results.push(assert('getLastNonOwnMessage_: all own messages → null',
    getLastNonOwnMessage_(noOther) === null));
  results.push(assert('getLastNonOwnMessage_: only non-own message',
    getLastNonOwnMessage_(onlyOther) === otherMsg));

  // Multiple non-own messages — should find the LAST one
  const otherMsg2 = makeMessage('tweede@example.com');
  const multi     = makeThread([myMsg, otherMsg, myMsg, otherMsg2]);
  results.push(assert('getLastNonOwnMessage_: last of multiple non-own',
    getLastNonOwnMessage_(multi) === otherMsg2));
}

// ─── MOCK: findReminderRecipient_ ──────────────────────────────────────────────

function testFindReminderRecipient_(results) {
  const my    = CONFIG.MY_EMAIL;
  const other = 'burger@example.com';

  // Thread with recipient who replied
  const thread    = makeThread([makeMessage(other), makeMessage(my)]);
  const recipient = findReminderRecipient_(thread);

  results.push(assert('findReminderRecipient_: finds email',  recipient.email === 'burger@example.com'));

  // Thread with only my messages — falls back to To field
  const myOnly         = makeThread([makeMessage(my)]);
  const fallbackRecip  = findReminderRecipient_(myOnly);
  results.push(assert('findReminderRecipient_: fallback exists', fallbackRecip.email !== null));
}

// ─── MASTER RUNNER ───────────────────────────────────────────────────────────

/**
 * Run ALL tests across all test files
 */
function runAllTestsMaster() {
  log('=== MASTER TEST RUNNER ===');
  
  log('\n--- Running Test.gs tests ---');
  runAllTests();
  
  log('\n--- Running TestCore.gs tests ---');
  runAllCoreTests();
  
  log('=== ALL TESTS COMPLETE ===');
}
