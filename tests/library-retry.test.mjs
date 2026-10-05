import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {componentHarness} from './ui-harness.mjs';
import * as policy from '../library-policy.ts';

const source=fs.readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
const persist=source.split('\n').find(line=>line.includes('const persist=useCallback('));
const flush=source.split('\n').find(line=>line.includes('const flush=useCallback('));
const marker='onRetry={()=>{if(failedWrite.current)',start=source.indexOf(marker);
const bodyStart=start+'onRetry={()=>{'.length,end=source.indexOf(';}}/></View>',bodyStart);
assert(persist&&flush&&start>=0&&end>bodyStart,'Library callback extraction needs updating');
// Execute the complete actual callback, including a future revision guard.
const retry=source.slice(bodyStart,end+1),settle=()=>new Promise(setImmediate);
const at130=()=>({...policy.emptyLibrary(),preferences:{holdSpeed:1.5,fontScale:1.3}});
const at115=()=>({...policy.emptyLibrary(),preferences:{holdSpeed:1.5,fontScale:1.15}});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}

function fixture(writeGate=async()=>{}){
 let resolve,reject,ui=policy.emptyLibrary(),body=JSON.stringify(ui),error='Initial load failed';
 const pending=new Promise((a,b)=>{resolve=a;reject=b;}),original=body,writes=[];
 const h=componentHarness('../library.ts',{'./library-policy':policy,'./native':{native:{
  reelmReadLibraryJson:()=>pending,
  reelmWriteLibraryJsonAtomic:async value=>{writes.push(value);await writeGate(writes.length);body=value;}
 }}});
 const box={useCallback:f=>f,mounted:{current:true},writable:{current:false},
  libraryRevision:{current:0},savedLibrary:{current:ui},failedWrite:{current:null},
  setLibrary:value=>ui=value,setLibraryError:value=>error=value,
  readLibrary:h.exports.readLibrary,writeLibrary:h.exports.writeLibrary,flushLibrary:h.exports.flushLibrary};
 vm.createContext(box);
 vm.runInContext(ts.transpileModule(persist+'\n'+flush+'\nglobalThis.persist=persist;globalThis.flush=flush;globalThis.retry=()=>{'+retry+'};',{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}
 }).outputText,box);
 return {box,writes,original,resolve,reject,get ui(){return ui;},get body(){return body;},get error(){return error;},
  async save130(){box.persist(at130(),true);await h.exports.flushLibrary();await settle();},flush:()=>h.exports.flushLibrary(),cleanup:()=>h.cleanup()};
}

for(const outcome of ['resolve','reject'])test(`Library Retry ignores stale ${outcome} after a newer explicit save`,async()=>{
 const f=fixture();try{
  f.box.retry();await f.save130();
  assert.equal(f.ui.preferences.fontScale,1.3);assert.equal(f.error,null);
  if(outcome==='resolve')f.resolve(f.original);else f.reject(Error('deferred read failed'));
  await settle();
  assert.equal(JSON.parse(f.body).preferences.fontScale,1.3);
  assert.equal(f.writes.length,1);assert.equal(f.box.libraryRevision.current,1);
  assert.equal(f.ui.preferences.fontScale,1.3,'Stale Retry must not replace newer UI preferences');
  assert.equal(f.box.savedLibrary.current.preferences.fontScale,1.3);
  assert.equal(f.error,null,'Stale Retry failure must not replace newer save success');
  assert.equal(f.box.writable.current,true);assert.equal(f.box.failedWrite.current,null);
 }finally{f.cleanup();}
});

test('Library Retry accepts a fresh read without writing the original file',async()=>{
 const f=fixture();try{
  f.box.retry();f.resolve(JSON.stringify(at130()));await settle();
  assert.equal(f.ui.preferences.fontScale,1.3);assert.equal(f.box.savedLibrary.current.preferences.fontScale,1.3);
  assert.equal(f.error,null);assert.equal(f.box.writable.current,true);assert.equal(f.box.failedWrite.current,null);
  assert.equal(f.box.libraryRevision.current,1);
  assert.equal(f.writes.length,0);assert.equal(f.body,f.original);
 }finally{f.cleanup();}
});

test('Library Retry keeps a fresh rejection visible and the original file read-only',async()=>{
 const f=fixture();try{
  f.box.retry();f.reject(Error('current read failed'));await settle();
  assert.equal(f.ui.preferences.fontScale,1);assert.equal(f.box.savedLibrary.current.preferences.fontScale,1);
  assert.match(f.error,/Library still could not be read\. Original retained/);
  assert.equal(f.box.writable.current,false);assert.equal(f.box.failedWrite.current,null);
  assert.equal(f.writes.length,0);assert.equal(f.body,f.original);
 }finally{f.cleanup();}
});

