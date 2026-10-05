import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
test('quick-watch code keeps pending detail and source errors in the existing visible sheet',()=>{
 const watch=source.match(/const watchCard=useCallback\(async[\s\S]*?\},\[stopVideo,openDetail,loadEpisode\]\);/)?.[0];
 assert(watch);assert(watch.includes('openDetail(card,true,local,offlineOnly)'));assert(watch.includes('if(!d||!mounted.current||generation!==detailEpoch.current)return;'));
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
 const box={useCallback:f=>f,endHold:noop,clearPrepared:noop,clearWarmup:noop,clearOffline:async()=>{},detailEpoch:ref(0),detailOrigin:ref('online'),mediaRequest:ref(null),mediaEpoch:ref(0),requestedLoad:ref(null),getTestRun:()=>'',remember:noop,flush:noop,controls:ref(null),active:ref(null),setSource:noop,setSnap:noop,setPlayerLoading:noop,setPlayerError:noop,setView:noop,viewRef:ref(''),setDetailOpen:noop,setEpisodeOpen:noop,episodeRef:ref(20),setEpisode:noop,setCaptionsEnabled:noop,reveal:noop,identity:(d,n)=>({slug:d.slug,episode:n}),record:noop,SourceError:Error,mounted:ref(true),preparedLease:ref(null),cardOnly:x=>x,episodeCacheKey:(d,n)=>d.slug+':'+n,prepareEpisode:noop,detailRef:ref(d),snapshotRef:ref({loadId:null,resumePending:true,time:0}),AbortController,EMPTY_PLAYER:{resumePending:true,time:0},problem:String,failureCode:String};
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

// Removing the local-first branch must fail these actual controller tests.
function controllerFixture({rows=[],acquire,origin='online',time=32}={}) {
 const ref=current=>({current}),noop=()=>{},events=[],errors=[];
 const card={id:'12',slug:'fixture',platform:'DramaBox',title:'Fixture',cover:null,totalEpisodes:22,availableEpisodes:22,catalogueLanguage:'en',audioEvidence:'unknown',languageQualification:'As provided',isNew:false,isPopular:false,countWarning:null};
 const detail={...card,description:'Stored',episodesInDB:22,episodes:Array.from({length:22},(_,i)=>({number:i+1,advertisedAvailable:true,qualification:'Stored'})),sourceDeclaredLanguage:'en',sourceDeclaredMode:null,subtitleEvidence:'unverified',sampledEnglishEpisodes:[],receipt:null,cached:false};
 const complete={id:'a'.repeat(32),card,episodeNumber:20,state:'complete',bytesStored:1040,bytesReceived:1000,bytesTotal:1000,errorCode:null};
 const box={useCallback:f=>f,AbortController,EMPTY_PLAYER:{resumePending:true,time:0},SourceError:Error,problem:String,failureCode:String,getTestRun:()=>'',identity:(d,n)=>({seriesId:d.id,slug:d.slug,platform:d.platform,episodeNumber:n}),cardOnly:x=>x,episodeCacheKey:(d,n)=>d.slug+':'+n,record:(...args)=>events.push(args),mounted:ref(true),detailEpoch:ref(0),mediaEpoch:ref(0),detailRequest:ref(null),mediaRequest:ref(null),detailRef:ref(detail),detailOrigin:ref(origin),downloadRows:ref(rows.length?rows:[complete]),active:ref(null),controls:ref(null),preparedLease:ref(null),offlineLease:ref(null),offlineClosing:ref(Promise.resolve()),offlineClosingId:ref(null),requestedLoad:ref(null),snapshotRef:ref({loadId:null,resumePending:true,time:0}),episodeRef:ref(20),viewRef:ref('catalogue'),lastSlug:ref(null),lastSelection:ref(null),savedLibrary:ref({progress:{fixture:{episode:20,time}},saved:[],recents:[]}),feed:ref(null),endHold:noop,clearPrepared:noop,clearWarmup:noop,reveal:noop,remember:noop,flush:noop,showSystemBars:async()=>{},stopVideo:noop,releaseOfflineEpisode:async id=>events.push(['release',id]),listDownloads:async()=>box.downloadRows.current,acquireOfflineEpisode:async id=>{events.push(['acquire',id]);return acquire?acquire(id):{leaseId:'b'.repeat(32),uri:'reelm-offline://'+'b'.repeat(32)+'/'+'c'.repeat(32),detail,resolution:{sourceId:'offline',downloadId:id,identity:{seriesId:'12',slug:'fixture',platform:'DramaBox',episodeNumber:20},title:'Fixture',episodeNumber:20,type:'mp4',transport:'app-private-encrypted',englishSubtitleCues:[],subtitleStatus:'unavailable',languageQualification:'As provided'}};}};
 for(const name of ['setDetail','setDetailLoading','setDetailOpen','setDetailError','setSource','setSnap','setPlayerLoading','setPlayerError','setView','setEpisodeOpen','setEpisode','setCaptionsEnabled'])box[name]=value=>{events.push([name,value]);if(name==='setDetail')box.detailRef.current=value;if(name==='setPlayerError'||name==='setDetailError')if(value)errors.push(value);};
 box.fetchDetail=async()=>{events.push(['online-detail']);throw Error('ONLINE_FORBIDDEN');};box.resolveEpisode=async()=>{throw Error('ONLINE_FORBIDDEN');};box.prepareEpisode=async()=>{throw Error('ONLINE_FORBIDDEN');};box.episodeCache={load:async()=>{events.push(['online-cache']);throw Error('ONLINE_FORBIDDEN');},delete:()=>events.push(['cache-delete']),cancelPrefetch:noop};
 box.clearOffline=async()=>{const lease=box.offlineLease.current;box.offlineLease.current=null;if(lease)await box.releaseOfflineEpisode(typeof lease==='string'?lease:lease.leaseId);};
 box.deleteDownloads=async ids=>events.push(['delete',...ids]);
 const names=['clearOffline','openDetail','loadEpisode','watchCard','playOrdinal','retryPlayer','recover','watchDownload','removeDownloads'];
 const snippets=names.map(name=>{const match=source.match(new RegExp('const '+name+'=useCallback\\([\\s\\S]*?,\\[[A-Za-z0-9_,. ]*\\]\\);'));assert(match,name);return match[0];});
 vm.createContext(box);vm.runInContext(ts.transpileModule(snippets.join('\n')+'\nglobalThis.handlers={'+names.join(',')+'};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,box);
 return {box,card,detail,complete,events,errors,handlers:box.handlers};
}
for(const collection of ['Saved','Recents'])test('offline '+collection+' bypass every source call',async()=>{
 const f=controllerFixture();await f.handlers.watchCard(f.card,undefined,true);assert.equal(f.box.active.current?.resolution.sourceId,'offline');assert.equal(f.box.active.current.startTime,32);assert(!f.events.some(e=>e[0].startsWith('online-')));
});
test('offline unknown ordinal is explicit even after source-null failure and Retry',async()=>{
 const f=controllerFixture({origin:'offline'});await f.handlers.loadEpisode(f.detail,21);assert.equal(f.box.active.current,null);assert(f.errors.some(e=>/offline/i.test(e)));f.handlers.retryPlayer();await new Promise(setImmediate);assert(!f.events.some(e=>e[0].startsWith('online-')||e[0]==='cache-delete'));
});
test('normal Browse explicit selection stays online',async()=>{const f=controllerFixture();await f.handlers.watchCard(f.card,20,false);assert(f.events.some(e=>e[0]==='online-detail'));assert(!f.events.some(e=>e[0]==='acquire'));});

test('Downloads explicit selection starts zero and delete closes active lease before removing',async()=>{const f=controllerFixture();await f.handlers.watchDownload(f.complete);assert.equal(f.box.active.current.startTime,0);let close;const gate=new Promise(resolve=>close=resolve);f.box.releaseOfflineEpisode=async id=>{f.events.push(['release',id]);await gate;};const pending=f.handlers.removeDownloads([f.complete.id]);await new Promise(setImmediate);assert.equal(f.box.active.current,null);assert(!f.events.some(e=>e[0]==='delete'));f.handlers.clearOffline();assert.equal(f.events.filter(e=>e[0]==='release').length,2);close();await pending;assert.equal(f.events.at(-1)[0],'delete');});
test('late offline acquisition after navigation releases once and never resurrects source',async()=>{let finish;const gate=new Promise(resolve=>finish=resolve),f=controllerFixture({origin:'offline',acquire:()=>gate});const pending=f.handlers.loadEpisode(f.detail,20);await new Promise(setImmediate);++f.box.mediaEpoch.current;f.box.mediaRequest.current.abort();finish({leaseId:'b'.repeat(32)});await pending;assert.equal(f.box.active.current,null);assert.equal(f.events.filter(e=>e[0]==='release').length,1);});
test('offline metadata failure then Retry preserves32 and never enters online cache',async()=>{const f=controllerFixture({origin:'offline'});let attempt=0;const valid=f.box.acquireOfflineEpisode;f.box.acquireOfflineEpisode=async id=>{if(++attempt===1)throw Error('AUTH_FAILED');return valid(id);};await f.handlers.loadEpisode(f.detail,20,32,false);assert.equal(f.box.active.current,null);f.handlers.retryPlayer();await new Promise(setImmediate);assert.equal(f.box.active.current.startTime,32);assert.equal(f.box.active.current.autoplay,false);assert(!f.events.some(e=>e[0].startsWith('online-')||e[0]==='cache-delete'));});

test('browse while temporary metadata lease release is pending cannot resume stale watch',async()=>{const f=controllerFixture();let finish;const gate=new Promise(resolve=>finish=resolve);f.box.releaseOfflineEpisode=async id=>{f.events.push(['release',id]);await gate;};const pending=f.handlers.watchCard(f.card,undefined,true);await new Promise(setImmediate);++f.box.detailEpoch.current;f.box.detailRequest.current.abort();finish();await pending;assert.equal(f.box.active.current,null);assert.equal(f.events.filter(e=>e[0]==='acquire').length,1);});
test('explicit Downloads never falls back online after its rendered row disappears',async()=>{const f=controllerFixture();f.box.downloadRows.current=[];await f.handlers.watchDownload(f.complete);assert.equal(f.box.active.current,null);assert.equal(f.box.detailOrigin.current,'offline');assert(!f.events.some(e=>e[0]==='online-detail'));assert(f.errors.some(e=>/offline/i.test(e)));});

test('navigation clears source but delete still awaits its matching pending lease release',async()=>{const f=controllerFixture();await f.handlers.watchDownload(f.complete);let finish;const gate=new Promise(resolve=>finish=resolve);f.box.releaseOfflineEpisode=async()=>gate;const closing=f.handlers.clearOffline();f.box.active.current=null;f.box.requestedLoad.current=null;const deletion=f.handlers.removeDownloads([f.complete.id]);await new Promise(setImmediate);assert(!f.events.some(e=>e[0]==='delete'));finish();await Promise.all([closing,deletion]);assert.equal(f.events.filter(e=>e[0]==='delete').length,1);});
test('selected complete package metadata failure stays offline when row disappears before Detail Retry',async()=>{const f=controllerFixture();f.box.acquireOfflineEpisode=async()=>{throw Error('AUTH_FAILED');};await f.handlers.watchCard(f.card,undefined,true);f.box.downloadRows.current=[];const selection=f.box.lastSelection.current;await f.handlers.openDetail(selection.card,true,selection.local,selection.offlineOnly);assert.equal(f.box.detailOrigin.current,'offline');assert(!f.events.some(e=>e[0]==='online-detail'));});
