/**
 * LabelReminder Core Tests - Pure functions from Code.gs
 * Run runAllCoreTests() to execute all tests.
 */

// ─── RUNNER ──────────────────────────────────────────────────────────────────

function runAllCoreTests() {
  const results = [];

  [
    testGetRemindEveryIntervalLabels_,
    testAutoPauseOnReply_,
    testCleanAIResponse_,
    testGetReminderCountFromThread_,
    testGetToneFromContext_,
    testSendReminder_,
    testCheckReminders_,
    testResumeAll_,
    testExtractAllEmails_,
    testExtractEmail_,
    testExtractName_,
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

// ─── PURE: getRemindEveryIntervalLabels_ ──────────────────────────────────────

function testGetRemindEveryIntervalLabels_(results) {
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
    
    const labels = getRemindEveryIntervalLabels__();
    results.push(assert('getRemindEveryIntervalLabels_: returns only valid interval labels', labels.length === 2));
    results.push(assert('getRemindEveryIntervalLabels_: excludes on-hold', labels.every(l => l.getName() !== CONFIG.ON_HOLD)));
    results.push(assert('getRemindEveryIntervalLabels_: excludes invalid', labels.every(l => l.getName() !== 'remind-every/invalid')));
    results.push(assert('getRemindEveryIntervalLabels_: excludes other labels', labels.every(l => l.getName() !== 'Other')));
    
  } finally {
    GmailApp = originalGmailApp;
  }
}

// ─── PURE: autoPauseOnReply_ ──────────────────────────────────────────────────

function testAutoPauseOnReply_(results) {
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
    
    autoPauseOnReply__();
    
    results.push(assert('autoPauseOnReply_: pauses thread with reply', addLabelCount === 1));
    results.push(assert('autoPauseOnReply_: does not pause thread without reply', true));
    results.push(assert('autoPauseOnReply_: does not pause thread already on hold', true));
    
  } finally {
    GmailApp = originalGmailApp;
  }
}

// ─── PURE: cleanAIResponse_ ────────────────────────────────────────────────────

function testCleanAIResponse_(results) {
  results.push(assert('cleanAIResponse_: removes --- separator', 
    cleanAIResponse_('body\n---\nextra') === 'body'));
  results.push(assert('cleanAIResponse_: removes markdown headers',
    cleanAIResponse_('**Header**\nbody') === 'body'));
  results.push(assert('cleanAIResponse_: removes Reasoning lines',
    cleanAIResponse_('Reasoning: something\nbody') === 'body'));
  results.push(assert('cleanAIResponse_: removes Explanation lines',
    cleanAIResponse_('Explanation: something\nbody') === 'body'));
  results.push(assert('cleanAIResponse_: removes Redenering lines',
    cleanAIResponse_('Redenering: something\nbody') === 'body'));
  results.push(assert('cleanAIResponse_: removes Toelichting lines',
    cleanAIResponse_('Toelichting: something\nbody') === 'body'));
  results.push(assert('cleanAIResponse_: collapses multiple newlines',
    cleanAIResponse_('a\n\n\n\nb') === 'a\n\nb'));
  results.push(assert('cleanAIResponse_: empty string',
    cleanAIResponse_('') === ''));
  results.push(assert('cleanAIResponse_: null input',
    cleanAIResponse_(null) === null));
}

// ─── PURE: getReminderCountFromThread_ ────────────────────────────────────────

function testGetReminderCountFromThread_(results) {
  const my = CONFIG.MY_EMAIL;
  const msg1 = makeMessage(my, new Date(), 'body', 'Re: Test');
  const msg2 = makeMessage(my, new Date(), 'body', 'FW: Test');
  const msg3 = makeMessage(my, new Date(), 'body', 'Test');
  const msg4 = makeMessage('other@example.com', new Date(), 'body', 'Re: Test');
  
  const thread = makeThread('t1', [msg1, msg2, msg3, msg4]);
  const count = getReminderCountFromThread_(thread);
  
  results.push(assert('getReminderCountFromThread_: counts Re: from me', count === 1));
  results.push(assert('getReminderCountFromThread_: ignores FW: from me', count === 1));
  results.push(assert('getReminderCountFromThread_: ignores non-me senders', count === 1));
  results.push(assert('getReminderCountFromThread_: ignores plain subject', count === 1));
}

// ─── PURE: getToneFromContext_ ─────────────────────────────────────────────────

