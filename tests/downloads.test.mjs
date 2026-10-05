import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {componentHarness} from './ui-harness.mjs';
import {SOURCE_CONTRACT} from '../services/source.ts';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const card={id:'12',slug:'fixture',title:'Fixture',platform:'DramaBox',cover:null,totalEpisodes:5000,availableEpisodes:5000,catalogueLanguage:'en'};
const load=native=>componentHarness('../downloads.ts',{'./native':{native}},[],{AbortController,Promise}).exports;
const boundary=()=>({reelmListDownloads:async()=>[],reelmEnqueueDownloads:async()=>{},reelmClaimNextDownload:async()=>null,reelmStartDownload:async()=>{},reelmFailDownload:async()=>{},reelmPauseDownloads:async()=>{},reelmResumeDownloads:async()=>{},reelmSetDownloadsActive:async()=>{},reelmCancelDownloads:async()=>{},reelmRetryDownloads:async()=>{},reelmDeleteDownloads:async()=>{}});
test('series queue resolves one selected ordinal just in time',async()=>{
 const events=[],gate=deferred(),issued=new WeakSet(),rows=[2,5000];let active=0,max=0;
 const n=boundary();n.reelmClaimNextDownload=async()=>rows.length?{ticket:'t'+rows[0],card,episodeNumber:rows.shift()}:null;
 n.reelmStartDownload=async(t,d,r)=>{assert(issued.has(d));events.push('start'+r.episodeNumber);max=Math.max(max,++active);await gate.promise;active--;};
 const api=load(n),pump=api.createDownloadPump({fetchDetail:async(c,s)=>{assert(s instanceof AbortSignal);events.push('detail');const d={...c};issued.add(d);return d;},resolveEpisode:async(d,num,s)=>{assert(issued.has(d));events.push('resolve'+num);return {episodeNumber:num};}});
 const drain=pump.setActive(true);await new Promise(setImmediate);assert.deepEqual(events,['detail','resolve2','start2']);const again=pump.wake();gate.resolve();await Promise.all([drain,again]);assert.deepEqual(events,['detail','resolve2','start2','detail','resolve5000','start5000']);assert.equal(max,1);await pump.dispose();
});
test('background cancels source resolution and resumes unfinished only',async()=>{
 const n=boundary(),claims=[2,2],events=[];let signal;
 n.reelmClaimNextDownload=async()=>claims.length?{ticket:'fresh'+claims.length,card,episodeNumber:claims.shift()}:null;
 n.reelmSetDownloadsActive=async active=>events.push('active'+active);n.reelmStartDownload=async()=>events.push('complete');n.reelmFailDownload=async()=>events.push('fail');
 const api=load(n),pump=api.createDownloadPump({fetchDetail:async(c,s)=>{signal=s;if(claims.length===1)await new Promise((resolve,reject)=>s.addEventListener('abort',()=>reject(Object.assign(Error('ABORTED'),{code:'ABORTED'})),{once:true}));return c;},resolveEpisode:async()=>({})});
 const first=pump.setActive(true);await new Promise(setImmediate);await pump.setActive(false);assert(signal.aborted);await first;assert(!events.includes('fail'));await pump.setActive(true);assert.equal(events.filter(x=>x==='complete').length,1);await pump.dispose();
});
test('background while a claim returns never starts stale ticket',async()=>{
 const n=boundary(),claim=deferred(),events=[];n.reelmClaimNextDownload=()=>claim.promise;n.reelmStartDownload=async()=>events.push('start');
 const api=load(n),pump=api.createDownloadPump({fetchDetail:async()=>{events.push('detail');},resolveEpisode:async()=>{}});
 const run=pump.setActive(true);await new Promise(setImmediate);await pump.setActive(false);claim.resolve({ticket:'old',card,episodeNumber:1});await run;assert.deepEqual(events,[]);await pump.dispose();
});
test('source failure reports its code and user pause remains explicit',async()=>{
 const n=boundary(),events=[];let claimed=false;n.reelmClaimNextDownload=async()=>claimed?null:(claimed=true,{ticket:'t',card,episodeNumber:1});n.reelmFailDownload=async(t,code)=>events.push(code);n.reelmPauseDownloads=async()=>events.push('userpause');n.reelmResumeDownloads=async()=>events.push('userresume');
 const api=load(n),pump=api.createDownloadPump({fetchDetail:async()=>{throw {code:'EPISODE_NOT_ADVERTISED'};},resolveEpisode:async()=>{}});await pump.setActive(true);await api.pauseDownloads();await api.resumeDownloads();assert.deepEqual(events,['EPISODE_NOT_ADVERTISED','userpause','userresume']);await pump.dispose();
});
test('queue facade maps only the prefixed existing native binding',async()=>{
 const n=boundary(),calls=[];for(const name of Object.keys(n))n[name]=async(...args)=>{calls.push([name,...args]);return null;};const api=load(n);await api.enqueueDownloads(card,[1,5000]);await api.cancelDownloads(['a']);await api.retryDownloads(['a']);await api.deleteDownloads(['a']);assert.deepEqual(calls.map(x=>x[0]),['reelmEnqueueDownloads','reelmCancelDownloads','reelmRetryDownloads','reelmDeleteDownloads']);
});
test('production policy pins every canonical host without E2E HTTP exception',()=>{
 const body=fs.readFileSync(new URL('../native/android/ReelmDownloadStore.kt',import.meta.url),'utf8');for(const host of SOURCE_CONTRACT.mediaHosts)assert(body.includes('"'+host+'"'));assert.match(body,/CookieJar.NO_COOKIES/);assert.match(body,/followRedirects\(false\)/);assert.match(body,/activeCall\?\.cancel\(\)/);assert.match(body,/DOWNLOAD_QUEUE_LIMIT/);
});
for(const action of ['cancelDownloads','deleteDownloads'])test(action+' aborts only its active source claim and drains unrelated work',{timeout:2000},async t=>{
 const n=boundary(),events=[];let signal;const claims=[1,2];n.reelmListDownloads=async()=>[{id:'id1',card,episodeNumber:1},{id:'id2',card,episodeNumber:2}];
 n.reelmClaimNextDownload=async()=>claims.length?{ticket:'t'+claims[0],card,episodeNumber:claims.shift()}:null;n.reelmStartDownload=async()=>events.push('complete');
 const api=load(n),pump=api.createDownloadPump({fetchDetail:async(c,s)=>{signal=s;if(claims.length===1)await new Promise((r,j)=>s.addEventListener('abort',()=>j(Error('ABORTED')),{once:true}));return c;},resolveEpisode:async()=>({})});
 t.after(()=>pump.dispose());const run=pump.setActive(true);await new Promise(setImmediate);await api[action](['id2']);assert(!signal.aborted);await api[action](['id1']);assert(signal.aborted);await run;await new Promise(setImmediate);assert.equal(events.filter(x=>x==='complete').length,1);
});
test('native persistence failures remain observable and lifecycle promises reject',async()=>{
 const n=boundary();n.reelmClaimNextDownload=async()=>{throw Error('persist failed');};const api=load(n),pump=api.createDownloadPump({fetchDetail:async()=>{},resolveEpisode:async()=>{}});await assert.rejects(pump.setActive(true),/persist failed/);assert.match(api.getDownloadPumpError().message,/persist failed/);await pump.dispose();
});
test('rapid readiness writes serialize and only current foreground drains',async()=>{
 const n=boundary(),first=deferred(),events=[];let call=0;
 n.reelmSetDownloadsActive=async value=>{events.push('begin'+value);if(++call===1)await first.promise;events.push('end'+value);};n.reelmClaimNextDownload=async()=>{events.push('claim');return null;};
 const pump=load(n).createDownloadPump({fetchDetail:async()=>{},resolveEpisode:async()=>{}});
 const a=pump.setActive(true);await new Promise(setImmediate);const b=pump.setActive(false),c=pump.setActive(true);await new Promise(setImmediate);
 assert.deepEqual(events,['begintrue']);first.resolve();await Promise.all([a,b,c]);assert.deepEqual(events,['begintrue','endtrue','beginfalse','endfalse','begintrue','endtrue','claim']);await pump.dispose();
});

