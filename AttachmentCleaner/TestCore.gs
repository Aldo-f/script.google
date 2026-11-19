/**
 * AttachmentCleaner Core Tests - Pure functions from Code.gs
 * Run runAllCoreTests() to execute all tests.
 */

function runAllCoreTests() {
  const results = [];
  [
    testBuildAttachmentNote_, testAppendNoteToTextPart_,
    testSetupTrigger_, testRemoveTrigger_,
    testDryRunExists_, testPreviewAttachmentsExists_,
    testProcessAttachmentsExists_,
    testWebhookHelpersExist_, testGetWebhookTokenMissing_,
    testWebhookPayloadShape_,
    testDryRunDoesNotMutate_, testPermanentDeleteOrder_
  ].forEach(s => { try { s(results); } catch (e) { results.push({label:'[CRASH] '+(s.name||'?')+': '+e.message, ok:false}); } });
  const passed = results.filter(r=>r.ok).length, failed = results.filter(r=>!r.ok).length;
  Logger.log('=== AttachmentCleaner Tests === '+passed+' passed, '+failed+' failed ===');
  results.forEach(r => Logger.log('  '+(r.ok?'✓':'✗')+' '+r.label));
}
function assert_(label, condition) { const r={label:label, ok:!!condition}; Logger.log((r.ok?'✓':'✗')+' '+label); return r; }

function makeLabel_(name){ return {getName:()=>name, getId:()=>('label-'+name), addLabel:()=>{}, removeLabel:()=>{}}; }
function mockGmailApp_(searchResult, labelResult) {
  const orig=GmailApp; GmailApp={search:function(){return searchResult||[];}, getUserLabelByName:function(n){return labelResult||null;}, createLabel:function(n){return makeLabel(n);}, trashMessage:function(){}};
  return function(){ GmailApp=orig; };
}
function mockScriptApp_(triggersList) {
  const orig=ScriptApp; ScriptApp={
    getProjectTriggers:function(){return triggersList||[];},
    deleteTrigger:function(t){ const i=(triggersList||[]).indexOf(t); if(i>=0)triggersList.splice(i,1); },
    newTrigger:function(fn){
      const obj={funcName:fn};
      obj.timeBased=function(){return obj;};
      obj.everyHours=function(){return obj;};
      obj.create=function(){triggersList.push({funcName:fn}); return obj;};
      return obj;
    }
  }; return function(){ ScriptApp=orig; };
}

/**
 * Mock Script Properties with a small in-memory store.
 * @param {object} [initial]
 * @returns {function} restore function
 */
function mockProperties_(initial) {
  const orig = PropertiesService;
  const store = {};
  if (initial) Object.keys(initial).forEach(function (k) { store[k] = initial[k]; });
  PropertiesService = {
    getScriptProperties: function () {
      return {
        getProperty: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
        setProperty: function (k, v) { store[k] = String(v); },
        deleteProperty: function (k) { delete store[k]; }
      };
    }
  };
  return function () { PropertiesService = orig; };
}

/**
 * Mock Session (active user + script timezone).
 * @param {string} [email]
 * @returns {function} restore function
 */
function mockSession_(email) {
  const orig = Session;
  Session = {
    getActiveUser: function () { return { getEmail: function () { return email || 'test@example.com'; } }; },
    getScriptTimeZone: function () { return 'UTC'; }
  };
  return function () { Session = orig; };
}

/**
 * Mock the Advanced Gmail service Users.Messages API.
 * @param {object} messagesApi - {get, remove, ...}
 * @returns {function} restore function
 */
function mockGmail_(messagesApi) {
  const orig = Gmail;
  Gmail = { Users: { Messages: messagesApi } };
  return function () { Gmail = orig; };
}

/**
 * Builds a fake thread with one message carrying a single attachment.
 */
function makeFakeThread_(id, onTrash) {
  const attachments = [{
    getName: function () { return 'report.pdf'; },
    getSize: function () { return 4096; },
    getContentType: function () { return 'application/pdf'; },
    getBytes: function () { return [1, 2, 3]; }
  }];
  const threadId = 'thread-' + id;
  const message = {
    getId: function () { return id; },
    getSubject: function () { return 'Test ' + id; },
    getFrom: function () { return 'sender@example.com'; },
    getDate: function () { return new Date('2020-01-01T00:00:00.000Z'); },
    getAttachments: function () { return attachments; },
    getThread: function () { return { getId: function () { return threadId; } }; },
    moveToTrash: function () { if (onTrash) onTrash(); }
  };
  return {
    getId: function () { return threadId; },
    getMessages: function () { return [message]; }
  };
}

