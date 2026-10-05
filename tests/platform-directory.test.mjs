import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createPlatformDirectoryLoader} from '../platform-directory.ts';
import {SourceError} from '../services/types.ts';

const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const flush = () => new Promise(done => setImmediate(done));
const platform = name => Object.freeze({name, logo: null, count: 17});
const directory = (...names) => Object.freeze({platforms: Object.freeze(names.map(platform)), cached: false, receipt: Object.freeze({requestId: 'directory-test', requestProfile: 'observed-desktop-UA', requests: [], freshGuestSessionReceived: true, cached: false})});
const read = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
const fixture = load => {
  const states = [], ready = [], errors = [];
  const loader = createPlatformDirectoryLoader({load, onState: state => states.push(state), describeError: error => `Directory: ${error.code ?? error.message}`, onReady: result => ready.push(result), onError: error => errors.push(error)});
  return {loader, states, ready, errors};
};

test('platform directory starts explicitly empty and publishes successful independent state', async () => {
  const result = directory('DramaBox', 'FlickReels'), f = fixture(async signal => {assert.equal(signal.aborted, false); return result;});
  assert.deepEqual(f.loader.snapshot().platforms, []); assert.equal(f.loader.snapshot().loading, false); assert.equal(f.loader.snapshot().error, null);
  assert.equal(await f.loader.refresh(), true);
  assert.deepEqual(f.loader.snapshot(), {platforms: result.platforms, loading: false, error: null});
  assert.equal(f.states[0].loading, true); assert.equal(f.states.at(-1).loading, false); assert.deepEqual(f.ready, [result]); assert.deepEqual(f.errors, []);
});

for (const code of ['NETWORK_ERROR', 'DEADLINE_EXCEEDED', 'HTTP_500', 'HTTP_502', 'HTTP_503', 'HTTP_504']) {
  test(`platform directory immediately retries ${code} once and recovers`, async () => {
    let attempts = 0; const signals = [], result = directory('GoodShort');
    const f = fixture(async signal => {signals.push(signal); if (++attempts === 1) throw new SourceError(code); return result;});
    assert.equal(await f.loader.refresh(), true); assert.equal(attempts, 2); assert(signals.every(s => !s.aborted));
    assert.deepEqual(f.loader.snapshot().platforms, result.platforms); assert.equal(f.loader.snapshot().error, null); assert.equal(f.loader.snapshot().loading, false);
    assert.deepEqual(f.ready, [result]); assert.deepEqual(f.errors, []);
  });
}

test('platform directory bounds persistent transient failure to two total attempts', async () => {
  let attempts = 0; const failure = new SourceError('NETWORK_ERROR'), f = fixture(async () => {++attempts; throw failure;});
  assert.equal(await f.loader.refresh(), false); await flush(); assert.equal(attempts, 2);
  assert.deepEqual(f.loader.snapshot().platforms, []); assert.equal(f.loader.snapshot().loading, false); assert.equal(f.loader.snapshot().error, 'Directory: NETWORK_ERROR');
  assert.deepEqual(f.errors, [failure]); assert.deepEqual(f.ready, []);
});

for (const code of ['INVALID_JSON', 'INVALID_PLATFORM', 'BODY_LIMIT', 'HTTP_401', 'HTTP_403', 'HTTP_404', 'HTTP_429', 'HTTP_501']) {
  test(`platform directory does not automatically retry terminal ${code}`, async () => {
    let attempts = 0; const failure = new SourceError(code), f = fixture(async () => {++attempts; throw failure;});
    assert.equal(await f.loader.refresh(), false); assert.equal(attempts, 1); assert.equal(f.loader.snapshot().loading, false);
    assert.equal(f.loader.snapshot().error, `Directory: ${code}`); assert.deepEqual(f.errors, [failure]); assert.deepEqual(f.ready, []);
  });
}