test('Library write ignores an older failure while a newer save is pending',async t=>{
 const a=deferred(),b=deferred(),f=fixture(index=>index===1?a.promise:index===2?b.promise:Promise.resolve());
 try{
  f.box.setLibraryError(null);f.box.persist(at115(),true);await settle();
  assert.equal(f.writes.length,1);
  f.box.persist(at130(),true);assert.equal(f.ui.preferences.fontScale,1.3);
  a.reject(Error('older write failed'));await settle();
  assert.equal(f.writes.length,2,'Real write queue must start B only after A settles');
  const staleError=f.error,staleFailedWrite=f.box.failedWrite.current;
  // Exercise exactly the Retry affordance visible after the older failure.
  if(f.error)f.box.retry();
  b.resolve();await f.flush();await settle();
  t.diagnostic(JSON.stringify({staleError,staleFailedFont:staleFailedWrite?.preferences.fontScale??null,
   nativeFont:JSON.parse(f.body).preferences.fontScale,uiFont:f.ui.preferences.fontScale,writes:f.writes.length}));
  assert.equal(staleError,null,'Older write failure must not expose a stale Retry');
  assert.equal(staleFailedWrite,null);
  assert.equal(JSON.parse(f.body).preferences.fontScale,1.3);
  assert.equal(f.ui.preferences.fontScale,1.3);assert.equal(f.box.savedLibrary.current.preferences.fontScale,1.3);
  assert.equal(f.error,null);assert.equal(f.box.failedWrite.current,null);assert.equal(f.writes.length,2);
 }finally{a.resolve();b.resolve();f.cleanup();}
});

test('Library new save clears a previous failed-write Retry before settlement',async()=>{
 const a=deferred(),b=deferred(),f=fixture(index=>index===1?a.promise:b.promise);
 try{
  f.box.setLibraryError(null);f.box.persist(at115(),true);await settle();
  a.reject(Error('current write failed'));await settle();
  assert.match(f.error,/Changes were not saved/);assert.equal(f.box.failedWrite.current.preferences.fontScale,1.15);
  f.box.persist(at130(),true);await settle();
  const pendingError=f.error,pendingFailedWrite=f.box.failedWrite.current;
  b.resolve();await f.flush();await settle();
  assert.equal(pendingError,null,'New intent must clear the previous failure immediately');
  assert.equal(pendingFailedWrite,null);
  assert.equal(JSON.parse(f.body).preferences.fontScale,1.3);assert.equal(f.ui.preferences.fontScale,1.3);
  assert.equal(f.error,null);assert.equal(f.box.failedWrite.current,null);assert.equal(f.writes.length,2);
 }finally{a.resolve();b.resolve();f.cleanup();}
});

test('Library flush ignores an older failure while a newer save is pending',async t=>{
 const a=deferred(),b=deferred(),f=fixture(index=>index===1?a.promise:b.promise);
 try{
  f.box.setLibraryError(null);f.box.persist(at115(),true);await settle();
  f.box.flush();f.box.persist(at130(),true);
  a.reject(Error('older flushed write failed'));await settle();
  assert.equal(f.writes.length,2);
  const staleError=f.error;
  if(f.error){f.box.retry();f.resolve(f.original);await settle();}
  b.resolve();await f.flush();await settle();
  t.diagnostic(JSON.stringify({staleFlushError:staleError,nativeFont:JSON.parse(f.body).preferences.fontScale,
   uiFont:f.ui.preferences.fontScale,revision:f.box.libraryRevision.current,writes:f.writes.length}));
  assert.equal(staleError,null,'Older flush failure must not expose a Retry of pre-save bytes');
  assert.equal(JSON.parse(f.body).preferences.fontScale,1.3);assert.equal(f.ui.preferences.fontScale,1.3);
  assert.equal(f.box.savedLibrary.current.preferences.fontScale,1.3);assert.equal(f.box.libraryRevision.current,2);
  assert.equal(f.error,null);assert.equal(f.box.failedWrite.current,null);assert.equal(f.writes.length,2);
 }finally{a.resolve();b.resolve();f.cleanup();}
});

test('Library flush keeps a current failure visible without replacing original bytes',async()=>{
 const write=deferred(),f=fixture(()=>write.promise);
 try{
  f.box.setLibraryError(null);
  const saving=assert.rejects(f.box.writeLibrary(at115()),/current flush failed/);
  await settle();f.box.flush();write.reject(Error('current flush failed'));await saving;await settle();
  assert.match(f.error,/Changes were not saved\. Retry saving/);
  assert.equal(f.body,f.original);assert.equal(f.ui.preferences.fontScale,1);
  assert.equal(f.writes.length,1);assert.equal(f.box.libraryRevision.current,0);
 }finally{write.resolve();f.cleanup();}
});

test('Library flush ignores a failure after unmount',async()=>{
 const write=deferred(),f=fixture(()=>write.promise);
 try{
  f.box.setLibraryError(null);
  const saving=assert.rejects(f.box.writeLibrary(at115()),/unmounted flush failed/);
  await settle();f.box.flush();f.box.mounted.current=false;
  write.reject(Error('unmounted flush failed'));await saving;await settle();
  assert.equal(f.error,null,'Unmounted flush must not update error state');
  assert.equal(f.body,f.original);assert.equal(f.ui.preferences.fontScale,1);
  assert.equal(f.box.failedWrite.current,null);assert.equal(f.box.libraryRevision.current,0);
 }finally{write.resolve();f.cleanup();}
});
