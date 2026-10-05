import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {clampResumeTime,resumeSeekObserved} from '../resume-policy.ts';
import {createSpeedBoost} from '../speed-boost.ts';
import {pingPongOffsets} from '../motion-policy.ts';
import {pathToFileURL} from 'node:url';
import {componentHarness} from './ui-harness.mjs';

const read = relative => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const playerFixture = initial => {
  let rate = initial;
  const writes = [];
  const boost = createSpeedBoost(() => rate, value => {writes.push(value); rate = value;});
  return {boost, writes, current: () => rate};
};

test('all configured hold rates restore captured rate', () => {
  for (const requested of [1.25, 1.5, 1.75, 2]) {
    const p = playerFixture(1.25);
    assert.equal(p.boost.begin(requested), true);
    assert.equal(p.boost.begin(2), true, 'next choice must not mutate the current hold');
    assert.equal(p.boost.end(), true);
    assert.deepEqual(p.writes, [requested, 1.25]);
  }
  for (const invalid of [0, 1, 1.3, NaN, Infinity, null, '2']) {
    const p = playerFixture(1.25);
    assert.equal(p.boost.begin(invalid), false);
    assert.deepEqual(p.writes, []);
  }
});

test('native position events stay live through holds and rate changes do not reload the player', () => {
  const listeners = new Map(), snapshots = [], rateWrites = [];
  let replacements = 0, initialized = false;
  const p = {currentTime: 0, duration: 60, playbackRate: 1.25, status: 'readyToPlay', playing: false, bufferedPosition: 40, videoTrack: {size: {width: 720, height: 1280}}, availableSubtitleTracks: [],
    play() {this.playing = true;}, pause() {this.playing = false;},
    replaceAsync() {++replacements; return Promise.resolve();},
    addListener(name, callback) {listeners.set(name, callback); return {remove: () => listeners.delete(name)};}};
  let rate = p.playbackRate;
  Object.defineProperty(p, 'playbackRate', {get: () => rate, set: value => {assert.equal(p.preservesPitch, true); rateWrites.push(value); rate = value;}});
  const appState = {currentState: 'active', addEventListener: () => ({remove() {}})};
  const source = {uri: 'https://native.test/episode.mp4', startTime: 0, autoplay: true, loadId: 'one', sourceSessionId: 'one', runId: 'one', resolution: {type: 'mp4', identity: {slug: 'one'}, expiresAt: Date.now() + 60000}};
  const h = componentHarness(process.env.REELM_PLAYER_TEST_SOURCE ? pathToFileURL(process.env.REELM_PLAYER_TEST_SOURCE).href : '../player.tsx', {'react-native': {AppState: appState}, 'expo-video': {VideoView: 'NativeVideo', useVideoPlayer: (_, setup) => {if (!initialized) {initialized = true; setup(p);} return p;}}, './diagnostics': {record() {}}, './speed-boost': {createSpeedBoost}, './resume-policy':{clampResumeTime,resumeSeekObserved}});
  const ref = {current: null}, props = {ref, source, holdSpeed: 2, onSnapshot: value => snapshots.push(value), onEnded() {}, onRecovery() {}};
  try {
    h.render('NativePlayer', props);
    assert.equal(p.timeUpdateEventInterval, 0.25);
    listeners.get('sourceLoad')({videoSource: {uri: source.uri}});
    p.playing = false; p.status = 'loading'; p.currentTime = 31.25;
    listeners.get('timeUpdate')({currentTime:p.currentTime});
    assert.equal(snapshots.at(-1).time, 31.25);
    assert.equal(snapshots.at(-1).desiredPlaying, true);
    p.status = 'readyToPlay'; p.playing = true;
    assert.equal(ref.current.beginSpeedBoost(), true);
    p.currentTime = 33.75; listeners.get('timeUpdate')({currentTime:p.currentTime});
    assert.equal(snapshots.at(-1).time, 33.75);
    h.render('NativePlayer', {...props, holdSpeed: 1.75});
    assert.equal(replacements, 1);
    assert.equal(rate, 2);
    ref.current.endSpeedBoost(); assert.equal(rate, 1.25);
    assert.equal(ref.current.beginSpeedBoost(), true); ref.current.endSpeedBoost();
    assert.deepEqual(rateWrites, [2, 1.25, 1.75, 1.25]);
    ref.current.pause(); assert.equal(ref.current.snapshot().desiredPlaying, false);
  } finally {h.cleanup();}
});

