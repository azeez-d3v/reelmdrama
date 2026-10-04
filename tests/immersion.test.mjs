import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {controlsMayAutoHide, shouldShowChrome} from '../immersion-policy.ts';
import {createVisibilityQueue} from '../visibility-queue.ts';

const read = relative => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const uninterrupted = {view: 'player', playing: true, loading: false, error: false, sheetOpen: false, appActive: true};
const deferred = () => {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
};

test('immersion permits auto-hide only during uninterrupted foreground playback: exhaustive truth table', () => {
  for (const view of ['catalogue', 'player']) for (let mask = 0; mask < 32; ++mask) {
    const [playing, loading, error, sheetOpen, appActive] = Array.from({length: 5}, (_, bit) => !!(mask & (1 << bit)));
    const state = {view, playing, loading, error, sheetOpen, appActive};
    const expected = view === 'player' && playing && !loading && !error && !sheetOpen && appActive;
    assert.equal(controlsMayAutoHide(state), expected, JSON.stringify(state));
    assert.equal(shouldShowChrome(state, false), !expected, JSON.stringify(state));
    assert.equal(shouldShowChrome(state, true), true, JSON.stringify(state));
  }
});

test('tap explicitly reveals chrome without changing playback eligibility', () => {
  assert.equal(controlsMayAutoHide(uninterrupted), true);
  assert.equal(shouldShowChrome(uninterrupted, false), false);
  assert.equal(shouldShowChrome(uninterrupted, true), true);
});

test('every interruption independently preserves chrome even after the timer expires', () => {
  const interruptions = [{view: 'catalogue'}, {playing: false}, {loading: true}, {error: true}, {sheetOpen: true}, {appActive: false}];
  for (const delta of interruptions) {
    const state = {...uninterrupted, ...delta};
    assert.equal(controlsMayAutoHide(state), false, JSON.stringify(delta));
    assert.equal(shouldShowChrome(state, false), true, JSON.stringify(delta));
  }
});

test('incomplete or malformed runtime playback eligibility fails closed', () => {
  assert.equal(controlsMayAutoHide({}), false);
  for (const field of Object.keys(uninterrupted)) {
    const missing = {...uninterrupted};
    delete missing[field];
    assert.equal(controlsMayAutoHide(missing), false, `missing ${field}`);
    for (const invalid of [null, undefined, 0, 1, '', 'true', 'false']) {
      assert.equal(controlsMayAutoHide({...uninterrupted, [field]: invalid}), false, `${field}=${String(invalid)}`);
    }
  }
});

test('visibility writes serialize slow hide before reveal: the final native state is visible', async () => {
  const entered = deferred(), release = deferred(), calls = [];
  const queue = createVisibilityQueue(async visible => {
    calls.push(['start', visible]);
    if (!visible) {entered.resolve(); await release.promise;}
    calls.push(['end', visible]);
  });
  const hide = queue.request(false);
  await entered.promise;
  const show = queue.request(true);
  await Promise.resolve();
  assert.deepEqual(calls, [['start', false]]);
  release.resolve();
  assert.deepEqual(await Promise.all([hide, show]), [true, true]);
  assert.deepEqual(calls, [['start', false], ['end', false], ['start', true], ['end', true]]);
});

test('visibility queue preserves rapid hide/reveal/hide/reveal ordering', async () => {
  const calls = [], queue = createVisibilityQueue(async visible => {calls.push(visible);});
  const requests = [false, true, false, true].map(visible => queue.request(visible));
  assert.deepEqual(await Promise.all(requests), [true, true, true, true]);
  assert.deepEqual(calls, [false, true, false, true]);
});

test('failed native visibility call is contained and later reveal still executes', async () => {
  let attempts = 0, errors = 0;
  const calls = [], queue = createVisibilityQueue(async visible => {
    calls.push(visible);
    if (++attempts === 1) throw new Error('fixture native activity absent');
  }, () => {++errors;});
  const hide = queue.request(false), reveal = queue.request(true);
  assert.deepEqual(await Promise.all([hide, reveal]), [false, true]);
  assert.deepEqual(calls, [false, true]);
  assert.equal(errors, 1);
});

