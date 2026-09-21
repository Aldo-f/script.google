/**
 * AttachmentCleaner Core Tests - Pure functions from Code.gs
 * Run runAllCoreTests() to execute all tests.
 */

function runAllCoreTests() {
  const results = [];
  [
    testGetExtension_, testBuildAttachmentNote_, testAppendNoteToTextPart_,
    testGetUniqueFilename_,
    testSetupTrigger_, testRemoveTrigger_,
    testDryRunExists_, testPreviewAttachmentsExists_,
    testProcessAttachmentsExists_, testSaveAttachmentExists_
  ].forEach(s => { try { s(results); } catch (e) { results.push({label:'[CRASH] '+(s.name||'?')+': '+e.message, ok:false}); } });
  const passed = results.filter(r=>r.ok).length, failed = results.filter(r=>!r.ok).length;
  Logger.log('=== AttachmentCleaner Tests === '+passed+' passed, '+failed+' failed ===');
  results.forEach(r => Logger.log('  '+(r.ok?'✓':'✗')+' '+r.label));
}
function assert_(label, condition) { const r={label:label, ok:!!condition}; Logger.log((r.ok?'✓':'✗')+' '+label); return r; }

function makeFolder_(id, name) {
  return {
    getId:()=>id, getName:()=>name,
    getFilesByName:function(n){ return {hasNext:()=>false, next:()=>null}; },
    createFile:function(b){ return {getId:()=>('f-'+id), getName:()=>b._name||name, getSize:()=>1024}; }
  };
}
function makeLabel_(name){ return {getName:()=>name, getId:()=>('label-'+name), addLabel:()=>{}, removeLabel:()=>{}}; }
function mockDriveApp_(byName, byId) {
  const orig=DriveApp; DriveApp={
    getFoldersByName:function(n){ const f=byName[n]; if(f)return{hasNext:()=>true,next:()=>f}; return{hasNext:()=>false,next:()=>null}; },
    createFolder:function(n){ const f=makeFolder('new-'+n,n); if(byId)byId[n]=f; return f; },
    getFolderById:function(id){ if(byId&&byId[id])return byId[id]; throw new Error('not found'); }
  }; return function(){ DriveApp=orig; };
}
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

function testGetExtension_(r){ r.push(assert_('getExtension_: file.txt', getExtension_('file.txt')==='txt')); r.push(assert_('getExtension_: no ext', getExtension_('file')==='')); r.push(assert_('getExtension_: .dotfile', getExtension_('.gitignore')==='')); r.push(assert_('getExtension_: tar.gz', getExtension_('archive.tar.gz')==='gz')); r.push(assert_('getExtension_: empty', getExtension_('')==='')); }
function testBuildAttachmentNote_(r){ r.push(assert_('buildAttachmentNote_: single', buildAttachmentNote_(['a.pdf']).includes('a.pdf'))); r.push(assert_('buildAttachmentNote_: multi', buildAttachmentNote_(['a.pdf','b.jpg']).includes('b.jpg'))); r.push(assert_('buildAttachmentNote_: empty list', buildAttachmentNote_([]).includes('Met bijlage'))); }
function testAppendNoteToTextPart_(r){ const b='--b\r\nContent-Type:text/plain\r\n\r\nhello\r\n--b--'; const res=appendNoteToTextPart_(b,'NOTE'); r.push(assert_('appendNote: keeps body', res.includes('hello'))); r.push(assert_('appendNote: inserts note', res.includes('NOTE'))); r.push(assert_('appendNote: no boundary', appendNoteToTextPart_('x','NOTE')==='x')); }
function testGetUniqueFilename_(r){ const f=makeFolder_('id','F'); r.push(assert_('unique: original', getUniqueFilename_('a.pdf','t1',f)==='a.pdf')); const f2={getFilesByName:function(){return{hasNext:()=>true,next:()=>({getName:()=>()=>{}})};}, createFile:function(){}}; const n=getUniqueFilename_('a.pdf','t1',f2); r.push(assert_('unique: collision different', n!=='a.pdf'&&n.includes('a'))); }
function testSetupTrigger_(r){ const trigs=[]; const restore=mockScriptApp_(trigs); setupTrigger(); r.push(assert_('setup: creates', trigs.length===1)); r.push(assert_('setup: func', trigs[0].funcName==='processAttachments')); restore(); }
function testRemoveTrigger_(r){ const trigs=[{funcName:'processAttachments'}]; const restore=mockScriptApp_(trigs); removeTrigger(); r.push(assert_('remove: clears', trigs.length===0)); restore(); }
function testDryRunExists_(r){ r.push(assert_('dryRun: exists', typeof dryRun==='function')); }
function testPreviewAttachmentsExists_(r){ r.push(assert_('previewAttachments: exists', typeof previewAttachments==='function')); }
function testProcessAttachmentsExists_(r){ r.push(assert_('processAttachments: exists', typeof processAttachments==='function')); }
function testSaveAttachmentExists_(r){ r.push(assert_('saveAttachment_: exists', typeof saveAttachment_==='function')); }
