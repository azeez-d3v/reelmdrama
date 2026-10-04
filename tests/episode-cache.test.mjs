import test from 'node:test';
import assert from 'node:assert/strict';
import {createEpisodeCache, EpisodeCacheError} from '../episode-cache.ts';

const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const flush = () => new Promise(done => setImmediate(done));
const fixture = (capacity = 5) => {
  let clock = 100000, counter = 0;
  const releases = [];
  const cache = createEpisodeCache({capacity, now: () => clock, release: entry => releases.push(entry)});
  const entry = (key, expiresAt = clock + 60000) => ({key, expiresAt, uri: `file:///manifest-${++counter}.m3u8`, value: {key, ordinal: counter}});
  return {cache, entry, releases, advance: ms => {clock += ms;}};
};
const isCode = code => error => error instanceof EpisodeCacheError && error.code === code;

test('cache defaults to five prepared entries and does not invent a hit on first preparation', async () => {
  const f = fixture(), prepared = f.entry('a'); let calls = 0;
  const result = await f.cache.load('a', async signal => {assert.equal(signal.aborted, false); ++calls; return prepared;});
  assert.equal(result.cached, false); assert.equal(result.entry, prepared); assert.equal(f.cache.size, 1); assert.equal(f.cache.pendingCount, 0);
  const hit = await f.cache.load('a', async () => {++calls; throw new Error('unexpected preparation');});
  assert.equal(hit.cached, true); assert.equal(hit.entry, prepared); assert.equal(calls, 1);
  result.releasePin(); hit.releasePin(); f.cache.clear(); assert.deepEqual(f.releases, [prepared]);
});

test('prefetch prepares the next episode once and selection consumes a fresh cached entry', async () => {
  const f = fixture(), prepared = f.entry('next'); let calls = 0;
  const prefetched = await f.cache.prefetch('next', async () => {++calls; return prepared;});
  assert.equal(prefetched.cached, false); prefetched.releasePin(); assert.equal(f.cache.peek('next'), prepared);
  const selected = await f.cache.load('next', async () => {++calls; return f.entry('next');});
  assert.equal(selected.cached, true); assert.equal(selected.entry.uri, prepared.uri); assert.equal(calls, 1);
  f.cache.clear(); assert.equal(f.releases.length, 0); selected.releasePin(); assert.deepEqual(f.releases, [prepared]);
});

test('pending prefetch promotion deduplicates and cancellation never aborts the joining selection', async () => {
  const f = fixture(), gate = deferred(), entered = deferred(); let calls = 0;
  const prefetch = f.cache.prefetch('next', async signal => {++calls; entered.resolve(signal); return gate.promise;});
  const prefetchRejected = assert.rejects(prefetch, isCode('ABORTED'));
  const shared = await entered.promise;
  const selected = f.cache.load('next', async () => {++calls; return f.entry('next');});
  f.cache.cancelPrefetch(); await prefetchRejected;
  assert.equal(shared.aborted, false); assert.equal(f.cache.pendingCount, 1);
  const prepared = f.entry('next'); gate.resolve(prepared);
  const result = await selected; assert.equal(result.entry, prepared); assert.equal(result.cached, false); assert.equal(calls, 1);
  result.releasePin(); f.cache.clear(); assert.deepEqual(f.releases, [prepared]);
});

test('two selected callers share preparation but each owns an independent active-file lease', async () => {
  const f = fixture(), gate = deferred(); let calls = 0;
  const prepare = async () => {++calls; return gate.promise;};
  const a = f.cache.load('same', prepare), b = f.cache.load('same', prepare);
  const prepared = f.entry('same'); gate.resolve(prepared);
  const [first, second] = await Promise.all([a, b]); assert.equal(calls, 1); assert.equal(first.cached, false); assert.equal(second.cached, false);
  f.cache.clear(); first.releasePin(); assert.equal(f.releases.length, 0);
  second.releasePin(); assert.deepEqual(f.releases, [prepared]);
});

test('one caller abort detaches only that caller while the shared operation completes for another', async () => {
  const f = fixture(), gate = deferred(), entered = deferred(), caller = new AbortController();
  const first = f.cache.load('shared', async signal => {entered.resolve(signal); return gate.promise;}, {signal: caller.signal});
  const rejected = assert.rejects(first, isCode('ABORTED'));
  const shared = await entered.promise, second = f.cache.load('shared', async () => f.entry('shared'));
  caller.abort(); await rejected; assert.equal(shared.aborted, false);
  const prepared = f.entry('shared'); gate.resolve(prepared); const result = await second; assert.equal(result.entry, prepared);
  result.releasePin(); f.cache.clear(); assert.deepEqual(f.releases, [prepared]);
});