function testBuildAttachmentNote_(r){
  const url = 'https://gleaner.example.com/download/abc123';
  const withUrl = buildAttachmentNote_(['a.pdf'], url);
  r.push(assert_('buildAttachmentNote_: single', withUrl.includes('a.pdf')));
  r.push(assert_('buildAttachmentNote_: multi', buildAttachmentNote_(['a.pdf','b.jpg']).includes('b.jpg')));
  r.push(assert_('buildAttachmentNote_: Gleaner wording', withUrl.includes('Gleaner')));
  r.push(assert_('buildAttachmentNote_: includes download URL', withUrl.includes('Download: ' + url)));
  r.push(assert_('buildAttachmentNote_: no URL by default', !buildAttachmentNote_(['a.pdf']).includes('Download:')));
  r.push(assert_('buildAttachmentNote_: empty list', buildAttachmentNote_([]).includes('Bijlage')));
}
function testAppendNoteToTextPart_(r){ const b='--b\r\nContent-Type:text/plain\r\n\r\nhello\r\n--b--'; const res=appendNoteToTextPart_(b,'NOTE'); r.push(assert_('appendNote: keeps body', res.includes('hello'))); r.push(assert_('appendNote: inserts note', res.includes('NOTE'))); r.push(assert_('appendNote: no boundary', appendNoteToTextPart_('x','NOTE')==='x')); }
function testSetupTrigger_(r){ const trigs=[]; const restore=mockScriptApp_(trigs); setupTrigger(); r.push(assert_('setup: creates', trigs.length===1)); r.push(assert_('setup: func', trigs[0].funcName==='runCleanerWithContinuation')); restore(); }
function testRemoveTrigger_(r){ const trigs=[{funcName:'processAttachments'}]; const restore=mockScriptApp_(trigs); removeTrigger(); r.push(assert_('remove: clears', trigs.length===0)); restore(); }
function testDryRunExists_(r){ r.push(assert_('dryRun: exists', typeof dryRun==='function')); }
function testPreviewAttachmentsExists_(r){ r.push(assert_('previewAttachments: exists', typeof previewAttachments==='function')); }
function testProcessAttachmentsExists_(r){ r.push(assert_('processAttachments: exists', typeof processAttachments==='function')); }

function testWebhookHelpersExist_(r) {
  r.push(assert_('webhook helper: getWebhookToken_ exists', typeof getWebhookToken_ === 'function'));
  r.push(assert_('webhook helper: getNotifyEmail_ exists', typeof getNotifyEmail_ === 'function'));
  r.push(assert_('webhook helper: sendToWebhook_ exists', typeof sendToWebhook_ === 'function'));
  r.push(assert_('webhook helper: uploadMessageAttachments_ exists', typeof uploadMessageAttachments_ === 'function'));
}

function testGetWebhookTokenMissing_(r) {
  const restoreProps = mockProperties_({});
  let threw = false;
  let message = '';
  try { getWebhookToken_(); } catch (e) { threw = true; message = e.message || ''; }
  restoreProps();
  r.push(assert_('getWebhookToken_: throws when missing', threw && message.indexOf('WEBHOOK_TOKEN') !== -1));
}

/**
 * Verifies the webhook payload shape, including the optional notifyEmail field.
 * sendToWebhook_ is stubbed so nothing leaves the script.
 */
function testWebhookPayloadShape_(r) {
  const origSend = sendToWebhook_;
  const restoreProps = mockProperties_({ GLEANER_NOTIFY_EMAIL: 'notify@example.com' });
  const restoreSession = mockSession_('active@example.com');
  let captured = null;
  let restoreEmptyProps = null;
  sendToWebhook_ = function (payload) {
    captured = payload;
    return { downloadUrl: 'https://example.com/d', zipSize: 1, attachmentCount: 1, downloadId: 'd1' };
  };
  try {
    uploadMessageAttachments_(makeFakeThread_('m-payload').getMessages()[0]);

    ['threadId', 'messageId', 'subject', 'from', 'date', 'attachments', 'notifyEmail'].forEach(function (key) {
      r.push(assert_('webhook payload: has ' + key,
        !!captured && Object.prototype.hasOwnProperty.call(captured, key)));
    });
    r.push(assert_('webhook payload: notifyEmail from Script Property',
      !!captured && captured.notifyEmail === 'notify@example.com'));

    // Without the property, notifyEmail falls back to the active Google user.
    restoreProps();
    restoreEmptyProps = mockProperties_({});
    captured = null;
    uploadMessageAttachments_(makeFakeThread_('m-payload-2').getMessages()[0]);
    r.push(assert_('webhook payload: notifyEmail falls back to active user',
      !!captured && captured.notifyEmail === 'active@example.com'));
  } finally {
    sendToWebhook_ = origSend;
    if (restoreEmptyProps) restoreEmptyProps(); else restoreProps();
    restoreSession();
  }
}

