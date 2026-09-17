/**
 * FollowUpReminder Core Tests - Pure functions from Code.gs
 * Run runAllCoreTests() to execute all tests.
 */

// ─── RUNNER ──────────────────────────────────────────────────────────────────

function runAllCoreTests() {
  const results = [];

  [
    testAwvDossierQuery,
    testSyncLabelsHelpers,
    testBuildReminderCountMap,
    testCollectPendingHelpers,
    testBatchCheckCrossThreadReply,
    testDeliverEmail,
    testComposeBody,
    testBuildCombinedPdfHelpers,
    testGetLabeledThreadIds,
    testDaysAgo,
    testFormatDateDisplay,
    testProcessFollowUps,
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
  messages = messages || [makeMessage('awv@wegenenverkeer.be')];
  labels = labels || [];
  return {
    getId: function() { return id; },
    getMessages: function() { return messages; },
    getLabels: function() { return labels; },
    getFirstMessageSubject: function() { return messages[0].getSubject(); },
    addLabel: function() {},
    removeLabel: function() {},
  };
}

function makeMessage(from, subject, body) {
  return {
    getFrom: function() { return from; },
    getSubject: function() { return subject || 'Test Subject'; },
    getPlainBody: function() { return body || 'Test body content'; },
    getDate: function() { return new Date(); },
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

// ─── PURE: awvDossierQuery ───────────────────────────────────────────────────

function testAwvDossierQuery(results) {
  results.push(assert('awvDossierQuery: basic', awvDossierQuery('test@example.com') === 'from:klantendienst-awv@wegenenverkeer.be to:test@example.com cc:aldo.fieuw@gmail.com'));
  results.push(assert('awvDossierQuery: with extra', awvDossierQuery('test@example.com', 'after:2024/01/01') === 'from:klantendienst-awv@wegenenverkeer.be to:test@example.com cc:aldo.fieuw@gmail.com after:2024/01/01'));
  results.push(assert('awvDossierQuery: different address', awvDossierQuery('other@test.be').includes('to:other@test.be')));
}

// ─── PURE: syncLabels logic (applyCorrectLabel) ────────────────────────────────

function testSyncLabelsHelpers(results) {
  // Test applyCorrectLabel with mocked thread and labels
  const escalatedLabel = makeLabel('FollowUp/Escalated');
  const closedLabel = makeLabel('FollowUp/Closed');
  const countLabel1 = makeLabel('FollowUp/1');
  const countLabel2 = makeLabel('FollowUp/2');
  
  // Test case 1: thread has no labels, count=1 → should add FollowUp/1
  const thread1 = makeThread('thread1', [makeMessage('awv@wegenenverkeer.be', 'FW: (KM-2026-00001)')], []);
  let addedLabel = null;
  thread1.addLabel = function(l) { addedLabel = l; };
  thread1.removeLabel = function() {};

  applyCorrectLabel(thread1, 1, escalatedLabel);
  results.push(assert('applyCorrectLabel: count=1 adds FollowUp/1', addedLabel && addedLabel.getName() === 'FollowUp/1'));
  
  // Test case 2: thread already has FollowUp/1, count=2 → should replace with FollowUp/2
  const thread2 = makeThread('thread2', [makeMessage('awv@wegenenverkeer.be', 'FW: (KM-2026-00002)')], [countLabel1]);
  let removedLabel = null;
  addedLabel = null;
  thread2.addLabel = function(l) { addedLabel = l; };
  thread2.removeLabel = function(l) { removedLabel = l; };

  applyCorrectLabel(thread2, 2, escalatedLabel);
  results.push(assert('applyCorrectLabel: count=2 removes old label', removedLabel && removedLabel.getName() === 'FollowUp/1'));
  results.push(assert('applyCorrectLabel: count=2 adds FollowUp/2', addedLabel && addedLabel.getName() === 'FollowUp/2'));
  
  // Test case 3: thread is escalated → should not add count label
  const thread3 = makeThread('thread3', [makeMessage('awv@wegenenverkeer.be', 'FW: (KM-2026-00003)')], [escalatedLabel]);
  addedLabel = null;
  thread3.addLabel = function(l) { addedLabel = l; };

  applyCorrectLabel(thread3, 3, escalatedLabel);
  results.push(assert('applyCorrectLabel: escalated thread gets no count label', addedLabel === null));
  
  // Test case 4: thread is closed → should not add count label
  const thread4 = makeThread('thread4', [makeMessage('awv@wegenenverkeer.be', 'FW: (KM-2026-00004)')], [closedLabel]);
  addedLabel = null;
  thread4.addLabel = function(l) { addedLabel = l; };

  applyCorrectLabel(thread4, 1, escalatedLabel);
  results.push(assert('applyCorrectLabel: closed thread gets no count label', addedLabel === null));
  
  // Test case 5: count=0 → should not add count label
  const thread5 = makeThread('thread5', [makeMessage('awv@wegenenverkeer.be', 'FW: (KM-2026-00005)')], []);
  addedLabel = null;
  thread5.addLabel = function(l) { addedLabel = l; };

  applyCorrectLabel(thread5, 0, escalatedLabel);
  results.push(assert('applyCorrectLabel: count=0 gets no label', addedLabel === null));
}

// ─── PURE: buildReminderCountMap ──────────────────────────────────────────────

function testBuildReminderCountMap(results) {
  // Test the counting logic by mocking GmailApp.search
  const originalGmailApp = GmailApp;
  const originalCountMapCache = countMapCache;
  
  try {
    // Mock GmailApp.search to return test threads
    const testThread = makeThread('t1', [
      makeMessage('aldo.fieuw@gmail.com', 'Opvolgingsoverzicht openstaande meldingen - 19 juni 2026', 
        'KM-2026-00001\nKM-2026-00002\nKM-2026-00001') // KM-2026-00001 appears twice in same message
    ]);
    
    let searchCallCount = 0;
    GmailApp = {
      search: function(query) {
        searchCallCount++;
        if (query.includes('subject:"Opvolgingsoverzicht openstaande meldingen"')) {
          return [testThread];
        }
        return [];
      },
      getUserLabelByName: function() { return null; },
      createLabel: function(name) { return makeLabel(name); },
      getUserLabels: function() { return []; },
      createDraft: function() {},
      sendEmail: function() {},
    };
    
    // Clear cache
    countMapCache['mobiliteit@merelbeke-melle.be'] = null;
    
    const map = buildReminderCountMap('mobiliteit@merelbeke-melle.be');
    
    // Should count unique codes per message (KM-2026-00001 appears twice but deduplicated)
    results.push(assert('buildReminderCountMap: deduplicates within message', map.get('KM-2026-00001') === 1));
    results.push(assert('buildReminderCountMap: counts KM-2026-00002', map.get('KM-2026-00002') === 1));
    results.push(assert('buildReminderCountMap: returns Map', map instanceof Map));
    results.push(assert('buildReminderCountMap: caches result', countMapCache['mobiliteit@merelbeke-melle.be'] === map));
    results.push(assert('buildReminderCountMap: search called', searchCallCount === 1));
    
  } finally {
    GmailApp = originalGmailApp;
    countMapCache = originalCountMapCache;
  }
}

// ─── PURE: collectPending helpers ─────────────────────────────────────────────

function testCollectPendingHelpers(results) {
  results.push(assert('collectPending: function exists', typeof collectPending === 'function'));
  results.push(assert('batchCheckCrossThreadReply: function exists', typeof batchCheckCrossThreadReply === 'function'));
}

// ─── PURE: batchCheckCrossThreadReply ────────────────────────────────────────

function testBatchCheckCrossThreadReply(results) {
  // Test batching logic with mocked GmailApp
  const originalGmailApp = GmailApp;
  
  try {
    let searchCalls = [];
    GmailApp = {
      search: function(query) {
        searchCalls.push(query);
        // Simulate finding cross-thread replies for first batch
        if (query.includes('KM-2026-00001') || query.includes('KM-2026-00002')) {
          return [makeThread('cross1', [
            makeMessage('awv@wegenenverkeer.be', 'FW: (KM-2026-00001)'),
            makeMessage('mobiliteit@merelbeke-melle.be', 'Re: FW: (KM-2026-00001)')
          ])];
        }
        return [];
      },
      getUserLabelByName: function() { return null; },
      createLabel: function(name) { return makeLabel(name); },
      getUserLabels: function() { return []; },
      createDraft: function() {},
      sendEmail: function() {},
    };
    
    // Test with 60 codes (should batch into 2 calls of 50 + 10)
    const codes = [];
    for (let i = 1; i <= 60; i++) {
      codes.push('KM-2026-' + String(i).padStart(5, '0'));
    }
    
    const result = batchCheckCrossThreadReply(codes, 'mobiliteit@merelbeke-melle.be');
    
    results.push(assert('batchCheckCrossThreadReply: returns Set', result instanceof Set));
    results.push(assert('batchCheckCrossThreadReply: batches correctly', searchCalls.length === 2));
    results.push(assert('batchCheckCrossThreadReply: batch size 50', searchCalls[0].split(' OR ').length === 50));
    results.push(assert('batchCheckCrossThreadReply: second batch size 10', searchCalls[1].split(' OR ').length === 10));
    results.push(assert('batchCheckCrossThreadReply: found KM-2026-00001', result.has('KM-2026-00001')));
    results.push(assert('batchCheckCrossThreadReply: found KM-2026-00002', result.has('KM-2026-00002')));
    
    // Test empty array
    const emptyResult = batchCheckCrossThreadReply([], 'test@example.com');
    results.push(assert('batchCheckCrossThreadReply: empty array returns empty Set', emptyResult instanceof Set && emptyResult.size === 0));
    
  } finally {
    GmailApp = originalGmailApp;
  }
}

// ─── PURE: deliverEmail ──────────────────────────────────────────────────────

function testDeliverEmail(results) {
  // Test DRY_RUN mode
  const originalDryRun = CONFIG.DRY_RUN;
  const originalCreateDrafts = CONFIG.CREATE_DRAFTS;
  
  try {
    CONFIG.DRY_RUN = true;
    CONFIG.CREATE_DRAFTS = true;
    
    let logged = '';
    const originalLog = log;
    log = function(msg) { logged += msg + '\n'; };
    
    deliverEmail({
      to: 'test@example.com',
      subject: 'Test Subject',
      body: 'Test body',
      cc: 'cc@example.com',
    });
    
    results.push(assert('deliverEmail: DRY_RUN logs', logged.includes('[DRY-RUN] → test@example.com')));
    results.push(assert('deliverEmail: DRY_RUN logs subject', logged.includes('Test Subject')));
    results.push(assert('deliverEmail: DRY_RUN logs body', logged.includes('Test body')));
    results.push(assert('deliverEmail: DRY_RUN logs cc', logged.includes('cc@example.com')));
    
    log = originalLog;
  } finally {
    CONFIG.DRY_RUN = originalDryRun;
    CONFIG.CREATE_DRAFTS = originalCreateDrafts;
  }
  
  results.push(assert('deliverEmail: function exists', typeof deliverEmail === 'function'));
}

// ─── PURE: composeBody ────────────────────────────────────────────────────────

function testComposeBody(results) {
  const originalRewriteProse = rewriteProse;
  rewriteProse = function(prose) { return '[REWRITTEN] ' + prose; };
  
  try {
    const result = composeBody('intro', 'list', 'outro');
    results.push(assert('composeBody: combines parts', result.includes('[REWRITTEN] intro')));
    results.push(assert('composeBody: includes list', result.includes('list')));
    results.push(assert('composeBody: includes outro', result.includes('[REWRITTEN] outro')));
    results.push(assert('composeBody: separates with blank lines', result.split('\n\n').length >= 4));
  } finally {
    rewriteProse = originalRewriteProse;
  }
  
  // Test with empty strings
  const originalRewriteProse2 = rewriteProse;
  rewriteProse = function(prose) { return prose; };
  try {
    const result = composeBody('', '', '');
    results.push(assert('composeBody: handles empty strings', result === '\n\n\n\n'));
  } finally {
    rewriteProse = originalRewriteProse2;
  }
}

// ─── PURE: buildCombinedPdf helpers ──────────────────────────────────────────

function testBuildCombinedPdfHelpers(results) {
  results.push(assert('buildCombinedPdf: function exists', typeof buildCombinedPdf === 'function'));
  results.push(assert('escapeHtml: function exists', typeof escapeHtml === 'function'));
  
  // Test escapeHtml
  results.push(assert('escapeHtml: & → &', escapeHtml('a&b') === 'a&b'));
  results.push(assert('escapeHtml: < → <', escapeHtml('<tag>') === '<tag>'));
  results.push(assert('escapeHtml: > → >', escapeHtml('5 > 3') === '5 > 3'));
  results.push(assert('escapeHtml: " → "', escapeHtml('say "hi"') === 'say "hi"'));
  results.push(assert('escapeHtml: normal string unchanged', escapeHtml('hello world') === 'hello world'));
  results.push(assert('escapeHtml: empty string', escapeHtml('') === ''));
  results.push(assert('escapeHtml: null input', escapeHtml(null) === 'null'));
  
  // Test buildCombinedPdf with mock
  const originalHtmlService = HtmlService;
  try {
    const mockHtmlOutput = {
      getAs: function() { return { setName: function() {} }; },
    };
    HtmlService = {
      createHtmlOutput: function(html) {
        return mockHtmlOutput;
      },
    };
    
    const pending = [{
      ticketCode: 'KM-2026-00001',
      sentDate: new Date(2026, 5, 19),
      subject: 'Test Subject',
      thread: makeThread('t1', [makeMessage('awv@wegenenverkeer.be', 'Test', 'Locatiegegevens: Teststraat 1\n\nBerichten: Test complaint')]),
    }];
    
    const pdf = buildCombinedPdf(pending);
    results.push(assert('buildCombinedPdf: returns blob', pdf && typeof pdf.getName === 'function'));
    results.push(assert('buildCombinedPdf: names file correctly', pdf.getName().includes('Meldingen_')));
    
  } finally {
    HtmlService = originalHtmlService;
  }
}

// ─── PURE: getLabeledThreadIds ────────────────────────────────────────────────

function testGetLabeledThreadIds(results) {
  // Test with mocked label
  const label = makeLabel('TestLabel', [
    makeThread('thread1'),
    makeThread('thread2'),
    makeThread('thread3'),
  ]);
  
  const ids = getLabeledThreadIds(label);
  results.push(assert('getLabeledThreadIds: returns Set', ids instanceof Set));
  results.push(assert('getLabeledThreadIds: correct size', ids.size === 3));
  results.push(assert('getLabeledThreadIds: contains thread1', ids.has('thread1')));
  results.push(assert('getLabeledThreadIds: contains thread2', ids.has('thread2')));
  results.push(assert('getLabeledThreadIds: contains thread3', ids.has('thread3')));
}

// ─── PURE: daysAgo ────────────────────────────────────────────────────────────

function testDaysAgo(results) {
  const now = new Date();
  const threeDaysAgo = daysAgo(3);
  const diffDays = Math.round((now - threeDaysAgo) / 86400000);
  results.push(assert('daysAgo: returns date 3 days ago', diffDays === 3));
  results.push(assert('daysAgo: returns date 0 days ago', daysAgo(0).getDate() === now.getDate()));
  results.push(assert('daysAgo: returns date 30 days ago', Math.round((now - daysAgo(30)) / 86400000) === 30));
}

// ─── PURE: formatDateDisplay ──────────────────────────────────────────────────

function testFormatDateDisplay(results) {
  const date = new Date(2026, 5, 19); // June 19, 2026
  const formatted = formatDateDisplay(date);
  results.push(assert('formatDateDisplay: Dutch format', formatted.includes('19') && formatted.includes('juni') && formatted.includes('2026')));
  
  // Test edge cases
  const date2 = new Date(2026, 0, 1); // Jan 1
  const formatted2 = formatDateDisplay(date2);
  results.push(assert('formatDateDisplay: Jan 1', formatted2.includes('1') && formatted2.includes('januari') && formatted2.includes('2026')));
}

// ─── PURE: processFollowUps ───────────────────────────────────────────────────

function testProcessFollowUps(results) {
  results.push(assert('processFollowUps: function exists', typeof processFollowUps === 'function'));
  
  // Test that it calls processFollowUps with correct params
  const originalProcessFollowUps = processFollowUps;
  let calledWith = null;
  processFollowUps = function(params) { calledWith = params; };
  
  try {
    checkDigests();
    results.push(assert('checkDigests: calls processFollowUps with doDigest=true', calledWith && calledWith.doDigest === true && calledWith.doEscalate === false));
    
    calledWith = null;
    checkEscalations();
    results.push(assert('checkEscalations: calls processFollowUps with doEscalate=true', calledWith && calledWith.doDigest === false && calledWith.doEscalate === true));
  } finally {
    processFollowUps = originalProcessFollowUps;
  }
}