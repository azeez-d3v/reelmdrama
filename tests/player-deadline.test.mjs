import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {componentHarness} from './ui-harness.mjs';
import {createSpeedBoost} from '../speed-boost.ts';
import {clampResumeTime,resumeSeekObserved} from '../resume-policy.ts';

function fixture({autoplay=true,startTime=86.999,offline=false,caching=false}={}) {
  let now=0,tick=null,appChange=null,replacements=0;
  const listeners=new Map(),snapshots=[],events=[],seekWrites=[];
  const app={currentState:'active',addEventListener:(_,callback)=>{appChange=callback;return {remove(){appChange=null;}};}};
  let time=0;
  const p={duration:125.333,status:'loading',playing:false,bufferedPosition:0,availableSubtitleTracks:[],playbackRate:1,
    play(){this.playing=true;},pause(){this.playing=false;},replaceAsync(value){replacements++;this.assigned=value;return Promise.resolve();},
    addListener(name,callback){listeners.set(name,callback);return {remove:()=>listeners.delete(name)};}};
  Object.defineProperty(p,'currentTime',{get:()=>time,set:value=>{seekWrites.push(value);time=value;}});
  const source={uri:'file:///owned/reelm-prepared-1-1.m3u8',startTime,autoplay,loadId:'one',sourceSessionId:'one',runId:'one',resolution:{sourceId:offline?'offline':'dramadunyam',type:'hls',identity:{slug:'godforged-ten-scraps-of-iron',episodeNumber:1},expiresAt:100000}};
  const h=componentHarness('../player.tsx',{'react-native':{AppState:app},'expo-video':{VideoView:'Video',useVideoPlayer:()=>p},'./diagnostics':{record:(event,fields)=>events.push({event,...fields})},'./speed-boost':{createSpeedBoost},'./resume-policy':{clampResumeTime,resumeSeekObserved}},[],
    {Date:{now:()=>now},setInterval:callback=>{tick=callback;return 1;},clearInterval:()=>{tick=null;}});
  const recoveries=[],ref={current:null},props={ref,source,caching,holdSpeed:1.5,onSnapshot:s=>snapshots.push(s),onEnded(){},onRecovery:(...args)=>recoveries.push(args)};
  h.render('NativePlayer',props);
  return {h,p,ref,source,recoveries,listeners,snapshots,events,seekWrites,get replacements(){return replacements;},
    advance(ms){now+=ms;tick?.();},state(value){app.currentState=value;appChange(value);},
    ready(){p.status='readyToPlay';listeners.get('sourceLoad')({videoSource:{uri:source.uri}});listeners.get('statusChange')({});}};
}

test('failed initial media reaches one terminal error after20 foreground seconds, never overwrites pending resume',()=>{
  const f=fixture();try {
    f.advance(19999);assert.equal(f.snapshots.at(-1).status,'loading');
    f.advance(1);assert.equal(f.snapshots.at(-1).status,'error');assert.equal(f.snapshots.at(-1).resumePending,true);
    assert.equal(f.snapshots.at(-1).desiredPlaying,true);assert.deepEqual(f.seekWrites,[]);assert.equal(f.p.playing,false);
    assert.equal(f.events.filter(e=>e.errorCategory==='NATIVE_LOAD_TIMEOUT').length,1);
    f.advance(30000);f.ready();assert.equal(f.p.playing,false);assert.equal(f.ref.current.snapshot().status,'error');
    assert.equal(f.events.filter(e=>e.errorCategory==='NATIVE_LOAD_TIMEOUT').length,1);
  }finally{f.h.cleanup();}
});

test('ready source starts at pending resume and remains playing beyond startup deadline',()=>{
  const f=fixture();try{f.advance(19000);f.ready();assert.deepEqual(f.seekWrites,[86.999]);assert.equal(f.p.playing,true);f.p.currentTime=87.3;f.listeners.get('timeUpdate')({currentTime:87.3});f.advance(30000);assert.equal(f.snapshots.at(-1).status,'readyToPlay');assert.equal(f.snapshots.at(-1).resumePending,false);assert.equal(f.events.some(e=>e.errorCategory==='NATIVE_LOAD_TIMEOUT'),false);}finally{f.h.cleanup();}
});

test('explicit zero initializes without stale saved seek and paused intent never autoplays',()=>{
  const f=fixture({startTime:0,autoplay:false});try{f.ready();f.advance(30000);assert.deepEqual(f.seekWrites,[]);assert.equal(f.p.playing,false);assert.equal(f.ref.current.snapshot().resumePending,false);assert.equal(f.ref.current.snapshot().status,'readyToPlay');}finally{f.h.cleanup();}
});

test('background cancels startup deadline; foreground gets a fresh active interval without autoplay while loading',()=>{
  const f=fixture();try{f.advance(19000);f.state('background');f.advance(25000);assert.equal(f.snapshots.at(-1).status,'loading');f.state('active');f.advance(19999);assert.equal(f.snapshots.at(-1).status,'loading');assert.equal(f.p.playing,false);f.advance(1);assert.equal(f.snapshots.at(-1).status,'error');}finally{f.h.cleanup();}
});

test('pause while loading retains false intent through timeout and ready callback',()=>{
  const f=fixture();try{f.ref.current.pause();f.advance(20000);assert.equal(f.snapshots.at(-1).status,'error');assert.equal(f.snapshots.at(-1).desiredPlaying,false);f.ready();assert.equal(f.p.playing,false);}finally{f.h.cleanup();}
});

test('unmount cancels startup observer and retry uses a new source lifetime',()=>{
  const f=fixture();f.advance(19000);f.h.cleanup();const count=f.snapshots.length;f.advance(50000);assert.equal(f.snapshots.length,count);
  const retry=fixture();try{retry.ready();retry.advance(30000);assert.equal(retry.ref.current.snapshot().status,'readyToPlay');assert.equal(retry.p.playing,true);}finally{retry.h.cleanup();}
});

test('actual App retry handler preserves paused intent, pending saved resume and explicit zero',()=>{
  const app=fs.readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
  const body=app.match(/const retryPlayer=useCallback\(\(\)=>\{(.*?)\},\[/)?.[1];assert(body);
  for(const startTime of [86.9990005493164,0]) for(const paused of [true,false]) for(const matching of [true,false]) {
    const calls=[],d={slug:'godforged-ten-scraps-of-iron',id:'145057'},intent={...d,episode:1,loadId:'load-3',startTime,autoplay:true};
    const snapshot={loadId:matching?'load-3':'old-load',resumePending:true,time:0,status:'error',desiredPlaying:!paused};
    new Function('detailRef','requestedLoad','episodeRef','mediaEpoch','episodeCache','episodeCacheKey','snapshotRef','loadEpisode','detailOrigin',body)(
      {current:d},{current:intent},{current:1},{current:3},{delete:key=>calls.push(['delete',key])},()=> 'exact-key',{current:snapshot},(...args)=>calls.push(['load',...args]),{current:'online'});
    assert.deepEqual(calls,[['delete','exact-key'],['load',d,1,startTime,matching?!paused:true]]);
  }
});

 test('offline foreground never refreshes and offline playback never enables Expo cache',()=>{const f=fixture({offline:true,caching:true,startTime:0});try{assert.equal(f.p.assigned.useCaching,false);f.ready();f.state('background');f.advance(1000000);f.state('active');assert.deepEqual(f.recoveries,[]);assert.equal(f.p.playing,true);f.ref.current.pause();f.state('background');f.advance(1000000);f.state('active');assert.equal(f.p.playing,false);assert.deepEqual(f.recoveries,[]);}finally{f.h.cleanup();}});