test('offline acquisition binds logical id, authenticated metadata and releases invalid package',async()=>{
 const id='a'.repeat(32),lease='b'.repeat(32),events=[];const detail={...card,cover:null,audioEvidence:'unknown',languageQualification:'Stored qualification',isNew:false,isPopular:false,countWarning:null,description:'Stored',episodesInDB:5000,sourceDeclaredLanguage:'en',sourceDeclaredMode:null,subtitleEvidence:'unverified',sampledEnglishEpisodes:[],receipt:null,cached:true};
 const n={...boundary(),reelmAcquireOffline:async value=>{events.push(['acquire',value]);return {downloadId:id,leaseId:lease,rootUri:`reelm-offline://${lease}/${'c'.repeat(32)}`,contentType:'video/mp4'};},reelmReadOfflineMetadata:async value=>{events.push(['metadata',value]);return {version:1,detail,identity:{seriesId:'12',slug:'fixture',platform:'DramaBox',episodeNumber:20},episodeNumber:20,type:'mp4',englishSubtitleCues:[],subtitleStatus:'unavailable'};},reelmReleaseOffline:async value=>events.push(['release',value])};
 const api=load(n);assert.equal(typeof api.acquireOfflineEpisode,'function');const result=await api.acquireOfflineEpisode(id);assert.equal(result.resolution.downloadId,id);assert.equal(result.resolution.sourceId,'offline');assert.equal(result.detail.receipt,null);assert.equal(result.detail.cached,false);assert.equal(result.detail.episodes.length,5000);assert(!('expiresAt' in result.resolution));assert(!('receipt' in result.resolution));assert.deepEqual(events,[['acquire',id],['metadata',lease]]);await api.releaseOfflineEpisode(result.leaseId);assert.deepEqual(events.at(-1),['release',lease]);
 n.reelmReadOfflineMetadata=async()=>{throw Error('AUTH_FAILED');};await assert.rejects(api.acquireOfflineEpisode(id),/AUTH_FAILED/);assert.deepEqual(events.at(-1),['release',lease]);n.reelmAcquireOffline=async()=>({downloadId:id,leaseId:lease,rootUri:'https://forbidden.invalid',contentType:'video/mp4'});await assert.rejects(api.acquireOfflineEpisode(id));assert.deepEqual(events.at(-1),['release',lease]);
});

test('group sizes survive restart from native list rather than a JS database',async()=>{const rows=[{id:'1',card,episodeNumber:1,state:'complete',bytesStored:1080,bytesReceived:1000,bytesTotal:1000,errorCode:null},{id:'2',card,episodeNumber:2,state:'failed',bytesStored:40,bytesReceived:0,bytesTotal:null,errorCode:'EPISODE_NOT_ADVERTISED'}];const n=boundary();n.reelmListDownloads=async()=>structuredClone(rows);const api=load(n);assert.equal(typeof api.groupDownloads,'function');const first=api.groupDownloads(await api.listDownloads())[0];assert.equal(first.bytesStored,1120);assert.equal(first.complete,1);assert.equal(first.unavailable,1);assert.equal(first.failed,0);rows[0].bytesStored=2080;const restart=load(n).groupDownloads(await api.listDownloads())[0];assert.equal(restart.bytesStored,2120);});
