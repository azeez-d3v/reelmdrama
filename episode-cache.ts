export interface PreparedEpisode<T> {
  key: string;
  expiresAt: number;
  uri: string;
  value: T;
}

export interface EpisodeCacheResult<T> {
  entry: PreparedEpisode<T>;
  /** True only for an already prepared, still-fresh entry; pending joins are not hits. */
  cached: boolean;
  /** Selected requests own a lease; release it when discarded or the player disposes. */
  releasePin: () => void;
}

export type PrepareEpisode<T> = (signal: AbortSignal) => Promise<PreparedEpisode<T>>;
export class EpisodeCacheError extends Error {
  readonly code: string;
  constructor(code: string) {super(code); this.name = 'EpisodeCacheError'; this.code = code;}
}

interface Subscriber<T> {
  prefetch: boolean;
  live: boolean;
  signal?: AbortSignal;
  abort?: () => void;
  resolve: (result: EpisodeCacheResult<T>) => void;
  reject: (reason: unknown) => void;
}
interface Pending<T> {
  key: string;
  controller: AbortController;
  subscribers: Set<Subscriber<T>>;
}

/** A small prepared-manifest LRU. Native video bytes live in the native media cache. */
export function createEpisodeCache<T>({capacity = 5, safetyMs = 5000, now = Date.now, release}: {
  capacity?: number;
  safetyMs?: number;
  now?: () => number;
  release: (entry: PreparedEpisode<T>) => void;
}) {
  if (!Number.isInteger(capacity) || capacity < 1 || !Number.isFinite(safetyMs) || safetyMs < 0) {
    throw new EpisodeCacheError('INVALID_CACHE_CONFIGURATION');
  }
  const entries = new Map<string, PreparedEpisode<T>>();
  const pending = new Map<string, Pending<T>>();
  const pins = new Map<PreparedEpisode<T>, number>();
  const retired = new Set<PreparedEpisode<T>>();
  const owned = new Set<PreparedEpisode<T>>();
  const released = new WeakSet<PreparedEpisode<T>>();
  const noop = () => {};
  const fresh = (entry: PreparedEpisode<T>) => Number.isFinite(entry.expiresAt) && entry.expiresAt > now() + safetyMs;
  const releaseOnce = (entry: PreparedEpisode<T>) => {
    if (released.has(entry)) return;
    if ((pins.get(entry) ?? 0) > 0) {retired.add(entry); return;}
    // Never dispose an object still held by a newer cache operation.
    if (entries.get(entry.key) === entry) return;
    retired.delete(entry); owned.delete(entry); released.add(entry);
    try {release(entry);} catch {}
  };
  const remove = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    releaseOnce(entry);
  };
  const touch = (entry: PreparedEpisode<T>) => {
    entries.delete(entry.key);
    entries.set(entry.key, entry);
  };
  const evictOne = () => {
    for (const [key, entry] of entries) if (!(pins.get(entry) ?? 0)) {remove(key); return true;}
    return false;
  };
  const prune = () => {
    for (const [key, entry] of entries) if (!fresh(entry)) remove(key);
    while (entries.size > capacity && evictOne()) {}
  };
  const pin = (entry: PreparedEpisode<T>): (() => void) => {
    if (!owned.has(entry) || released.has(entry)) throw new EpisodeCacheError('ENTRY_NOT_RETAINED');
    pins.set(entry, (pins.get(entry) ?? 0) + 1);
    let live = true;
    return () => {
      if (!live) return;
      live = false;
      const remaining = (pins.get(entry) ?? 0) - 1;
      if (remaining > 0) pins.set(entry, remaining);
      else {pins.delete(entry); if (retired.has(entry)) releaseOnce(entry);}
      prune();
    };
  };
  const cleanupSubscriber = (subscriber: Subscriber<T>) => {
    subscriber.live = false;
    if (subscriber.abort) subscriber.signal?.removeEventListener('abort', subscriber.abort);
  };
  const abandonIfEmpty = (operation: Pending<T>) => {
    if (operation.subscribers.size) return;
    if (pending.get(operation.key) === operation) pending.delete(operation.key);
    operation.controller.abort();
  };
  const detach = (operation: Pending<T>, subscriber: Subscriber<T>) => {
    if (!subscriber.live) return;
    cleanupSubscriber(subscriber);
    operation.subscribers.delete(subscriber);
    subscriber.reject(new EpisodeCacheError('ABORTED'));
    abandonIfEmpty(operation);
  };
  const fail = (operation: Pending<T>, reason: unknown) => {
    if (pending.get(operation.key) === operation) pending.delete(operation.key);
    for (const subscriber of operation.subscribers) {
      cleanupSubscriber(subscriber);
      subscriber.reject(reason);
    }
    operation.subscribers.clear();
  };
  const validEntry = (entry: PreparedEpisode<T>, key: string) => entry && typeof entry === 'object' &&
    entry.key === key && typeof entry.uri === 'string' && entry.uri.length > 0 && fresh(entry);
  const discardPrepared = (entry: PreparedEpisode<T>) => {
    if (entry && typeof entry === 'object' && typeof entry.uri === 'string' && entry.uri.length > 0) releaseOnce(entry);
  };
  const complete = (operation: Pending<T>, entry: PreparedEpisode<T>) => {
    if (operation.controller.signal.aborted || pending.get(operation.key) !== operation || !operation.subscribers.size) {
      discardPrepared(entry);
      return;
    }
    if (!validEntry(entry, operation.key)) {
      discardPrepared(entry);
      fail(operation, new EpisodeCacheError('INVALID_PREPARED_EPISODE'));
      return;
    }
    prune();
    while (entries.size >= capacity) {
      if (!evictOne()) {
        discardPrepared(entry);
        fail(operation, new EpisodeCacheError('CACHE_CAPACITY_BUSY'));
        return;
      }
    }
    owned.add(entry);
    entries.set(entry.key, entry);
    pending.delete(operation.key);
    for (const subscriber of operation.subscribers) {
      cleanupSubscriber(subscriber);
      subscriber.resolve({entry, cached: false, releasePin: subscriber.prefetch ? noop : pin(entry)});
    }
    operation.subscribers.clear();
  };
  const load = (key: string, prepare: PrepareEpisode<T>, {signal, prefetch = false}: {signal?: AbortSignal; prefetch?: boolean} = {}): Promise<EpisodeCacheResult<T>> => {
    if (signal?.aborted) return Promise.reject(new EpisodeCacheError('ABORTED'));
    if (typeof key !== 'string' || !key.length) return Promise.reject(new EpisodeCacheError('INVALID_CACHE_KEY'));
    prune();
    const hit = entries.get(key);
    if (hit) {
      touch(hit);
      return Promise.resolve({entry: hit, cached: true, releasePin: prefetch ? noop : pin(hit)});
    }
    let operation = pending.get(key);
    const created = !operation;
    if (!operation) {
      operation = {key, controller: new AbortController(), subscribers: new Set()};
      pending.set(key, operation);
    }
    const captured = operation;
    const result = new Promise<EpisodeCacheResult<T>>((resolve, reject) => {
      const subscriber: Subscriber<T> = {prefetch, live: true, signal, resolve, reject};
      subscriber.abort = () => detach(captured, subscriber);
      captured.subscribers.add(subscriber);
      signal?.addEventListener('abort', subscriber.abort, {once: true});
      // Accommodate an AbortSignal that changes between the first check and subscription.
      if (signal?.aborted) detach(captured, subscriber);
    });
    if (created) {
      // Every branch consumes the internal promise. A late ignored-abort result
      // owns a file, not a cache entry, and must still pass through disposal.
      void Promise.resolve().then(() => captured.controller.signal.aborted ? Promise.reject(new EpisodeCacheError('ABORTED')) : prepare(captured.controller.signal))
        .then(entry => complete(captured, entry), reason => fail(captured, reason));
    }
    return result;
  };
  const cancelPrefetch = () => {
    for (const operation of [...pending.values()]) for (const subscriber of [...operation.subscribers]) {
      if (subscriber.prefetch) detach(operation, subscriber);
    }
  };
  const abortPending = (key: string) => {
    const operation = pending.get(key);
    if (!operation) return;
    for (const subscriber of [...operation.subscribers]) detach(operation, subscriber);
    abandonIfEmpty(operation);
  };
  return {
    load,
    prefetch: (key: string, prepare: PrepareEpisode<T>, options: {signal?: AbortSignal} = {}) => load(key, prepare, {...options, prefetch: true}),
    pin,
    /** Freshness-only read: no disposal, insertion, LRU mutation, or native action. */
    peek: (key: string) => {const entry = entries.get(key); return entry && fresh(entry) ? entry : null;},
    get: (key: string) => {prune(); const entry = entries.get(key); if (entry) touch(entry); return entry ?? null;},
    prune,
    cancelPrefetch,
    delete(key: string) {abortPending(key); remove(key);},
    clear() {for (const key of [...pending.keys()]) abortPending(key); for (const key of [...entries.keys()]) remove(key);},
    get size() {return entries.size;},
    get pendingCount() {return pending.size;},
  };
}