test('all callers abort cancels the shared request and disposes a late ignored-abort prepared file', async () => {
  const f = fixture(), gate = deferred(), entered = deferred(), a = new AbortController(), b = new AbortController();
  const first = f.cache.load('abandon', async signal => {entered.resolve(signal); return gate.promise;}, {signal: a.signal});
  const second = f.cache.load('abandon', async () => f.entry('abandon'), {signal: b.signal});
  const rejected = [assert.rejects(first, isCode('ABORTED')), assert.rejects(second, isCode('ABORTED'))];
  const shared = await entered.promise; a.abort(); assert.equal(shared.aborted, false); b.abort(); await Promise.all(rejected);
  assert.equal(shared.aborted, true); assert.equal(f.cache.pendingCount, 0);
  const prepared = f.entry('abandon'); gate.resolve(prepared); await flush();
  assert.equal(f.cache.size, 0); assert.deepEqual(f.releases, [prepared]);
});

test('selected abort does not cancel another live prefetch subscriber', async () => {
  const f = fixture(), gate = deferred(), entered = deferred(), ctrl = new AbortController();
  const selected = f.cache.load('a', async signal => {entered.resolve(signal); return gate.promise;}, {signal: ctrl.signal});
  const rejected = assert.rejects(selected, isCode('ABORTED')), shared = await entered.promise;
  const prefetch = f.cache.prefetch('a', async () => f.entry('a'));
  ctrl.abort(); await rejected; assert.equal(shared.aborted, false);
  const prepared = f.entry('a'); gate.resolve(prepared); const result = await prefetch;
  assert.equal(result.entry, prepared); f.cache.clear(); assert.deepEqual(f.releases, [prepared]);
});

test('cancelPrefetch aborts an unjoined request and releases its late prepared file', async () => {
  const f = fixture(), gate = deferred(), entered = deferred();
  const prefetch = f.cache.prefetch('future', async signal => {entered.resolve(signal); return gate.promise;});
  const rejected = assert.rejects(prefetch, isCode('ABORTED')), shared = await entered.promise;
  f.cache.cancelPrefetch(); await rejected; assert.equal(shared.aborted, true); assert.equal(f.cache.pendingCount, 0);
  const prepared = f.entry('future'); gate.resolve(prepared); await flush(); assert.deepEqual(f.releases, [prepared]);
});

test('already-aborted caller never starts preparation or creates a pending operation', async () => {
  const f = fixture(), ctrl = new AbortController(); ctrl.abort(); let calls = 0;
  await assert.rejects(f.cache.load('a', async () => {++calls; return f.entry('a');}, {signal: ctrl.signal}), isCode('ABORTED'));
  assert.equal(calls, 0); assert.equal(f.cache.pendingCount, 0); assert.equal(f.cache.size, 0);
});

test('clear rejects all pending consumers and prevents stale completion repopulating cache', async () => {
  const f = fixture(), gate = deferred(), entered = deferred();
  const request = f.cache.load('old', async signal => {entered.resolve(signal); return gate.promise;});
  const rejected = assert.rejects(request, isCode('ABORTED')), shared = await entered.promise;
  f.cache.clear(); await rejected; assert.equal(shared.aborted, true);
  const prepared = f.entry('old'); gate.resolve(prepared); await flush();
  assert.equal(f.cache.size, 0); assert.equal(f.cache.peek('old'), null); assert.deepEqual(f.releases, [prepared]);
});

test('a stale completion cannot delete or overwrite a newer preparation for the same key', async () => {
  const f = fixture(), gate = deferred(), entered = deferred();
  const stale = f.cache.load('same', async signal => {entered.resolve(signal); return gate.promise;});
  const rejected = assert.rejects(stale, isCode('ABORTED')); await entered.promise; f.cache.clear(); await rejected;
  const current = f.entry('same'), selected = await f.cache.load('same', async () => current);
  const old = f.entry('same'); gate.resolve(old); await flush();
  assert.equal(f.cache.peek('same'), current); assert.deepEqual(f.releases, [old]);
  selected.releasePin(); f.cache.clear(); assert.deepEqual(f.releases, [old, current]);
});

