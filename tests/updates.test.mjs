import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {componentHarness} from './ui-harness.mjs';
const assetName='ReelmDrama-arm64-v8a.apk',digest='a'.repeat(64),latest='https://api.github.com/repos/azeez-d3v/reelmdrama/releases/latest';
const release=()=>({tag_name:'v0.2.1',draft:false,prerelease:false,assets:[{name:assetName,size:123,state:'uploaded',digest:'sha256:'+digest,browser_download_url:`https://github.com/azeez-d3v/reelmdrama/releases/download/v0.2.1/${assetName}`} ]});
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const load=(native={reelmGetInstalledVersion:async()=>({versionName:'0.2.0',versionCode:3,updateTrusted:true})},fetchImpl=async()=>response(release()))=>{
 assert(fs.existsSync(new URL('../updates.ts',import.meta.url)),'manual updater is missing');
 return componentHarness('../updates.ts',{'./native':{native},'expo/fetch':{fetch:fetchImpl}},[],{AbortController,URL,Date,TextDecoder,Uint8Array,setTimeout,clearTimeout}).exports;
};
const check=(api,signal=new AbortController().signal)=>api.checkForUpdate(signal);

test('manual public latest check exposes the exact APK and published digest, not a trusted native version',async()=>{
 const requests=[],api=load(undefined,async(url,options)=>{requests.push([url,options]);return response(release());});
 const result=await check(api);assert.equal(result.status,'available');assert.equal(result.candidate.assetName,assetName);assert.equal(result.candidate.sha256,digest);assert.equal(result.candidate.bytes,123);assert.equal(result.releaseTag,'v0.2.1');assert.equal(result.candidate.versionCode,undefined);assert.equal(typeof result.checkedAt,'number');
 assert.equal(requests.length,1);assert.equal(requests[0][0],latest);assert.equal(requests[0][1].method,'GET');assert.equal(requests[0][1].redirect,'manual');assert.equal(requests[0][1].credentials,'omit');assert.equal(Object.keys(requests[0][1].headers).some(k=>/authorization|cookie/i.test(k)),false);
 assert.equal(api.getLastUpdateCheck().checkedAt,result.checkedAt);
});
test('the matching installed display version is advisory current and no release is explicit current',async()=>{
 const value=release();value.tag_name='v0.2.0';value.assets[0].browser_download_url=value.assets[0].browser_download_url.replace('v0.2.1','v0.2.0');assert.equal((await check(load(undefined,async()=>response(value)))).status,'current');
 const none=await check(load(undefined,async()=>new Response('',{status:404})));assert.equal(none.status,'current');assert.equal(none.releaseTag,null);assert.equal(none.candidate,null);
});
test('latest rejects ambiguous APK and missing or invalid digest as unverified',async()=>{
 for(const change of [v=>v.assets.push({...v.assets[0]}),v=>v.assets=[],v=>delete v.assets[0].digest,v=>v.assets[0].digest='sha256:no',v=>v.assets[0].name='ReelmDrama.apk',v=>v.assets[0].state='new']){
  const v=release();change(v);const result=await check(load(undefined,async()=>response(v)));assert.equal(result.status,'unverified');assert.equal(result.candidate,null);
 }
});
test('draft, prerelease, malformed release and over-limit assets never become candidates',async()=>{
 for(const change of [v=>v.draft=true,v=>v.prerelease=true,v=>delete v.draft,v=>v.tag_name='bad\nlabel',v=>v.assets[0].size=268435457,v=>v.assets[0].size=0,v=>v.assets[0].size=1.5]){
  const v=release();change(v);assert.equal((await check(load(undefined,async()=>response(v)))).status,'unverified');
 }
});
test('APK issuer URL is exact HTTPS repository path without credentials, port, fragments or lookalike hosts',async()=>{
 for(const url of ['http://github.com/x','https://github.com.evil.test/x','https://user:pass@github.com/x','https://github.com:444/x','https://github.com/other/reelmdrama/releases/download/v0.2.1/'+assetName,'https://github.com/azeez-d3v/reelmdrama/releases/download/v0.2.1/'+assetName+'#fragment','https://github.com/azeez-d3v/reelmdrama/releases/download/other/'+assetName,'https://release-assets.githubusercontent.com/arbitrary.apk']){
  const v=release();v.assets[0].browser_download_url=url;assert.equal((await check(load(undefined,async()=>response(v)))).status,'unverified');
 }
});
test('redirects stay on approved HTTPS hosts, stop after five, and reject automatic final URL escape',async()=>{
 let calls=0;const safe=load(undefined,async(url)=>++calls===1?new Response('',{status:302,headers:{location:latest+'?redirected=1'}}):response(release()));assert.equal((await check(safe)).status,'available');assert.equal(calls,2);
 for(const url of ['https://evil.test/release','http://api.github.com/release','https://api.github.com:444/release','https://user@api.github.com/release'])await assert.rejects(check(load(undefined,async()=>new Response('',{status:302,headers:{location:url}}))),/UPDATE_REDIRECT/);
 calls=0;await assert.rejects(check(load(undefined,async()=>{calls++;return new Response('',{status:302,headers:{location:latest}});})),/UPDATE_REDIRECT/);assert.equal(calls,6);
 const escaped=response(release());Object.defineProperty(escaped,'url',{value:'https://evil.test/release'});await assert.rejects(check(load(undefined,async()=>escaped)),/UPDATE_REDIRECT/);
});
test('JSON bytes are bounded before parsing and stream overflow cancels the reader',async()=>{
 await assert.rejects(check(load(undefined,async()=>new Response('{}',{headers:{'content-length':'1048577'}}))),/UPDATE_METADATA_LIMIT/);
 let reads=0,cancelled=false;const huge={status:200,ok:true,url:latest,headers:new Headers(),body:{getReader:()=>({read:async()=>{reads++;return {done:false,value:new Uint8Array(700000)};},cancel:async()=>{cancelled=true;},releaseLock(){}})}};
 await assert.rejects(check(load(undefined,async()=>huge)),/UPDATE_METADATA_LIMIT/);assert.equal(reads,2);assert.equal(cancelled,true);
 await assert.rejects(check(load(undefined,async()=>new Response('{broken'))),/UPDATE_METADATA_INVALID/);
});
test('caller cancellation prevents requests and abandons a stalled body read',async()=>{
 const controller=new AbortController();controller.abort();let requests=0;await assert.rejects(check(load(undefined,async()=>{requests++;}),controller.signal),/UPDATE_CANCELLED/);assert.equal(requests,0);
 const c=new AbortController(),pending=check(load(undefined,async()=>({status:200,ok:true,url:latest,headers:new Headers(),body:{getReader:()=>({read:()=>new Promise(()=>{}),cancel:async()=>{},releaseLock(){}})}})),c.signal);await new Promise(setImmediate);c.abort();await assert.rejects(pending,/UPDATE_CANCELLED/);
});
test('HTTP rate limit/network failures remain retryable, without exposing remote response bodies',async()=>{
 await assert.rejects(check(load(undefined,async()=>new Response('private upstream details',{status:403}))),/UPDATE_HTTP_403/);
 await assert.rejects(check(load(undefined,async()=>{throw Error('network internal');})),/UPDATE_NETWORK/);
});
test('facade delegates transfer, cancellation, status and installation to the one prefixed native binding',async()=>{
 const events=[],n={reelmDownloadUpdate:async c=>events.push(['download',c]),reelmCancelUpdate:async()=>events.push(['cancel']),reelmGetUpdateStatus:async()=>({state:'verified',bytes:123,total:123,errorCode:null}),reelmInstallVerifiedUpdate:async()=>events.push(['install'])};
 const api=load(n),candidate={releaseTag:'v0.2.1',assetName,url:release().assets[0].browser_download_url,bytes:123,sha256:digest};await api.downloadUpdate(candidate);await api.cancelUpdate();assert.equal((await api.getUpdateStatus()).state,'verified');await api.installVerifiedUpdate();assert.deepEqual(events.map(e=>e[0]),['download','cancel','install']);
});