test('long-hold speed is absolute1.5 and release restores each exact prior native rate', () => {
  for (const initial of [0.1, 0.75, 1, 1.25, 1.5, 2, 16]) {
    const p = playerFixture(initial);
    assert.equal(p.boost.isActive(), false);
    assert.equal(p.boost.begin(), true);
    assert.equal(p.boost.isActive(), true);
    assert.equal(p.current(), 1.5);
    assert.equal(p.boost.end(), true);
    assert.equal(p.boost.isActive(), false);
    assert.equal(p.current(), initial);
    assert.deepEqual(p.writes, [1.5, initial]);
  }
});

test('duplicate long-press begin never overwrites savedrate with the temporary speed', () => {
  const p = playerFixture(1.25);
  for (let i = 0; i < 5; ++i) assert.equal(p.boost.begin(), true);
  assert.deepEqual(p.writes, [1.5]);
  assert.equal(p.boost.end(), true);
  assert.equal(p.current(), 1.25);
});

test('release, cancel and cleanup can repeat without writing a stale rate', () => {
  const p = playerFixture(1);
  assert.equal(p.boost.end(), false);
  assert.equal(p.boost.begin(), true);
  assert.equal(p.boost.end(), true);
  for (let i = 0; i < 5; ++i) assert.equal(p.boost.end(), false);
  assert.deepEqual(p.writes, [1.5, 1]);
});

test('independent player lifetime cannot restore a newer episode through an old owner', () => {
  const previous = playerFixture(1.25), next = playerFixture(1);
  previous.boost.begin();
  next.boost.begin();
  previous.boost.end();
  assert.equal(previous.current(), 1.25);
  assert.equal(next.current(), 1.5);
  next.boost.end();
  assert.equal(next.current(), 1);
});

test('invalid native rates never apply a boost or invent a restore value', () => {
  for (const initial of [NaN, Infinity, -Infinity, -1, 0, 16.01, null, undefined, '1']) {
    const p = playerFixture(initial);
    assert.equal(p.boost.begin(), false, String(initial));
    assert.equal(p.boost.isActive(), false);
    assert.equal(p.boost.end(), false);
    assert.deepEqual(p.writes, []);
  }
});

test('failed getter or boost setter stays contained and inactive', () => {
  let writes = 0;
  const brokenGetter = createSpeedBoost(() => {throw new Error('fixture unavailable getter');}, () => {++writes;});
  assert.equal(brokenGetter.begin(), false);
  assert.equal(brokenGetter.isActive(), false);
  assert.equal(writes, 0);
  const brokenSetter = createSpeedBoost(() => 1.25, () => {throw new Error('fixture unavailable setter');});
  assert.equal(brokenSetter.begin(), false);
  assert.equal(brokenSetter.isActive(), false);
  assert.equal(brokenSetter.end(), false);
});

test('failed restoration retains previousrate for later pause/background/cleanup retry', () => {
  let rate = 1.25, failRestore = true;
  const boost = createSpeedBoost(() => rate, value => {
    if (value === 1.25 && failRestore) throw new Error('fixture transient restore failure');
    rate = value;
  });
  assert.equal(boost.begin(), true);
  assert.equal(boost.end(), false);
  assert.equal(boost.isActive(), true);
  assert.equal(rate, 1.5);
  assert.equal(boost.begin(), true);
  failRestore = false;
  assert.equal(boost.end(), true);
  assert.equal(boost.isActive(), false);
  assert.equal(rate, 1.25);
});