test('a throwing visibility error observer cannot poison later requests', async () => {
  let attempts = 0;
  const calls = [], queue = createVisibilityQueue(async visible => {
    calls.push(visible);
    if (++attempts === 1) throw new Error('fixture native failure');
  }, () => {throw new Error('fixture logging failure');});
  const hide = queue.request(false), reveal = queue.request(true);
  assert.deepEqual(await Promise.all([hide, reveal]), [false, true]);
  assert.deepEqual(calls, [false, true]);
});

test('status bar, navigation bar, playback controls and subtitle clearance share one chrome policy', () => {
  const app = read('../App.tsx'), bars = read('../ui/SystemBars.ts');
  assert.match(app, /chromeVisible=shouldShowChrome\(immersionState,overlayVisible\)/);
  assert.match(app, /useSystemBars\(chromeVisible,appActive\)/);
  assert.match(app, /<StatusBar\s+style="light"\s+hidden=\{!chromeVisible\}/);
  assert.match(app, /<PlayerOverlay[\s\S]*?visible=\{chromeVisible\}/);
  assert.match(app, /<SubtitleOverlay\s+text=\{cue\.text\}\s+bottomInset=\{insets\.bottom\}[\s\S]*?chromeVisible=\{chromeVisible\}/);
  assert.match(bars, /Platform\.OS === 'android'/);
  assert.match(bars, /NavigationBar\.setVisibilityAsync\(show \? 'visible' : 'hidden'\)/);
  assert.match(bars, /\[visible, appActive, controller\]/);
  assert.doesNotMatch(bars, /setBehaviorAsync|setPositionAsync|setBackgroundColorAsync/);
});

test('eligibility tracks pause, native buffering, errors, both sheets and foreground state', () => {
  const app = read('../App.tsx');
  assert.match(app, /playing:snap\.playing/);
  assert.match(app, /loading:playerLoading\|\|snap\.status==='loading'/);
  assert.match(app, /error:!!playerError/);
  assert.match(app, /sheetOpen:episodeOpen\|\|detailOpen/);
  assert.match(app, /appActive=useAppActive\(\)/);
  assert.match(app, /\[mayAutoHide,reveal\]/);
  assert.match(app, /clearTimeout\(hideTimer\.current\);hideTimer\.current=null/);
});

test('ordinary player tap restores controls without an overlay that steals vertical swipes', () => {
  const app = read('../App.tsx'), surface = read('../ui/PlaybackSurface.tsx'), overlay = read('../ui/PlayerOverlay.tsx'), motion = read('../ui/Motion.tsx');
  assert.match(app, /<PlaybackSurface[\s\S]*?onReveal=\{reveal\}/);
  assert.match(surface, /<Pressable testID="player-reveal-surface"/);
  assert.match(surface, /onPress=\{press\}/);
  assert.match(surface, /if \(!gesture\.current\.moved && !gesture\.current\.held\) onReveal\(\)/);
  assert.match(surface, /<View pointerEvents="none" style=\{StyleSheet\.absoluteFill\}>\{children\}<\/View>/);
  assert.match(app, /pagingEnabled/);
  assert.match(app, /onMomentumScrollEnd=\{swipe\}/);
  assert.match(overlay, /<AnimatedPresence visible=\{props\.visible !== false\}/);
  assert.doesNotMatch(overlay, /revealSurface|if \(props\.visible === false\) return/);
  assert.match(motion, /pointerEvents=\{visible \? 'box-none' : 'none'\}/);
  assert.match(motion, /accessibilityElementsHidden=\{!visible\}/);
  assert.match(motion, /importantForAccessibility=\{visible \? 'auto' : 'no-hide-descendants'\}/);
});

test('native sheets restore bars before mounting and guard stale async completions', () => {
  const app = read('../App.tsx'), bars = read('../ui/SystemBars.ts');
  const openingDetail = app.match(/const openDetail=useCallback\(async[\s\S]*?\},\[reveal,showSystemBars\]\);/)?.[0];
  const openingEpisodes = app.match(/const openEpisodes=useCallback\(async[\s\S]*?\},\[reveal,showSystemBars,endHold\]\);/)?.[0];
  assert(openingDetail); assert(openingEpisodes);
  assert.match(openingDetail, /await showSystemBars\(\);[\s\S]*?ctrl\.signal\.aborted\|\|g!==detailEpoch\.current[\s\S]*?setDetailOpen\(true\)/);
  assert.match(openingEpisodes, /await showSystemBars\(\);[\s\S]*?viewRef\.current!=='player'[\s\S]*?current\?\.loadId!==active\.current\?\.loadId[\s\S]*?setEpisodeOpen\(true\)/);
  assert.match(bars, /setStatusBarHidden\(false, 'fade'\)/);
  assert.match(bars, /await controller\.request\(true\)/);
  assert.match(bars, /useEffect\(\(\) => \(\) => \{void controller\.request\(true\);\}/);
});