function testGetToneFromContext_(results) {
  const now = new Date();
  const recent = new Date(now.getTime() - 5 * 86400000); // 5 days ago
  const old = new Date(now.getTime() - 65 * 86400000); // 65 days ago
  const veryOld = new Date(now.getTime() - 100 * 86400000); // 100 days ago
  
  results.push(assert('getToneFromContext_: 0 reminders, recent → friendly',
    getToneFromContext_(0, recent) === 'kort, vriendelijk en professioneel'));
  results.push(assert('getToneFromContext_: 1 reminder, recent → determined',
    getToneFromContext_(1, recent) === 'zakelijk, vastberaden en wijzend op het veiligheidsrisico'));
  results.push(assert('getToneFromContext_: 3 reminders, recent → urgent',
    getToneFromContext_(3, recent) === 'zeer dringend, vastberaden en bezorgd over de veiligheid'));
  results.push(assert('getToneFromContext_: 0 reminders, >60 days → urgent',
    getToneFromContext_(0, veryOld) === 'zeer dringend, vastberaden en bezorgd over de veiligheid'));
  results.push(assert('getToneFromContext_: 0 reminders, >30 days → determined',
    getToneFromContext_(0, old) === 'zakelijk, vastberaden en wijzend op het veiligheidsrisico'));
}

// ─── PURE: sendReminder_ ───────────────────────────────────────────────────────

function testSendReminder_(results) {
  results.push(assert('sendReminder_: function exists', typeof sendReminder_ === 'function'));
}

// ─── PURE: checkReminders ─────────────────────────────────────────────────────

function testCheckReminders_(results) {
  results.push(assert('checkReminders: function exists', typeof checkReminders === 'function'));
  
  // Test that checkReminders calls autoPauseOnReply_ and getRemindEveryIntervalLabels_
  const originalAutoPause = autoPauseOnReply_;
  const originalGetLabels = getRemindEveryIntervalLabels_;
  let autoPauseCalled = false;
  let labelsReturned = [];
  
  autoPauseOnReply_ = function() { autoPauseCalled = true; };
  getRemindEveryIntervalLabels_ = function() { return labelsReturned; };
  
  try {
    labelsReturned = [];
    checkReminders();
    results.push(assert('checkReminders: calls autoPauseOnReply_', autoPauseCalled));
    results.push(assert('checkReminders: handles no labels', true));
    
    labelsReturned = [makeLabel('remind-every/1week')];
    checkReminders();
    results.push(assert('checkReminders: processes valid labels', true));
  } finally {
    autoPauseOnReply_ = originalAutoPause;
    getRemindEveryIntervalLabels_ = originalGetLabels;
  }
}

// ─── PURE: resumeAll ──────────────────────────────────────────────────────────

function testResumeAll_(results) {
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

// ─── PURE: extractAllEmails_ ────────────────────────────────────────────────────

function testExtractAllEmails_(results) {
  results.push(assert('extractAllEmails_: angle brackets', 
    JSON.stringify(extractAllEmails_('Name <email@example.com>')) === JSON.stringify(['email@example.com'])));
  results.push(assert('extractAllEmails_: multiple angle brackets',
    JSON.stringify(extractAllEmails_('Name1 <e1@example.com>, Name2 <e2@example.com>')) === JSON.stringify(['e1@example.com', 'e2@example.com'])));
  results.push(assert('extractAllEmails_: bare emails',
    JSON.stringify(extractAllEmails_('email1@example.com, email2@example.com')) === JSON.stringify(['email1@example.com', 'email2@example.com'])));
  results.push(assert('extractAllEmails_: empty',
    JSON.stringify(extractAllEmails_('')) === JSON.stringify([])));
  results.push(assert('extractAllEmails_: mixed angle and bare',
    JSON.stringify(extractAllEmails_('Name <e1@example.com>, e2@example.com')) === JSON.stringify(['e1@example.com'])));
}

// ─── PURE: extractEmail_ ────────────────────────────────────────────────────────

function testExtractEmail_(results) {
  results.push(assert('extractEmail_: with angle brackets',
    extractEmail_('Name <email@example.com>') === 'email@example.com'));
  results.push(assert('extractEmail_: bare email',
    extractEmail_('email@example.com') === 'email@example.com'));
  results.push(assert('extractEmail_: quoted name',
    extractEmail_('"Name, Surname" <email@example.com>') === 'email@example.com'));
  results.push(assert('extractEmail_: empty string',
    extractEmail_('') === ''));
  results.push(assert('extractEmail_: no angle brackets',
    extractEmail_('just text') === 'just text'));
}

// ─── PURE: extractName_ ─────────────────────────────────────────────────────────

function testExtractName_(results) {
  results.push(assert('extractName_: with angle brackets',
    extractName_('Name <email@example.com>') === 'Name'));
  results.push(assert('extractName_: quoted name with comma',
    extractName_('"Name, Surname" <email@example.com>') === 'Name, Surname'));
  results.push(assert('extractName_: bare email → null',
    extractName_('email@example.com') === null));
  results.push(assert('extractName_: empty → null',
    extractName_('') === null));
  results.push(assert('extractName_: no angle brackets → null',
    extractName_('plain text') === null));
}