test('repeated hold cycles restore the current native rate rather than a first-cycle default', () => {
  let rate = 1, boost = createSpeedBoost(() => rate, value => {rate = value;});
  for (const nextRate of [1, 1.25, 2, 0.75, 1.5]) {
    rate = nextRate;
    assert.equal(boost.begin(), true);
    assert.equal(rate, 1.5);
    assert.equal(boost.end(), true);
    assert.equal(rate, nextRate);
  }
});

test('loader knots are a continuous bounded0→travel→0 cycle with exact equal reset endpoints', () => {
  for (const travel of [0, 24, 78, 1000]) {
    const {inputRange, outputRange} = pingPongOffsets(travel);
    assert.equal(inputRange.length, 33);
    assert.equal(outputRange.length, 33);
    assert.equal(inputRange[0], 0);
    assert.equal(inputRange[16], 0.5);
    assert.equal(inputRange[32], 1);
    assert.equal(outputRange[0], 0);
    assert.equal(outputRange[16], travel);
    assert.equal(outputRange[32], 0);
    for (let i = 0; i < 33; ++i) {
      assert(Number.isFinite(outputRange[i]));
      assert(outputRange[i] >= 0 && outputRange[i] <= travel);
      if (i) assert(inputRange[i] > inputRange[i - 1]);
      if (i && i <= 16) assert(outputRange[i] >= outputRange[i - 1]);
      if (i > 16) assert(outputRange[i] <= outputRange[i - 1]);
      assert(Math.abs(outputRange[i] - outputRange[32 - i]) <= Math.max(1, travel) * 1e-12);
    }
  }
});

test('invalid loader travel rejects instead of interpolating nonfinite or backwards positions', () => {
  for (const travel of [-1, NaN, Infinity, -Infinity, null, undefined, '78']) {
    assert.throws(() => pingPongOffsets(travel), /INVALID_SIGNAL_TRAVEL/);
  }
});

test('video wrapper forwards taps to the cancellable per-page surface, not a sibling gesture blocker', () => {
  const app = read('../App.tsx'), surface = read('../ui/PlaybackSurface.tsx');
  assert.match(app, /<PlaybackSurface active=\{item\.number===episode&&!!source\} onTogglePlay=\{togglePlay\} desiredPlaying=\{snap\.desiredPlaying\} holdSpeed=\{holdSpeed\} onHoldStart=\{beginHold\} onHoldEnd=\{endHold\}/);
  assert.match(surface, /<View pointerEvents="none" style=\{StyleSheet\.absoluteFill\}>\{children\}<\/View>/);
  assert.match(surface, /cancelable delayLongPress=\{350\}/);
  assert.match(surface, /onPressIn=\{pressIn\} onTouchMove=\{move\} onLongPress=\{longPress\}/);
  assert.match(surface, /onPressOut=\{onHoldEnd\} onTouchCancel=\{cancel\} onPress=\{press\}/);
  assert.doesNotMatch(surface, /cancelable=\{false\}|blockNativeResponder|onStartShouldSetResponderCapture/);
});