function testDryRunDoesNotMutate_(r) {
  const saved = {
    DRY_RUN: CONFIG.DRY_RUN,
    PERMANENTLY_DELETE_ORIGINAL: CONFIG.PERMANENTLY_DELETE_ORIGINAL,
    TRASH_MESSAGES: CONFIG.TRASH_MESSAGES
  };
  const calls = { upload: 0, strip: 0, insert: 0, remove: 0, trash: 0 };
  const origUpload = uploadMessageAttachments_;
  const origStrip = stripAttachmentsFromRaw_;
  const origInsert = insertRewrittenMessage_;
  const restoreProps = mockProperties_({});
  const restoreSession = mockSession_('dry-run@example.com');
  const restoreGmail = mockGmail_({
    get: function () { return { raw: 'mock-raw' }; },
    remove: function () { calls.remove++; }
  });

  uploadMessageAttachments_ = function () { calls.upload++; return { downloadUrl: 'https://example.com/d' }; };
  stripAttachmentsFromRaw_ = function () { calls.strip++; return 'clean'; };
  insertRewrittenMessage_ = function () { calls.insert++; return { id: 'new-id' }; };

  CONFIG.DRY_RUN = true;
  CONFIG.PERMANENTLY_DELETE_ORIGINAL = true;
  CONFIG.TRASH_MESSAGES = true;

  try {
    processAttachments([makeFakeThread_('m-dry', function () { calls.trash++; })]);
  } finally {
    CONFIG.DRY_RUN = saved.DRY_RUN;
    CONFIG.PERMANENTLY_DELETE_ORIGINAL = saved.PERMANENTLY_DELETE_ORIGINAL;
    CONFIG.TRASH_MESSAGES = saved.TRASH_MESSAGES;
    uploadMessageAttachments_ = origUpload;
    stripAttachmentsFromRaw_ = origStrip;
    insertRewrittenMessage_ = origInsert;
    restoreGmail();
    restoreSession();
    restoreProps();
  }

  r.push(assert_('dry-run: no webhook upload', calls.upload === 0));
  r.push(assert_('dry-run: no stripAttachmentsFromRaw_', calls.strip === 0));
  r.push(assert_('dry-run: no insertRewrittenMessage_', calls.insert === 0));
  r.push(assert_('dry-run: no Gmail delete', calls.remove === 0));
  r.push(assert_('dry-run: no moveToTrash', calls.trash === 0));
}

function testPermanentDeleteOrder_(r) {
  const saved = {
    DRY_RUN: CONFIG.DRY_RUN,
    PERMANENTLY_DELETE_ORIGINAL: CONFIG.PERMANENTLY_DELETE_ORIGINAL,
    TRASH_MESSAGES: CONFIG.TRASH_MESSAGES
  };
  const calls = { upload: 0, insert: 0, remove: 0, trash: 0 };
  const order = [];
  const origUpload = uploadMessageAttachments_;
  const origStrip = stripAttachmentsFromRaw_;
  const origInsert = insertRewrittenMessage_;
  const restoreProps = mockProperties_({});
  const restoreSession = mockSession_('order@example.com');
  const restoreGmail = mockGmail_({
    get: function () { return { raw: 'mock-raw' }; },
    remove: function (userId, messageId) {
      calls.remove++;
      order.push('delete');
      if (userId !== 'me' || !messageId) throw new Error('remove() called with wrong arguments');
    }
  });

  uploadMessageAttachments_ = function () {
    calls.upload++;
    order.push('upload');
    return { downloadUrl: 'https://example.com/d/abc', zipSize: 1024, attachmentCount: 1, downloadId: 'd1' };
  };
  stripAttachmentsFromRaw_ = function () { return 'clean'; };
  insertRewrittenMessage_ = function () {
    calls.insert++;
    order.push('insert');
    return { id: 'new-id' };
  };

  CONFIG.DRY_RUN = false;
  CONFIG.PERMANENTLY_DELETE_ORIGINAL = true;
  CONFIG.TRASH_MESSAGES = false;

  try {
    processAttachments([makeFakeThread_('m-order', function () { calls.trash++; })]);
  } finally {
    CONFIG.DRY_RUN = saved.DRY_RUN;
    CONFIG.PERMANENTLY_DELETE_ORIGINAL = saved.PERMANENTLY_DELETE_ORIGINAL;
    CONFIG.TRASH_MESSAGES = saved.TRASH_MESSAGES;
    uploadMessageAttachments_ = origUpload;
    stripAttachmentsFromRaw_ = origStrip;
    insertRewrittenMessage_ = origInsert;
    restoreGmail();
    restoreSession();
    restoreProps();
  }

  r.push(assert_('order: upload called once', calls.upload === 1));
  r.push(assert_('order: insert called once', calls.insert === 1));
  r.push(assert_('order: delete called once', calls.remove === 1));
  r.push(assert_('order: no trash fallback', calls.trash === 0));
  r.push(assert_('order: upload → insert → delete', order.join(',') === 'upload,insert,delete'));
}