test('platform refresh preserves the last directory while loading and after failed refresh', async () => {
  const old = directory('DramaBox', 'ReelShort'), gate = deferred(); let attempts = 0;
  const f = fixture(async () => {if (++attempts === 1) return old; if (attempts === 2) return gate.promise; throw new SourceError('NETWORK_ERROR');});
  await f.loader.refresh(); const refresh = f.loader.refresh();
  assert.equal(f.loader.snapshot().loading, true); assert.deepEqual(f.loader.snapshot().platforms, old.platforms);
  gate.reject(new SourceError('NETWORK_ERROR')); assert.equal(await refresh, false); assert.equal(attempts, 3);
  assert.deepEqual(f.loader.snapshot().platforms, old.platforms); assert.equal(f.loader.snapshot().error, 'Directory: NETWORK_ERROR'); assert.equal(f.loader.snapshot().loading, false);
});

test('manual retry clears a terminal error and recovers without replacing the previous list prematurely', async () => {
  let attempts = 0; const fresh = directory('FlexTV'), gate = deferred();
  const f = fixture(async () => {if (++attempts === 1) throw new SourceError('INVALID_JSON'); return gate.promise;});
  assert.equal(await f.loader.refresh(), false); assert.equal(f.loader.snapshot().error, 'Directory: INVALID_JSON');
  const retry = f.loader.refresh(); assert.equal(f.loader.snapshot().loading, true); assert.equal(f.loader.snapshot().error, null);
  gate.resolve(fresh); assert.equal(await retry, true); assert.equal(attempts, 2); assert.deepEqual(f.loader.snapshot().platforms, fresh.platforms);
  assert.equal(f.loader.snapshot().error, null); assert.equal(f.errors.length, 1); assert.deepEqual(f.ready, [fresh]);
});

test('zero platforms is a successful explicit empty directory, not a fabricated fallback', async () => {
  const empty = directory(), f = fixture(async () => empty);
  assert.equal(await f.loader.refresh(), true); assert.deepEqual(f.loader.snapshot(), {platforms: [], loading: false, error: null});
  assert.deepEqual(f.ready, [empty]); assert.deepEqual(f.errors, []);
});

test('new platform refresh aborts stale requests and only latest generation publishes', async () => {
  const first = deferred(), second = deferred(), signals = []; let attempts = 0;
  const f = fixture(signal => {signals.push(signal); return ++attempts === 1 ? first.promise : second.promise;});
  const stale = f.loader.refresh(), current = f.loader.refresh(); assert.equal(signals[0].aborted, true); assert.equal(signals[1].aborted, false);
  const fresh = directory('StarDustTV'); second.resolve(fresh); assert.equal(await current, true);
  const count = f.states.length; first.resolve(directory('Obsolete')); assert.equal(await stale, false);
  assert.equal(f.states.length, count); assert.deepEqual(f.loader.snapshot().platforms, fresh.platforms); assert.deepEqual(f.ready, [fresh]); assert.deepEqual(f.errors, []);
});

test('stale transient rejection does not retry, publish an error or replace latest success', async () => {
  const staleGate = deferred(), latest = directory('DramaWave'); let attempts = 0;
  const f = fixture(() => ++attempts === 1 ? staleGate.promise : Promise.resolve(latest));
  const stale = f.loader.refresh(); assert.equal(await f.loader.refresh(), true); const count = f.states.length;
  staleGate.reject(new SourceError('HTTP_503')); assert.equal(await stale, false); await flush();
  assert.equal(attempts, 2); assert.equal(f.states.length, count); assert.deepEqual(f.ready, [latest]); assert.deepEqual(f.errors, []);
});

test('disposal aborts pending directory and suppresses ignored-abort late success', async () => {
  const gate = deferred(); let signal; const f = fixture(s => {signal = s; return gate.promise;});
  const pending = f.loader.refresh(); const count = f.states.length; const before = f.loader.snapshot();
  f.loader.dispose(); assert.equal(signal.aborted, true); gate.resolve(directory('Too late')); assert.equal(await pending, false);
  assert.equal(f.states.length, count); assert.deepEqual(f.loader.snapshot(), before); assert.deepEqual(f.ready, []); assert.deepEqual(f.errors, []);
  assert.equal(await f.loader.refresh(), false); assert.equal(f.states.length, count);
});

