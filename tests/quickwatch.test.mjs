import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
test('quick-watch code keeps pending detail and source errors in the existing visible sheet',()=>{
 const watch=source.match(/const watchCard=useCallback\(async[\s\S]*?\},\[stopVideo,openDetail,loadEpisode\]\);/)?.[0];
 assert(watch);assert(watch.includes('openDetail(card,true)'));assert(watch.includes('if(!d||!mounted.current||generation!==detailEpoch.current)return;'));
 const opening=source.match(/const openDetail=useCallback\(async[\s\S]*?\},\[reveal,showSystemBars\]\);/)?.[0];
 assert(opening);
 assert.match(opening,/if\(show\)\{reveal\(\);await showSystemBars\(\);if\(!mounted\.current\|\|ctrl\.signal\.aborted\|\|g!==detailEpoch\.current\)return null;setDetailOpen\(true\);\}/);
 assert(opening.indexOf('setDetailOpen(true)')<opening.indexOf('await fetchDetail(card,ctrl.signal)'));
 assert(source.includes('detailOpen?<SeriesDetailSheet detail={detail} loading={detailLoading} error={detailError}'));
});
test('the shared quick-watch sheet closes/cancels pending detail and closes on successful video selection',()=>{
 assert(source.includes("if(detailOpen){++detailEpoch.current;detailRequest.current?.abort();setDetailOpen(false);return true;}"));
 assert(source.includes('onClose={()=>{++detailEpoch.current;detailRequest.current?.abort();setDetailOpen(false);}}'));

 const load=source.match(/const loadEpisode=useCallback\(async[\s\S]*?\},\[remember,flush,reveal,endHold,episodeCache(?:,[^\]]+)?\]\);/)?.[0];
 assert(load?.includes("setView('player')"));assert(load?.includes('setDetailOpen(false)'));
 assert(source.includes('ctrl.signal.aborted||g!==detailEpoch.current)return null'));
});

