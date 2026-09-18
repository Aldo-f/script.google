/**
 * AttachmentCleaner Core Tests - Pure functions from Code.gs
 * Run runAllCoreTests() to execute all tests.
 */

function runAllCoreTests() {
  const results = [];
  [
    testGetExtension, testBuildAttachmentNote, testAppendNoteToTextPart,
    testGetUniqueFilename,
    testSetupTrigger, testRemoveTrigger,
    testDryRunExists, testPreviewAttachmentsExists,
    testProcessAttachmentsExists, testSaveAttachmentExists
  ].forEach(s => { try { s(results); } catch (e) { results.push({label:'[CRASH] '+(s.name||'?')+': '+e.message, ok:false}); } });
  const passed = results.filter(r=>r.ok).length, failed = results.filter(r=>!r.ok).length;
  Logger.log('=== AttachmentCleaner Tests === '+passed+' passed, '+failed+' failed ===');
  results.forEach(r => Logger.log('  '+(r.ok?'✓':'✗')+' '+r.label));
}
function assert(label, condition) { const r={label:label, ok:!!condition}; Logger.log((r.ok?'✓':'✗')+' '+label); return r; }

function makeFolder(id, name) {
  return {
    getId:()=>id, getName:()=>name,
    getFilesByName:function(n){ return {hasNext:()=>false, next:()=>null}; },
    createFile:function(b){ return {getId:()=>('f-'+id), getName:()=>b._name||name, getSize:()=>1024}; }
  };
}
function makeLabel(name){ return {getName:()=>name, getId:()=>('label-'+name), addLabel:()=>{}, removeLabel:()=>{}}; }
function mockDriveApp(byName, byId) {
  const orig=DriveApp; DriveApp={
    getFoldersByName:function(n){ const f=byName[n]; if(f)return{hasNext:()=>true,next:()=>f}; return{hasNext:()=>false,next:()=>null}; },
    createFolder:function(n){ const f=makeFolder('new-'+n,n); if(byId)byId[n]=f; return f; },
    getFolderById:function(id){ if(byId&&byId[id])return byId[id]; throw new Error('not found'); }
  }; return function(){ DriveApp=orig; };
}
function mockGmailApp(searchResult, labelResult) {
  const orig=GmailApp; GmailApp={search:function(){return searchResult||[];}, getUserLabelByName:function(n){return labelResult||null;}, createLabel:function(n){return makeLabel(n);}, trashMessage:function(){}};
  return function(){ GmailApp=orig; };
}
function mockScriptApp(triggersList) {
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

function testGetExtension(r){ r.push(assert('getExtension: file.txt', getExtension('file.txt')==='txt')); r.push(assert('getExtension: no ext', getExtension('file')==='')); r.push(assert('getExtension: .dotfile', getExtension('.gitignore')==='')); r.push(assert('getExtension: tar.gz', getExtension('archive.tar.gz')==='gz')); r.push(assert('getExtension: empty', getExtension('')==='')); }
function testBuildAttachmentNote(r){ r.push(assert('buildAttachmentNote: single', buildAttachmentNote(['a.pdf']).includes('a.pdf'))); r.push(assert('buildAttachmentNote: multi', buildAttachmentNote(['a.pdf','b.jpg']).includes('b.jpg'))); r.push(assert('buildAttachmentNote: empty list', buildAttachmentNote([]).includes('Met bijlage'))); }
function testAppendNoteToTextPart(r){ const b='--b\r\nContent-Type:text/plain\r\n\r\nhello\r\n--b--'; const res=appendNoteToTextPart(b,'NOTE'); r.push(assert('appendNote: keeps body', res.includes('hello'))); r.push(assert('appendNote: inserts note', res.includes('NOTE'))); r.push(assert('appendNote: no boundary', appendNoteToTextPart('x','NOTE')==='x')); }
function testGetUniqueFilename(r){ const f=makeFolder('id','F'); r.push(assert('unique: original', getUniqueFilename('a.pdf','t1',f)==='a.pdf')); const f2={getFilesByName:function(){return{hasNext:()=>true,next:()=>({getName:()=>()=>{}})};}, createFile:function(){}}; const n=getUniqueFilename('a.pdf','t1',f2); r.push(assert('unique: collision different', n!=='a.pdf'&&n.includes('a'))); }
function testSetupTrigger(r){ const trigs=[]; const restore=mockScriptApp(trigs); setupTrigger(); r.push(assert('setup: creates', trigs.length===1)); r.push(assert('setup: func', trigs[0].funcName==='processAttachments')); restore(); }
function testRemoveTrigger(r){ const trigs=[{funcName:'processAttachments'}]; const restore=mockScriptApp(trigs); removeTrigger(); r.push(assert('remove: clears', trigs.length===0)); restore(); }
function testDryRunExists(r){ r.push(assert('dryRun: exists', typeof dryRun==='function')); }
function testPreviewAttachmentsExists(r){ r.push(assert('previewAttachments: exists', typeof previewAttachments==='function')); }
function testProcessAttachmentsExists(r){ r.push(assert('processAttachments: exists', typeof processAttachments==='function')); }
function testSaveAttachmentExists(r){ r.push(assert('saveAttachment: exists', typeof saveAttachment==='function')); }
