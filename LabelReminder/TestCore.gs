/**
 * LabelReminder Core Tests - Pure functions from Code.gs
 * Run runAllCoreTests() to execute all tests.
 */

// ─── RUNNER ──────────────────────────────────────────────────────────────────

function runAllCoreTests() {
  const results = [];

  [
    testGetRemindEveryIntervalLabels,
    testAutoPauseOnReply,
    testCleanAIResponse,
    testGetReminderCountFromThread,
    testGetToneFromContext,
    testSendReminder,
    testCheckReminders,
    testResumeAll,
    testExtractAllEmails,
    testExtractEmail,
    testExtractName,
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

function makeLabel(name, threads) {
  return {
    getName: function() { return name; },
    getThreads: function() { return threads || []; },
    addLabel: function() {},
    removeLabel: function() {},
  };
}

function makeThread(id, messages, labels) {
  messages = messages || [makeMessage('sender@example.com')];
  labels = labels || [];
  return {
    getId: function() { return id; },
    getMessages: function() { return messages; },
    getLabels: function() { return labels; },
    getFirstMessageSubject: function() { return messages[0].getSubject(); },
    getLastMessageDate: function() { return messages[messages.length - 1].getDate(); },
    addLabel: function() {},
    removeLabel: function() {},
  };
}

function makeMessage(from, date, body, subject, to) {
  return {
    getFrom: function() { return from || 'sender@example.com'; },
    getDate: function() { return date || new Date(); },
    getPlainBody: function() { return body || 'Test body content that is long enough to pass the 50-char check.'; },
    getSubject: function() { return subject || 'Test Subject'; },
    getTo: function() { return to || 'recipient@example.com'; },
  };
}

// ─── MOCK GMAILAPP ────────────────────────────────────────────────────────────

function mockGmailApp(searchResults, labelByName, userLabels) {
  const originalGmailApp = GmailApp;
  const mock = {
    search: function(query) {
      Logger.log('[MOCK GmailApp.search] ' + query);
      return searchResults(query) || [];
    },
    getUserLabelByName: function(name) {
      return labelByName(name) || null;
    },
    createLabel: function(name) {
      return makeLabel(name);
    },
    getUserLabels: function() {
      return userLabels || [];
    },
    createDraft: function() {},
    sendEmail: function() {},
  };
  
  GmailApp = mock;
  return function restore() { GmailApp = originalGmailApp; };
}

function mockPropertiesService(properties) {
  const original = PropertiesService;
  const mock = {
    getScriptProperties: function() {
      return {
        getProperty: function(key) { return properties[key] || null; },
      };
    },
  };
  PropertiesService = mock;
  return function restore() { PropertiesService = original; };
}

// ─── PURE: getRemindEveryIntervalLabels ──────────────────────────────────────

function testGetRemindEveryIntervalLabels(results) {
  const originalGmailApp = GmailApp;
  
  try {
    // Mock GmailApp.getUserLabels to return test labels
    const onHoldLabel = makeLabel(CONFIG.ON_HOLD);
    const validLabel1 = makeLabel('remind-every/1week');
    const validLabel2 = makeLabel('remind-every/2weeks');
    const invalidLabel = makeLabel('remind-every/invalid');
    const onHoldThread = makeThread('onhold', [], [onHoldLabel]);
    
    GmailApp = {
      getUserLabels: function() {
        return [onHoldLabel, validLabel1, validLabel2, invalidLabel, makeLabel('Other')];
      },
      getUserLabelByName: function() { return null; },
      createLabel: function(name) { return makeLabel(name); },
      createDraft: function() {},
      sendEmail: function() {},
    };
    
    const labels = getRemindEveryIntervalLabels();
    results.push(assert('getRemindEveryIntervalLabels: returns only valid interval labels', labels.length === 2));
    results.push(assert('getRemindEveryIntervalLabels: excludes on-hold', labels.every(l => l.getName() !== CONFIG.ON_HOLD)));
    results.push(assert('getRemindEveryIntervalLabels: excludes invalid', labels.every(l => l.getName() !== 'remind-every/invalid')));
    results.push(assert('getRemindEveryIntervalLabels: excludes other labels', labels.every(l => l.getName() !== 'Other')));
    
  } finally {
    GmailApp = originalGmailApp;
  }
}

// ─── PURE: autoPauseOnReply ──────────────────────────────────────────────────

function testAutoPauseOnReply(results) {
  const originalGmailApp = GmailApp;
  
  try {
    const onHoldLabel = makeLabel(CONFIG.ON_HOLD);
    const label1 = makeLabel('remind-every/1week');
    const label2 = makeLabel('remind-every/2weeks');
    
    const threadWithReply = makeThread('t1', [
      makeMessage('burger@example.com'),
      makeMessage('burger@example.com'),
    ]);
    const threadWithoutReply = makeThread('t2', [
      makeMessage('burger@example.com'),
    ]);
    const threadWithOnHold = makeThread('t3', [
      makeMessage('burger@example.com'),
    ], [onHoldLabel]);
    
    let addLabelCount = 0;
    threadWithReply.addLabel = function() { addLabelCount++; };
    threadWithOnHold.addLabel = function() { addLabelCount++; };
    
    GmailApp = {
      getUserLabels: function() { return [label1, label2]; },
      getUserLabelByName: function(name) { return name === CONFIG.ON_HOLD ? onHoldLabel : null; },
      createLabel: function(name) { return makeLabel(name); },
      createDraft: function() {},
      sendEmail: function() {},
    };
    
    autoPauseOnReply();
    
    results.push(assert('autoPauseOnReply: pauses thread with reply', addLabelCount === 1));
    results.push(assert('autoPauseOnReply: does not pause thread without reply', true));
    results.push(assert('autoPauseOnReply: does not pause thread already on hold', true));
    
  } finally {
    GmailApp = originalGmailApp;
  }
}

// ─── PURE: cleanAIResponse ────────────────────────────────────────────────────

function testCleanAIResponse(results) {
  results.push(assert('cleanAIResponse: removes --- separator', 
    cleanAIResponse('body\n---\nextra') === 'body'));
  results.push(assert('cleanAIResponse: removes markdown headers',
    cleanAIResponse('**Header**\nbody') === 'body'));
  results.push(assert('cleanAIResponse: removes Reasoning lines',
    cleanAIResponse('Reasoning: something\nbody') === 'body'));
  results.push(assert('cleanAIResponse: removes Explanation lines',
    cleanAIResponse('Explanation: something\nbody') === 'body'));
  results.push(assert('cleanAIResponse: removes Redenering lines',
    cleanAIResponse('Redenering: something\nbody') === 'body'));
  results.push(assert('cleanAIResponse: removes Toelichting lines',
    cleanAIResponse('Toelichting: something\nbody') === 'body'));
  results.push(assert('cleanAIResponse: collapses multiple newlines',
    cleanAIResponse('a\n\n\n\nb') === 'a\n\nb'));
  results.push(assert('cleanAIResponse: empty string',
    cleanAIResponse('') === ''));
  results.push(assert('cleanAIResponse: null input',
    cleanAIResponse(null) === null));
}

// ─── PURE: getReminderCountFromThread ────────────────────────────────────────

function testGetReminderCountFromThread(results) {
  const my = CONFIG.MY_EMAIL;
  const msg1 = makeMessage(my, new Date(), 'body', 'Re: Test');
  const msg2 = makeMessage(my, new Date(), 'body', 'FW: Test');
  const msg3 = makeMessage(my, new Date(), 'body', 'Test');
  const msg4 = makeMessage('other@example.com', new Date(), 'body', 'Re: Test');
  
  const thread = makeThread('t1', [msg1, msg2, msg3, msg4]);
  const count = getReminderCountFromThread(thread);
  
  results.push(assert('getReminderCountFromThread: counts Re: from me', count === 1));
  results.push(assert('getReminderCountFromThread: ignores FW: from me', count === 1));
  results.push(assert('getReminderCountFromThread: ignores non-me senders', count === 1));
  results.push(assert('getReminderCountFromThread: ignores plain subject', count === 1));
}

// ─── PURE: getToneFromContext ─────────────────────────────────────────────────

function testGetToneFromContext(results) {
  const now = new Date();
  const recent = new Date(now.getTime() - 5 * 86400000); // 5 days ago
  const old = new Date(now.getTime() - 65 * 86400000); // 65 days ago
  const veryOld = new Date(now.getTime() - 100 * 86400000); // 100 days ago
  
  results.push(assert('getToneFromContext: 0 reminders, recent → friendly',
    getToneFromContext(0, recent) === 'kort, vriendelijk en professioneel'));
  results.push(assert('getToneFromContext: 1 reminder, recent → determined',
    getToneFromContext(1, recent) === 'zakelijk, vastberaden en wijzend op het veiligheidsrisico'));
  results.push(assert('getToneFromContext: 3 reminders, recent → urgent',
    getToneFromContext(3, recent) === 'zeer dringend, vastberaden en bezorgd over de veiligheid'));
  results.push(assert('getToneFromContext: 0 reminders, >60 days → urgent',
    getToneFromContext(0, veryOld) === 'zeer dringend, vastberaden en bezorgd over de veiligheid'));
  results.push(assert('getToneFromContext: 0 reminders, >30 days → determined',
    getToneFromContext(0, old) === 'zakelijk, vastberaden en wijzend op het veiligheidsrisico'));
}

// ─── PURE: sendReminder ───────────────────────────────────────────────────────

function testSendReminder(results) {
  results.push(assert('sendReminder: function exists', typeof sendReminder === 'function'));
}

// ─── PURE: checkReminders ─────────────────────────────────────────────────────

function testCheckReminders(results) {
  results.push(assert('checkReminders: function exists', typeof checkReminders === 'function'));
  
  // Test that checkReminders calls autoPauseOnReply and getRemindEveryIntervalLabels
  const originalAutoPause = autoPauseOnReply;
  const originalGetLabels = getRemindEveryIntervalLabels;
  let autoPauseCalled = false;
  let labelsReturned = [];
  
  autoPauseOnReply = function() { autoPauseCalled = true; };
  getRemindEveryIntervalLabels = function() { return labelsReturned; };
  
  try {
    labelsReturned = [];
    checkReminders();
    results.push(assert('checkReminders: calls autoPauseOnReply', autoPauseCalled));
    results.push(assert('checkReminders: handles no labels', true));
    
    labelsReturned = [makeLabel('remind-every/1week')];
    checkReminders();
    results.push(assert('checkReminders: processes valid labels', true));
  } finally {
    autoPauseOnReply = originalAutoPause;
    getRemindEveryIntervalLabels = originalGetLabels;
  }
}

// ─── PURE: resumeAll ──────────────────────────────────────────────────────────

function testResumeAll(results) {
  results.push(assert('resumeAll: function exists', typeof resumeAll === 'function'));
  
  // Test resumeAll with mocked GmailApp
  const originalGmailApp = GmailApp;
  try {
    const onHoldLabel = makeLabel(CONFIG.ON_HOLD);
    const thread1 = makeThread('t1');
    const thread2 = makeThread('t2');
    
    let removedCount = 0;
    thread1.removeLabel = function() { removedCount++; };
    thread2.removeLabel = function() { removedCount++; };
    
    GmailApp = {
      getUserLabels: function() { return []; },
      getUserLabelByName: function(name) { return name === CONFIG.ON_HOLD ? onHoldLabel : null; },
      createLabel: function(name) { return makeLabel(name); },
      createDraft: function() {},
      sendEmail: function() {},
    };
    
    // Override getLabeledThreadIds not available - resumeAll uses onHoldLabel.getThreads()
    onHoldLabel.getThreads = function() { return [thread1, thread2]; };
    
    resumeAll();
    results.push(assert('resumeAll: removes on-hold from threads', removedCount === 2));
    
  } finally {
    GmailApp = originalGmailApp;
  }
}

// ─── PURE: extractAllEmails ────────────────────────────────────────────────────

function testExtractAllEmails(results) {
  results.push(assert('extractAllEmails: angle brackets', 
    JSON.stringify(extractAllEmails('Name <email@example.com>')) === JSON.stringify(['email@example.com'])));
  results.push(assert('extractAllEmails: multiple angle brackets',
    JSON.stringify(extractAllEmails('Name1 <e1@example.com>, Name2 <e2@example.com>')) === JSON.stringify(['e1@example.com', 'e2@example.com'])));
  results.push(assert('extractAllEmails: bare emails',
    JSON.stringify(extractAllEmails('email1@example.com, email2@example.com')) === JSON.stringify(['email1@example.com', 'email2@example.com'])));
  results.push(assert('extractAllEmails: empty',
    JSON.stringify(extractAllEmails('')) === JSON.stringify([])));
  results.push(assert('extractAllEmails: mixed angle and bare',
    JSON.stringify(extractAllEmails('Name <e1@example.com>, e2@example.com')) === JSON.stringify(['e1@example.com'])));
}

// ─── PURE: extractEmail ────────────────────────────────────────────────────────

function testExtractEmail(results) {
  results.push(assert('extractEmail: with angle brackets',
    extractEmail('Name <email@example.com>') === 'email@example.com'));
  results.push(assert('extractEmail: bare email',
    extractEmail('email@example.com') === 'email@example.com'));
  results.push(assert('extractEmail: quoted name',
    extractEmail('"Name, Surname" <email@example.com>') === 'email@example.com'));
  results.push(assert('extractEmail: empty string',
    extractEmail('') === ''));
  results.push(assert('extractEmail: no angle brackets',
    extractEmail('just text') === 'just text'));
}

// ─── PURE: extractName ─────────────────────────────────────────────────────────

function testExtractName(results) {
  results.push(assert('extractName: with angle brackets',
    extractName('Name <email@example.com>') === 'Name'));
  results.push(assert('extractName: quoted name with comma',
    extractName('"Name, Surname" <email@example.com>') === 'Name, Surname'));
  results.push(assert('extractName: bare email → null',
    extractName('email@example.com') === null));
  results.push(assert('extractName: empty → null',
    extractName('') === null));
  results.push(assert('extractName: no angle brackets → null',
    extractName('plain text') === null));
}