test('expiry has an exact five-second safety margin and active pin prevents premature file deletion', async () => {
  const f = fixture(), prepared = f.entry('a', 105001), selected = await f.cache.load('a', async () => prepared);
  assert.equal(f.cache.peek('a'), prepared); f.advance(1); assert.equal(f.cache.peek('a'), null);
  assert.equal(f.cache.size, 1); assert.equal(f.releases.length, 0); // peek is read-only.
  f.cache.prune(); assert.equal(f.cache.size, 0); assert.equal(f.releases.length, 0);
  selected.releasePin(); assert.deepEqual(f.releases, [prepared]);
});

test('expired, wrong-key and empty-URI preparation cannot enter the cache', async () => {
  for (const kind of ['expired', 'boundary', 'wrong-key', 'empty-uri']) {
    const f = fixture(), prepared = f.entry('a');
    if (kind === 'expired') prepared.expiresAt = 104999;
    if (kind === 'boundary') prepared.expiresAt = 105000;
    if (kind === 'wrong-key') prepared.key = 'other';
    if (kind === 'empty-uri') prepared.uri = '';
    await assert.rejects(f.cache.load('a', async () => prepared), isCode('INVALID_PREPARED_EPISODE'));
    assert.equal(f.cache.size, 0); assert.equal(f.cache.pendingCount, 0);
    assert.equal(f.releases.length, kind === 'empty-uri' ? 0 : 1);
  }
});

test('LRU get promotes a previous episode and evicts an older unpinned file', async () => {
  const f = fixture(2), a = f.entry('a'), b = f.entry('b'), c = f.entry('c');
  await f.cache.prefetch('a', async () => a); await f.cache.prefetch('b', async () => b);
  assert.equal(f.cache.get('a'), a); await f.cache.prefetch('c', async () => c);
  assert.equal(f.cache.peek('a'), a); assert.equal(f.cache.peek('b'), null); assert.equal(f.cache.peek('c'), c);
  assert.equal(f.cache.size, 2); assert.deepEqual(f.releases, [b]); f.cache.clear();
});

test('peek does not promote LRU or perform file disposal', async () => {
  const f = fixture(2), a = f.entry('a'), b = f.entry('b'), c = f.entry('c');
  await f.cache.prefetch('a', async () => a); await f.cache.prefetch('b', async () => b);
  assert.equal(f.cache.peek('a'), a); await f.cache.prefetch('c', async () => c);
  assert.equal(f.cache.peek('a'), null); assert.deepEqual(f.releases, [a]); f.cache.clear();
});

test('active selected file survives LRU pressure while unpinned previous entries remain bounded', async () => {
  const f = fixture(2), active = f.entry('active'), selected = await f.cache.load('active', async () => active);
  const previous = f.entry('previous'); await f.cache.prefetch('previous', async () => previous);
  const next = f.entry('next'); await f.cache.prefetch('next', async () => next);
  assert.equal(f.cache.peek('active'), active); assert.equal(f.cache.peek('previous'), null); assert.equal(f.cache.size, 2);
  assert.deepEqual(f.releases, [previous]); f.cache.clear(); assert.deepEqual(f.releases, [previous, next]);
  selected.releasePin(); assert.deepEqual(f.releases, [previous, next, active]);
});

test('all-pinned capacity refuses a new entry instead of deleting active files or exceeding the bound', async () => {
  const f = fixture(1), active = f.entry('active'), selected = await f.cache.load('active', async () => active), next = f.entry('next');
  await assert.rejects(f.cache.prefetch('next', async () => next), isCode('CACHE_CAPACITY_BUSY'));
  assert.equal(f.cache.size, 1); assert.equal(f.cache.peek('active'), active); assert.deepEqual(f.releases, [next]);
  selected.releasePin(); f.cache.clear(); assert.deepEqual(f.releases, [next, active]);
});

test('active and warm native-player leases defer clear deletion until the last owner releases', async () => {
  const f = fixture(), prepared = f.entry('warm'), result = await f.cache.prefetch('warm', async () => prepared), releaseWarm = f.cache.pin(result.entry);
  const selected = await f.cache.load('warm', async () => f.entry('warm'));
  f.cache.clear(); assert.equal(f.cache.size, 0); assert.equal(f.releases.length, 0);
  releaseWarm(); releaseWarm(); assert.equal(f.releases.length, 0);
  selected.releasePin(); selected.releasePin(); assert.deepEqual(f.releases, [prepared]);
});