test('opening story, finding story and buffering use the same actual animated loading signal', () => {
  const primitives = read('../ui/Primitives.tsx'), catalogue = read('../ui/CatalogueScreen.tsx'), sheets = read('../ui/Sheets.tsx'), overlay = read('../ui/PlayerOverlay.tsx');
  assert.match(primitives, /kind === 'loading' \? <LoadingSignal \/>/);
  assert.match(catalogue, /kind="loading" title="Finding your next story…"/);
  assert.match(sheets, /kind="loading" title="Opening this story…"/);
  assert.match(overlay, /<LoadingSignal compact/);
  assert.doesNotMatch(primitives, /styles\.signalLine/);
  assert.doesNotMatch(overlay, /styles\.loadingSignal/);
});

test('loading loop runs native-thread translation without monopolizing list interactions and stops when hidden', () => {
  const motion = read('../ui/Motion.tsx');
  assert.match(motion, /Animated\.loop\(Animated\.timing\(phase/);
  assert.match(motion, /phase\.interpolate\(pingPongOffsets\(travel\)\)/);
  assert.match(motion, /toValue: 1, duration: 2200, easing: Easing\.linear/);
  assert.match(motion, /transform: \[\{translateX: position\}\]/);
  assert.match(motion, /useNativeDriver: true, isInteraction: false/);
  assert.match(motion, /if \(reduced \|\| !active\)/);
  assert.match(motion, /loop\.stop\(\); phase\.stopAnimation\(\)/);
  assert.doesNotMatch(motion, /setInterval|requestAnimationFrame|Animated\.sequence|Animated\.delay/);
});

test('reduced-motion preference initializes conservatively, updates live, rejects stale query and cleans up', () => {
  const motion = read('../ui/Motion.tsx'), sheets = read('../ui/Sheets.tsx'), app = read('../App.tsx');
  assert.match(motion, /\[reduced, setReduced\] = useState\(true\)/);
  assert.match(motion, /AccessibilityInfo\.isReduceMotionEnabled\(\)/);
  assert.match(motion, /addEventListener\('reduceMotionChanged'/);
  assert.match(motion, /alive && revision === queryRevision/);
  assert.match(motion, /alive = false; subscription\.remove\(\)/);
  assert.match(motion, /AppState\.addEventListener\('change'/);
  assert.match(motion, /if \(reduced \|\| !active\) \{opacity\.stopAnimation\(\); opacity\.setValue\(visible \? 1 : 0\); return;\}/);
  assert.equal((motion.match(/AccessibilityInfo\.isReduceMotionEnabled\(/g) ?? []).length, 1);
  assert.equal((motion.match(/AccessibilityInfo\.addEventListener\('reduceMotionChanged'/g) ?? []).length, 1);
  assert.equal((motion.match(/AppState\.addEventListener\('change'/g) ?? []).length, 1);
  assert.match(app, /return <MotionProvider><SafeAreaProvider/);
  assert.equal((sheets.match(/animationType=\{reducedMotion \? 'none' : 'slide'\}/g) ?? []).length, 2);
});

test('button feedback animates content rather than shrinking measured safe-area hit targets', () => {
  const primitives = read('../ui/Primitives.tsx'), motion = read('../ui/Motion.tsx');
  assert.equal((primitives.match(/onPressIn=\{feedback\.onPressIn\} onPressOut=\{feedback\.onPressOut\}/g) ?? []).length, 2);
  assert.match(primitives, /<Animated\.View pointerEvents="none"/);
  assert.match(primitives, /minWidth: layout\.touchTarget, minHeight: layout\.touchTarget/);
  assert.match(motion, /toValue: 0\.94, duration: 100, useNativeDriver: true, isInteraction: false/);
  assert.match(motion, /toValue: 1, duration: 150/);
  assert.match(motion, /return \(\) => scale\.stopAnimation\(\)/);
});