test('disposal suppresses late transient failure and never starts its retry', async () => {
  const gate = deferred(); let attempts = 0; const f = fixture(() => {++attempts; return gate.promise;});
  const pending = f.loader.refresh(), count = f.states.length; f.loader.dispose(); gate.reject(new SourceError('NETWORK_ERROR'));
  assert.equal(await pending, false); await flush(); assert.equal(attempts, 1); assert.equal(f.states.length, count); assert.deepEqual(f.errors, []);
});

test('source ABORTED result is silent, is never retried and never emits ready/error callbacks', async () => {
  let attempts = 0; const f = fixture(async () => {++attempts; throw new SourceError('ABORTED');});
  assert.equal(await f.loader.refresh(), false); assert.equal(attempts, 1); assert.deepEqual(f.ready, []); assert.deepEqual(f.errors, []);
  assert.equal(f.loader.snapshot().error, null); assert.equal(f.loader.snapshot().loading, false); assert(f.states.every(s => s.error === null));
});

test('disposed-before-refresh directory performs no request or state callback', async () => {
  let attempts = 0; const f = fixture(async () => {++attempts; return directory('Unexpected');});
  f.loader.dispose(); f.loader.dispose(); assert.equal(await f.loader.refresh(), false); assert.equal(attempts, 0); assert.deepEqual(f.states, []); assert.deepEqual(f.ready, []); assert.deepEqual(f.errors, []);
});

test('App keeps platform directory errors independent of unrelated catalogue state and exposes retry', () => {
  const app = read('../App.tsx'), ui = read('../ui/CatalogueScreen.tsx');
  assert.match(app, /createPlatformDirectoryLoader/);
  assert.match(app, /platformsError=\{directory\.error\}/); assert.match(app, /platformsLoading=\{directory\.loading\}/); assert.match(app, /onRetryPlatforms=\{retryPlatforms\}/);
  const catalogue = app.match(/const loadCatalogue=useCallback\(async[\s\S]*?\},\[hasMore\]\);/)?.[0]; assert(catalogue);
  assert.doesNotMatch(catalogue, /setDirectory|setPlatforms|directoryLoader\.dispose/);
  assert.doesNotMatch(app, /fetchPlatformDirectory\(ctrl\.signal\)\.then[\s\S]*?setCatalogueError\(problem\(e\)\)/);
  assert.match(ui, /platformsError\??: string \| null/); assert.match(ui, /platformsLoading\??: boolean/); assert.match(ui, /onRetryPlatforms\??: \(\) => void/);
  assert.match(ui, /platform-directory-retry/); assert.match(ui, /platform-directory-status/);
  assert.match(ui, /props\.platformsLoading \|\| props\.platformsError \|\| props\.platforms\.length === 0/);
  assert.match(ui, /'No platforms were returned\. Refresh to check again\.'/);
  assert.match(ui, /!props\.platformsLoading && props\.onRetryPlatforms/);
});

test('App pull refresh refreshes both directory and catalogue, and unmount disposes the loader', () => {
  const app = read('../App.tsx');
  assert.match(app, /onRefresh=\{tab==='saved'\?\(\)=>\{\}:refreshCatalogue\}/);
  const refresh = app.match(/const refreshCatalogue=useCallback\(\(\)=>\{([\s\S]*?)\},\[directoryLoader,loadCatalogue\]\);/)?.[1]; assert(refresh);
  assert.match(refresh, /clearSourceCache\(\)/); assert.match(refresh, /\.refresh\(\)/); assert.match(refresh, /loadCatalogue\(\{refresh:true\}\)/);
  assert.match(app, /mounted\.current=false;directoryLoader\.dispose\(\)/);
});