test('Saved Recents and detail primary resume exact episode; missing ordinal is not episode1',()=>{assert(source.includes("library.recents"));assert(source.includes('onWatch={()=>'));assert(!source.includes('progress.episode:1'));assert(source.includes("record('resumeEpisodeMissing'"));assert(!source.includes("setDetailError('Choose an episode"));});
test('Settings is local',()=>{assert(source.includes("t==='settings'"));assert(source.includes('<SettingsScreen'));});
import vm from 'node:vm';
import ts from 'typescript';
import {canSaveProgress,resumeSeekObserved} from '../resume-policy.ts';
function actualHandlers(startTime){
 const ref=current=>({current}),noop=()=>{};
 const d={slug:'fixture',id:'1',episodes:Array.from({length:20},()=>({advertisedAvailable:true}))};
 const box={useCallback:f=>f,endHold:noop,clearPrepared:noop,clearWarmup:noop,detailEpoch:ref(0),mediaRequest:ref(null),mediaEpoch:ref(0),requestedLoad:ref(null),getTestRun:()=>'',remember:noop,flush:noop,controls:ref(null),active:ref(null),setSource:noop,setSnap:noop,setPlayerLoading:noop,setPlayerError:noop,setView:noop,viewRef:ref(''),setDetailOpen:noop,setEpisodeOpen:noop,episodeRef:ref(20),setEpisode:noop,setCaptionsEnabled:noop,reveal:noop,identity:(d,n)=>({slug:d.slug,episode:n}),record:noop,SourceError:Error,mounted:ref(true),preparedLease:ref(null),cardOnly:x=>x,episodeCacheKey:(d,n)=>d.slug+':'+n,prepareEpisode:noop,detailRef:ref(d),snapshotRef:ref({loadId:null,resumePending:true,time:0}),AbortController,EMPTY_PLAYER:{resumePending:true,time:0},problem:String,failureCode:String};
 let calls=0;box.episodeCache={delete:noop,load:async()=>{if(++calls===1)throw Error('resolution failed');return{releasePin:noop,entry:{value:{identity:{slug:'fixture'},episodeNumber:20},uri:'https://fixture'},cached:false}}};
 box.stopVideo=noop;box.openDetail=async()=>d;box.savedLibrary=ref({progress:{fixture:{episode:20,time:32}}});
 const load=source.match(/const loadEpisode=useCallback\(async[\s\S]*?\},\[remember,flush,reveal,endHold,episodeCache,clearPrepared(?:,[^\]]+)?\]\);/)[0];
 const retry=source.match(/const retryPlayer=useCallback\([\s\S]*?\},\[loadEpisode,episodeCache\]\);/)[0];
 const watch=source.match(/const watchCard=useCallback\(async[\s\S]*?\},\[stopVideo,openDetail,loadEpisode\]\);/)[0];
 const snapshot=source.match(/const onSnapshot=useCallback\([\s\S]*?\},\[remember,flush\]\);/)[0];box.remember=captured=>{const a=box.active.current;if(a&&captured&&canSaveProgress(captured,a.loadId))box.savedLibrary.current.progress.fixture.time=captured.time;};
 vm.createContext(box);vm.runInContext(ts.transpileModule(load+'\n'+retry+'\n'+watch+'\n'+snapshot+'\nglobalThis.handlers={loadEpisode,retryPlayer,watchCard,onSnapshot};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,box);
 return {box,d,startTime,handlers:box.handlers};
}
for(const target of [32,0])test(`actual resolver failure and Retry retain requested ${target} until acknowledgement`,async()=>{
 const {box,d,handlers}=actualHandlers(target);await handlers.watchCard(d,target===0?20:undefined);assert.equal(box.active.current,null);
 handlers.retryPlayer();await new Promise(r=>setImmediate(r));const active=box.active.current;assert.equal(active.startTime,target);
 const pending={playing:false,desiredPlaying:false,appState:'background',loadId:active.loadId,resumePending:true,time:0,duration:80,status:'readyToPlay',sourceLoadSeen:true};assert.equal(canSaveProgress(pending,active.loadId),false);
 handlers.onSnapshot(pending);assert.equal(box.savedLibrary.current.progress.fixture.time,32);
 if(target>0)assert.equal(resumeSeekObserved(target,0),false);
 handlers.onSnapshot({...pending,resumePending:false,time:target});assert.equal(box.savedLibrary.current.progress.fixture.time,target);
 assert.equal(canSaveProgress({...pending,resumePending:false,time:target},active.loadId),true);
});
test('Saved Recents label uses required middle dot',()=>{const ui=fs.readFileSync(new URL('../ui/CatalogueScreen.tsx',import.meta.url),'utf8');assert(ui.includes('Ep {progress.episode} · {formatTime(progress.time)}'));assert(!ui.includes('\uFFFD'));});


for(const collection of ['Saved','Recents'])test(collection+' resumes through the normal source/cache, never offline storage',async()=>{
 const f=actualHandlers(32);await f.handlers.watchCard(f.d);assert.equal(f.box.requestedLoad.current.startTime,32);assert.equal(f.box.requestedLoad.current.episode,20);f.handlers.retryPlayer();await new Promise(setImmediate);assert.equal(f.box.active.current.startTime,32);assert(!source.includes('acquireOfflineEpisode'));
});
test('navigation after source/cache resolution begins releases a stale result without resurrecting playback',async()=>{
 const f=actualHandlers(32);let finish,released=0;f.box.episodeCache.load=()=>new Promise(r=>finish=r);
 const pending=f.handlers.loadEpisode(f.d,20,32);++f.box.mediaEpoch.current;f.box.mediaRequest.current.abort();finish({releasePin:()=>released++,entry:{value:{identity:{slug:'fixture'},episodeNumber:20},uri:'https://fixture'},cached:false});await pending;assert.equal(f.box.active.current,null);assert.equal(released,1);
});
test('unmount while Saved detail resolves never requests or restores playback',async()=>{
 const f=actualHandlers(32);let finish;f.box.openDetail=()=>new Promise(r=>finish=r);const pending=f.handlers.watchCard(f.d);f.box.mounted.current=false;finish(f.d);await pending;assert.equal(f.box.requestedLoad.current,null);assert.equal(f.box.active.current,null);
});
test('missing saved ordinal keeps the visible detail and never silently resets to episode1',async()=>{
 const f=actualHandlers(32);f.d.episodes[19].advertisedAvailable=false;await f.handlers.watchCard(f.d);assert.equal(f.box.requestedLoad.current,null);assert.equal(f.box.savedLibrary.current.progress.fixture.episode,20);assert.equal(f.box.savedLibrary.current.progress.fixture.time,32);
});
