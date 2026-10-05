import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createLaunchLifetime, isLaunchReady, launchPresentation} from '../splash-policy.ts';

const read = relative => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');

test('launch requires settled fonts and settled cache, not enabled cache', () => {
  for (const cache of [false, true]) {
    assert.equal(isLaunchReady(true, false, cache), true);
    assert.equal(isLaunchReady(false, true, cache), true);
    assert.equal(isLaunchReady(false, false, cache), false);
  }
  assert.equal(isLaunchReady(true, false, null), false);
  assert.equal(isLaunchReady(false, true, null), false);
});
test('unready launch is a visible static blocking mark regardless of motion preference', () => {
  for (const reduced of [false, true]) for (const active of [false, true]) {
    const p = launchPresentation(false, false, reduced, active);
    assert.equal(p.visible, true);
    assert.equal(p.blocking, true);
    assert.equal(p.animateExit, false);
  }
});
test('ready launch becomes nonblocking before native animation finishes', () => {
  const p = launchPresentation(true, false, false, true);
  assert.equal(p.visible, true);assert.equal(p.blocking, false);
  assert.equal(p.animateExit, true);assert.equal(p.exitDurationMs, 220);
});
test('reduced motion keeps a short crossfade without scale or positional movement', () => {
  const p = launchPresentation(true, false, true, true);
  assert.equal(p.spatialMotion, false);assert.equal(p.exitDurationMs, 90);
  assert.equal(p.blocking, false);
});
test('readiness while background hides the splash immediately', () => {
  for (const reduced of [false, true]) {
    const p = launchPresentation(true, false, reduced, false);
    assert.equal(p.visible, false);assert.equal(p.blocking, false);
    assert.equal(p.animateExit, false);assert.equal(p.spatialMotion, false);
  }
});
test('completed splash never returns on foreground, preference or readiness changes', () => {
  for (const ready of [false, true]) for (const reduced of [false, true]) for (const active of [false, true]) {
    const p = launchPresentation(ready, true, reduced, active);
    assert.equal(p.visible, false);assert.equal(p.blocking, false);assert.equal(p.animateExit, false);
  }
});
test('cancelled and late animation callbacks never complete a new generation', () => {
  const l = createLaunchLifetime(), old = l.begin();
  l.invalidate();assert.equal(l.complete(old, true), false);
  const next = l.begin();assert.equal(l.complete(next, false), false);
  assert.equal(l.completed, false);assert.equal(l.complete(next, true), true);
  assert.equal(l.completed, true);assert.equal(l.complete(next, true), false);
  assert.equal(l.complete(l.begin(), true), false);
});
test('splash reuses the incumbent mark and locally loaded fonts on a matching dark surface', () => {
  const ui = read('../ui/LaunchSplash.tsx');
  assert(ui.includes('<ReelmMark size={96}/>'));
  assert(ui.includes('backgroundColor: colors.background'));
  assert(ui.includes('fontsLoaded ? styles.loadedName : null'));
  assert(ui.includes('fontsLoaded ? styles.loadedEdition : null'));
  assert(!ui.includes('Image'));assert(!ui.includes('fetch('));
});
test('splash exit is native-only, finite and cleanup invalidates before stopping callbacks', () => {
  const ui = read('../ui/LaunchSplash.tsx');
  assert.equal((ui.match(/useNativeDriver: true/g) ?? []).length, 2);
  assert.match(ui,/lifetime\.invalidate\(\);\s+animation\.stop\(\);/);
  assert(ui.includes('lifetime.complete(ticket, finished)'));
  assert(!ui.includes('setTimeout'));assert(!ui.includes('Animated.loop'));
});
test('splash touch and accessibility blocking end at local readiness', () => {
  const ui = read('../ui/LaunchSplash.tsx');
  assert(ui.includes("pointerEvents={presentation.blocking ? 'auto' : 'none'}"));
  assert(ui.includes('accessibilityElementsHidden={!presentation.blocking}'));
  assert(ui.includes("importantForAccessibility={presentation.blocking ? 'yes' : 'no-hide-descendants'}"));
});
test('live reduced-motion change resets scale before the opacity-only exit starts', () => {
  const ui = read('../ui/LaunchSplash.tsx');
  assert(ui.indexOf('if (!presentation.spatialMotion) scale.setValue(1);') < ui.indexOf('const animation = Animated.parallel'));
});
test('app mounts the same normal controller immediately beneath a sibling launch overlay', () => {
  const app = read('../App.tsx');
  assert(app.includes('isLaunchReady(ready,!!error,cacheSetup)'));
  assert(app.includes('{(ready||error)&&cacheSetup!==null&&libraryLoaded?<ReelmApp videoCaching={cacheSetup} library={library} setLibrary={setLibrary} loadError={loadError}/>:null}'));
  assert(app.includes('<LaunchSplash ready={appReady}'));
  assert.equal((app.match(/Linking\.getInitialURL\(\)/g) ?? []).length, 1);
  assert(!app.includes('Preparing your viewing desk'));
});