test('long-hold surface cancels displacement, suppresses release tap and restores on unmount', () => {
  const surface = read('../ui/PlaybackSurface.tsx');
  assert.match(surface, /Math\.hypot\(event\.nativeEvent\.pageX - g\.x, event\.nativeEvent\.pageY - g\.y\) > 12/);
  assert.match(surface, /g\.moved = true;\s*onHoldEnd\(\)/);
  assert.match(surface, /if \(active && !gesture\.current\.moved\)/);
  assert.match(surface, /gesture\.current\.held = true;\s*onHoldStart\(\)/);
  assert.match(surface, /if \(active && appActive && !gesture\.current\.moved && !gesture\.current\.held\) \{\s*onTogglePlay\(\)/);
  assert.match(surface, /useEffect\(\(\) => \(\) => \{if \(gesture\.current\.held\) onHoldEnd\(\);\}/);
});

test('hold begins in visible or hidden chrome, captures exact player and cancels immersion timer', () => {
  const app = read('../App.tsx');
  const begin = app.match(/const beginHold=useCallback\(\(\)=>\{[\s\S]*?\},\[mayAutoHide,holdSpeed\]\);/)?.[0];
  assert(begin);
  assert.match(begin, /if\(!mayAutoHide\|\|!player\|\|!player\.beginSpeedBoost\(\)\)return false/);
  assert.match(begin, /holdOwner\.current=player;setHeldSpeed\(holdSpeed\);setHolding\(true\)/);
  assert.match(begin, /clearTimeout\(hideTimer\.current\);hideTimer\.current=null/);
  assert.match(begin, /setOverlayVisible\(false\)/);
  assert.doesNotMatch(begin, /!overlayVisible|!chromeVisible/);
  assert.match(app, /holdOwner\.current\?\.endSpeedBoost\(\);holdOwner\.current=null;setHolding\(false\)/);
});

test('source change, navigation, sheet, drag, background/buffering cancellation end captured hold', () => {
  const app = read('../App.tsx');
  assert.match(app, /const stopVideo=useCallback\(\(\)=>\{endHold\(\);/);
  assert.match(app, /const loadEpisode=useCallback\(async[\s\S]*?=>\{\s*endHold\(\);clearPrepared\(\);mediaRequest/);
  assert.match(app, /const openEpisodes=useCallback\(async\(\)=>\{endHold\(\);/);
  assert.match(app, /onScrollBeginDrag=\{\(\)=>\{endHold\(\);dragIntent/);
  assert.match(app, /useEffect\(\(\)=>\{if\(!mayAutoHide\)endHold\(\);return endHold;\},\[mayAutoHide,source\?\.loadId,endHold\]\)/);
});

test('native speed boost checks accepted ready playing foreground and restores before pause/background/disposal', () => {
  const player = read('../player.tsx');
  assert.match(player, /createSpeedBoost\(\(\)=>p\.playbackRate,rate=>\{p\.preservesPitch=true;p\.playbackRate=rate;\}\)/);
  assert.match(player, /beginSpeedBoost\(\)\{if\(loadFailed\.current\|\|!accepted\.current\|\|p\.status!=='readyToPlay'\|\|!p\.playing\|\|AppState\.currentState!=='active'\)return false;return boost\.begin\(holdSpeedRef\.current\);\}/);
  assert.match(player, /pause\(\)\{boost\.end\(\);desired\.current=false;p\.pause\(\)/);
  assert.match(player, /if\(state!=='active'\)\{boost\.end\(\);backgroundAt/);
  assert.match(player, /return\(\)=>\{boost\.end\(\);try\{p\.pause\(\)/);
});

test('native active player explicitly enables pitch preservation during initial setup, before any source loads', () => {
  const player = read('../player.tsx');
  const setup = player.match(/const p=useVideoPlayer\(null,x=>\{[\s\S]*?\}\);/)?.[0];
  assert(setup, 'native setup callback must exist');
  assert.match(setup, /x\.preservesPitch=true;/);
  assert(player.indexOf('x.preservesPitch=true;') < player.indexOf('p.replaceAsync('));
  assert.doesNotMatch(setup, /preservesPitch=false/);
});

test('every boost and restore rate assignment reasserts pitch preservation first', () => {
  const player = read('../player.tsx');
  const setter = player.match(/createSpeedBoost\(\(\)=>p\.playbackRate,rate=>\{([^{}]*)\}\)/)?.[1];
  assert(setter, 'the captured-player speed setter must exist');
  assert.match(setter, /^\s*p\.preservesPitch=true;\s*p\.playbackRate=rate;\s*$/);
  assert.equal((player.match(/p\.playbackRate\s*=/g) ?? []).length, 1, 'all native rate writes must share the pitch-corrected setter');
});

test('actual native callback keeps pitch1.0 through boost and exact-rate restoration', () => {
  const player = read('../player.tsx');
  const body = player.match(/createSpeedBoost\(\(\)=>p\.playbackRate,rate=>\{([^{}]*)\}\)/)?.[1];
  assert(body);
  for (const initial of [0.75, 1, 1.25, 1.5, 2]) {
    let rate = initial, preserve = false;
    const writes = [];
    const native = {
      get playbackRate() {return rate;},
      set playbackRate(value) {rate = value; writes.push(['rate', value, preserve ? 1 : value]);},
      set preservesPitch(value) {preserve = value; writes.push(['preserve', value]);},
    };
    const apply = new Function('p', `return rate=>{${body}};`)(native);
    const boost = createSpeedBoost(() => native.playbackRate, apply);
    assert.equal(boost.begin(), true);
    assert.equal(rate, 1.5);
    // A later native flag change must not survive the restoration callback.
    preserve = false;
    assert.equal(boost.end(), true);
    assert.equal(rate, initial);
    assert.deepEqual(writes, [['preserve', true], ['rate', 1.5, 1], ['preserve', true], ['rate', initial, 1]]);
  }
});

test('failed pitch-preservation setter never advances speed and remains a contained inactive hold', () => {
  const player = read('../player.tsx');
  const body = player.match(/createSpeedBoost\(\(\)=>p\.playbackRate,rate=>\{([^{}]*)\}\)/)?.[1];
  assert(body);
  let rate = 1.25, rateWrites = 0;
  const native = {
    get playbackRate() {return rate;},
    set playbackRate(value) {rate = value; ++rateWrites;},
    set preservesPitch(_value) {throw new Error('fixture pitch setter unavailable');},
  };
  const apply = new Function('p', `return rate=>{${body}};`)(native);
  const boost = createSpeedBoost(() => native.playbackRate, apply);
  assert.equal(boost.begin(), false);
  assert.equal(boost.isActive(), false);
  assert.equal(boost.end(), false);
  assert.equal(rate, 1.25);
  assert.equal(rateWrites, 0);
});

test('resume remains pending until matched ready post-seek native position, never setter or transient zero',()=>{const listeners=new Map(),snapshots=[];let actual=0,seeks=0;const p={duration:60,status:'readyToPlay',playing:false,bufferedPosition:40,availableSubtitleTracks:[],play(){this.playing=true;},pause(){this.playing=false;},replaceAsync(){return Promise.resolve();},addListener(n,f){listeners.set(n,f);return{remove(){}};}};Object.defineProperty(p,'currentTime',{get:()=>actual,set:()=>{seeks++;}});const source={uri:'https://native.test/resume.mp4',startTime:32,autoplay:false,loadId:'resume',runId:'resume',sourceSessionId:'resume',resolution:{type:'mp4',identity:{slug:'resume'},expiresAt:Date.now()+60000}};const h=componentHarness('../player.tsx',{'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},'expo-video':{VideoView:'Video',useVideoPlayer:(_,setup)=>{setup(p);return p;}},'./diagnostics':{record(){}},'./speed-boost':{createSpeedBoost},'./resume-policy':{clampResumeTime,resumeSeekObserved}});try{h.render('NativePlayer',{source,holdSpeed:1.5,ref:{current:null},onSnapshot:s=>snapshots.push(s),onEnded(){},onRecovery(){}});listeners.get('sourceLoad')({videoSource:{uri:'https://native.test/old.mp4'}});listeners.get('timeUpdate')({currentTime:32});assert(snapshots.at(-1).resumePending);listeners.get('sourceLoad')({videoSource:{uri:source.uri}});assert.equal(seeks,1);listeners.get('statusChange')({});assert(snapshots.at(-1).resumePending);listeners.get('timeUpdate')({currentTime:0});assert(snapshots.at(-1).resumePending);actual=32;listeners.get('timeUpdate')({currentTime:32});assert.equal(snapshots.at(-1).resumePending,false);assert.equal(snapshots.at(-1).loadId,'resume');}finally{h.cleanup();}});
