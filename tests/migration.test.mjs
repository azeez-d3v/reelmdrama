import test from 'node:test';
import assert from 'node:assert/strict';
import {componentHarness} from './ui-harness.mjs';
import * as policy from '../library-policy.ts';
import {parseCard} from '../services/source.ts';

const card=parseCard({id:'12',slug:'fixture',title:'Fixture',platform:'DramaBox',cover:null,total_episodes:61,available_episodes:61,language:'en',is_new:false,is_popular:false});
const library={saved:[card],recents:[card],liked:['12'],preferences:{holdSpeed:1.75,fontScale:1.15},progress:{fixture:{slug:'fixture',episode:20,time:32.25,updatedAt:1000}}};
const envelope=value=>JSON.stringify({format:'reelm-drama-library',version:1,library:value});
const plain=value=>JSON.parse(JSON.stringify(value));
function load(native={}){return componentHarness('../library.ts',{'./library-policy':policy,'./native':{native:{reelmReadLibraryJson:async()=>null,reelmWriteLibraryJsonAtomic:async()=>{},...native}}}).exports;}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}

test('library transfer roundtrip preserves resume and preferences and exports no unrelated fields',()=>{
 const api=load(),body=api.serializeLibraryTransfer({...library,downloads:[{key:'private',uri:'private'}],cookie:'credential'}),doc=JSON.parse(body);
 assert.deepEqual(Object.keys(doc).sort(),['format','library','version']);assert.equal(doc.format,'reelm-drama-library');assert.equal(doc.version,1);
 assert.deepEqual(Object.keys(doc.library).sort(),['liked','preferences','progress','recents','saved']);assert(!body.includes('credential'));assert(!body.includes('private'));
 const restored=plain(api.parseLibraryTransfer(body));assert.deepEqual(restored.progress.fixture,{slug:'fixture',episode:20,time:32.25,updatedAt:1000});assert.deepEqual(restored.preferences,{holdSpeed:1.75,fontScale:1.15});assert.deepEqual(restored.saved.map(x=>x.id),['12']);assert.deepEqual(restored.recents.map(x=>x.id),['12']);assert.deepEqual(restored.liked,['12']);
});
test('transfer import rejects unknown version and unexpected data at every level',()=>{
 const api=load();for(const doc of [{format:'reelm-drama-library',version:2,library},{format:'wrong',version:1,library},{format:'reelm-drama-library',version:1,library,keys:[]},
  {format:'reelm-drama-library',version:1,library:{...library,downloads:[]}},{format:'reelm-drama-library',version:1,library:{...library,saved:[{...card,cookie:'secret'}]}},
  {format:'reelm-drama-library',version:1,library:{...library,preferences:{...library.preferences,extra:1}}},{format:'reelm-drama-library',version:1,library:{...library,progress:{fixture:{...library.progress.fixture,extra:1}}}}])assert.throws(()=>api.parseLibraryTransfer(JSON.stringify(doc)),/Library transfer/);
});
test('transfer import rejects malformed, dropped, defaulted and duplicate library values',()=>{
 const api=load();for(const value of [null,[],{}, {...library,preferences:{holdSpeed:8,fontScale:1}}, {...library,saved:[{...card,catalogueLanguage:'ar'}]}, {...library,saved:[{...card,cover:'https://evil.invalid/a.png'}]}, {...library,saved:[card,card]}, {...library,liked:['12','12']}, {...library,progress:{fixture:{...library.progress.fixture,time:-1}}}, {...library,recents:Array.from({length:301},(_,i)=>({...card,id:String(i+1),slug:'fixture-'+i}))}])assert.throws(()=>api.parseLibraryTransfer(envelope(value)),/Library transfer/);
});
test('transfer enforces encoded byte cap and well-formed Unicode before parsing',()=>{
 const api=load();for(const body of ['{','é'.repeat(1048577),'\ud800',envelope({...library,saved:[{...card,title:'\ud800'}]})])assert.throws(()=>api.parseLibraryTransfer(body),/Library transfer/);
});
test('cancelled and invalid imports do not write current library',async()=>{
 let selected=null;const writes=[],api=load({reelmImportLibrary:async()=>selected,reelmWriteLibraryJsonAtomic:async body=>writes.push(body)});assert.equal(await api.importLibrary(),null);
 selected='{';await assert.rejects(api.importLibrary(),/Library transfer/);assert.deepEqual(writes,[]);
});
test('valid import waits for atomic replacement and returns complete library afterward',async()=>{
 const write=deferred(),writes=[],api=load({reelmImportLibrary:async()=>envelope(library),reelmWriteLibraryJsonAtomic:body=>{writes.push(JSON.parse(body));return write.promise;}});let done=false;
 const pending=api.importLibrary().then(value=>{done=true;return value;});await new Promise(setImmediate);assert(!done);assert.equal(writes.length,1);assert(!('format' in writes[0]));assert.equal(writes[0].progress.fixture.time,32.25);write.resolve();assert.deepEqual(plain(await pending).preferences,{holdSpeed:1.75,fontScale:1.15});
});
test('import persistence failure is observable and no successful replacement is reported',async()=>{
 const api=load({reelmImportLibrary:async()=>envelope(library),reelmWriteLibraryJsonAtomic:async()=>{throw Error('atomic failure');}});await assert.rejects(api.importLibrary(),/atomic failure/);
});
test('import refuses to overwrite changes made while its document picker is open',async()=>{
 const pick=deferred(),writes=[],api=load({reelmImportLibrary:()=>pick.promise,reelmWriteLibraryJsonAtomic:async body=>writes.push(JSON.parse(body))});const pending=api.importLibrary();
 await api.writeLibrary({...library,preferences:{holdSpeed:2,fontScale:1.3}});pick.resolve(envelope(library));await assert.rejects(pending,/changed during/);assert.equal(writes.length,1);assert.deepEqual(writes[0].preferences,{holdSpeed:2,fontScale:1.3});
});
test('import never returns stale UI state after a newer write queues during atomic replacement',async()=>{
 const firstWrite=deferred(),writes=[],api=load({reelmImportLibrary:async()=>envelope(library),reelmWriteLibraryJsonAtomic:body=>{writes.push(JSON.parse(body));return writes.length===1?firstWrite.promise:Promise.resolve();}});
 const importing=api.importLibrary();await new Promise(setImmediate);assert.equal(writes.length,1);
 const newer=api.writeLibrary({...library,preferences:{holdSpeed:2,fontScale:1.3}});firstWrite.resolve();await assert.rejects(importing,/changed during/);await newer;
 assert.equal(writes.length,2);assert.deepEqual(writes[1].preferences,{holdSpeed:2,fontScale:1.3});
});
test('export waits for pending persistence and sends only a validated roundtrip document',async()=>{
 const write=deferred(),exports=[],api=load({reelmWriteLibraryJsonAtomic:()=>write.promise,reelmExportLibrary:async body=>{exports.push(body);return true;}});const saving=api.writeLibrary(library),exporting=api.exportLibrary(library);await new Promise(setImmediate);assert.equal(exports.length,0);write.resolve();await saving;assert.equal(await exporting,true);assert.equal(exports.length,1);assert.equal(api.parseLibraryTransfer(exports[0]).progress.fixture.episode,20);
});
test('export cancellation returns false and failed persistence never opens picker',async()=>{
 let picks=0;const api=load({reelmWriteLibraryJsonAtomic:async()=>{throw Error('disk failure');},reelmExportLibrary:async()=>{picks++;return false;}});assert.equal(await api.exportLibrary(library),false);const failed=api.writeLibrary(library);await assert.rejects(failed,/disk failure/);await assert.rejects(api.exportLibrary(library),/disk failure/);assert.equal(picks,1);
});
test('export never reports a stale migration snapshot as current after picker closes',async()=>{
 const picked=deferred(),api=load({reelmExportLibrary:()=>picked.promise});const exporting=api.exportLibrary(library);await new Promise(setImmediate);
 await api.writeLibrary({...library,preferences:{holdSpeed:2,fontScale:1.3}});picked.resolve(true);await assert.rejects(exporting,/changed during/);
});