test('pinning an unknown or already released entry fails without creating an unbounded lease', async () => {
  const f = fixture(), unknown = f.entry('unknown'); assert.throws(() => f.cache.pin(unknown), isCode('ENTRY_NOT_RETAINED'));
  const result = await f.cache.prefetch('a', async () => f.entry('a')); f.cache.clear();
  assert.throws(() => f.cache.pin(result.entry), isCode('ENTRY_NOT_RETAINED')); assert.equal(f.cache.size, 0);
});

test('expired active old preparation and fresh replacement with same key keep separate resource leases', async () => {
  const f = fixture(), old = f.entry('same', 106000), first = await f.cache.load('same', async () => old);
  f.advance(2000); f.cache.prune(); assert.equal(f.cache.size, 0); assert.equal(f.releases.length, 0);
  const current = f.entry('same'), second = await f.cache.load('same', async () => current);
  assert.equal(second.cached, false); assert.equal(f.cache.peek('same'), current);
  first.releasePin(); assert.deepEqual(f.releases, [old]); assert.equal(f.cache.peek('same'), current);
  f.cache.clear(); second.releasePin(); assert.deepEqual(f.releases, [old, current]);
});

test('delete aborts only the targeted pending key and preserves unrelated work', async () => {
  const f = fixture(), aGate = deferred(), bGate = deferred(), aEntered = deferred(), bEntered = deferred();
  const a = f.cache.load('a', async signal => {aEntered.resolve(signal); return aGate.promise;});
  const rejected = assert.rejects(a, isCode('ABORTED'));
  const b = f.cache.load('b', async signal => {bEntered.resolve(signal); return bGate.promise;});
  const [aSignal, bSignal] = await Promise.all([aEntered.promise, bEntered.promise]);
  f.cache.delete('a'); await rejected; assert.equal(aSignal.aborted, true); assert.equal(bSignal.aborted, false);
  const old = f.entry('a'), current = f.entry('b'); aGate.resolve(old); bGate.resolve(current);
  const result = await b; await flush(); assert.deepEqual(f.releases, [old]); assert.equal(f.cache.peek('b'), current);
  result.releasePin(); f.cache.clear();
});

test('delete retires an active file and releases it exactly once only after source disposal', async () => {
  const f = fixture(), prepared = f.entry('a'), result = await f.cache.load('a', async () => prepared);
  f.cache.delete('a'); f.cache.delete('a'); f.cache.clear(); assert.equal(f.cache.size, 0); assert.equal(f.releases.length, 0);
  result.releasePin(); result.releasePin(); assert.deepEqual(f.releases, [prepared]);
});

test('loader exception is handled and does not poison a later preparation or release a nonexistent file', async () => {
  const f = fixture(), failure = new Error('fixture preparation failure');
  await assert.rejects(f.cache.load('a', async () => {throw failure;}), error => error === failure);
  assert.equal(f.cache.pendingCount, 0); assert.equal(f.releases.length, 0);
  const prepared = f.entry('a'), result = await f.cache.load('a', async () => prepared); assert.equal(result.cached, false);
  result.releasePin(); f.cache.clear(); assert.deepEqual(f.releases, [prepared]);
});

test('throwing release callback is contained and cannot poison later cache operations', async () => {
  let attempts = 0;
  const cache = createEpisodeCache({capacity: 1, now: () => 100000, release: () => {++attempts; throw new Error('fixture delete failure');}});
  const prepared = key => ({key, expiresAt: 200000, uri: `file:///${key}.m3u8`, value: key});
  await cache.prefetch('a', async () => prepared('a')); await cache.prefetch('b', async () => prepared('b')); cache.clear();
  assert.equal(cache.size, 0); assert.equal(attempts, 2);
});

test('configuration and key bounds reject before preparing a file', async () => {
  for (const capacity of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => createEpisodeCache({capacity, release: () => {}}), isCode('INVALID_CACHE_CONFIGURATION'));
  for (const safetyMs of [-1, NaN, Infinity]) assert.throws(() => createEpisodeCache({safetyMs, release: () => {}}), isCode('INVALID_CACHE_CONFIGURATION'));
  const f = fixture(); await assert.rejects(f.cache.load('', async () => f.entry('')), isCode('INVALID_CACHE_KEY'));
  assert.equal(f.cache.pendingCount, 0); assert.equal(f.releases.length, 0);
});
