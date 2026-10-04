import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = relative => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');

test('prepared episode identity includes series, slug, platform, ordinal and English locale', () => {
  const app = read('../App.tsx');
  assert.match(app, /const episodeCacheKey=.*?\[d\.id,d\.slug,d\.platform,n,'en'\]\.join\('\|'\)/);
  assert.match(app, /createEpisodeCache<ResolvedEpisode>\(\{capacity:5,safetyMs:5000/);
  assert.match(app, /release:entry=>\{try\{const f=new File\(entry\.uri\);if\(f\.exists\)f\.delete\(\);\}catch\{\}/);
});

test('preparation writes a unique local manifest while preserving source-issued expiration and value', () => {
  const app = read('../App.tsx');
  const prepare = app.match(/async function prepareEpisode[\s\S]*?\n\}/)?.[0];
  assert(prepare);
  assert.match(prepare, /await resolveEpisode\(d,n,signal\);if\(signal\.aborted\)throw new SourceError\('ABORTED'\)/);
  assert.match(prepare, /'reelm-prepared-'\+Date\.now\(\)\+'-'\+\(\+\+preparedSequence\)\+'\.m3u8'/);
  assert.match(prepare, /f\.create\(\{overwrite:false\}\);f\.write\(value\.manifestBody\)/);
  assert.match(prepare, /key:episodeCacheKey\(d,n\),uri:f\.uri,expiresAt:value\.expiresAt,value/);
  assert.match(prepare, /catch\(e\)\{try\{if\(f\.exists\)f\.delete\(\);\}catch\{\}throw e;/);
  assert.doesNotMatch(prepare, /expiresAt:\s*Date\.now|overwrite:true/);
});

test('selected navigation consumes cache and releases an uncommitted stale result', () => {
  const app = read('../App.tsx');
  const load = app.match(/const loadEpisode=useCallback\(async[\s\S]*?\},\[remember,reveal,endHold,episodeCache(?:,[^\]]+)?\]\);/)?.[0];
  assert(load);
  assert.match(load, /await episodeCache\.load\(episodeCacheKey\(d,n\),signal=>prepareEpisode\(d,n,signal\),\{signal:ctrl\.signal\}\)/);
  assert.match(load, /releasePrepared=result\.releasePin/);
  assert.match(load, /if\(!mounted\.current\|\|ctrl\.signal\.aborted\|\|g!==mediaEpoch\.current\)\{releasePrepared\(\);return;\}/);
  assert.match(load, /uri:result\.entry\.uri,resolution:resolved/);
  assert.match(load, /cached:result\.cached/);
  assert.doesNotMatch(load, /await resolveEpisode|\.m3u8'\)|new File/);
  assert.match(load, /preparedLease\.current=releasePrepared;[\s\S]*?active\.current=next;setSource\(next\)/);
  assert.match(app, /const preparedLease=useRef<\(\(\)=>void\)\|null>\(null\)/);
  assert.match(app, /const release=preparedLease\.current;preparedLease\.current=null;if\(release\)setTimeout\(release,1000\)/);
  assert.match(load, /endHold\(\);clearPrepared\(\);mediaRequest/);
  assert.doesNotMatch(app, /useEffect\(\(\)=>\(\)=>\{if\(source\?\.releasePrepared/);
});

test('explicit retry and native credential recovery invalidate only the selected prepared key', () => {
  const app = read('../App.tsx');
  const retry = app.match(/const retryPlayer=useCallback[\s\S]*?\},\[loadEpisode,episodeCache\]\);/)?.[0];
  const recover = app.match(/const recover=useCallback[\s\S]*?\},\[loadEpisode,episodeCache\]\);/)?.[0];
  assert(retry); assert(recover);
  for (const fn of [retry, recover]) {
    assert.match(fn, /episodeCache\.delete\(episodeCacheKey\(d,episodeRef\.current\)\);void loadEpisode\(d,episodeRef\.current/);
    assert.doesNotMatch(fn, /episodeCache\.clear/);
  }
  assert.match(recover, /position,autoplay\)/);
});

test('only one advertised next episode prefetches after foreground playback has a healthy buffer', () => {
  const app = read('../App.tsx');
  assert.match(app, /const mayPrefetch=videoCaching&&mayAutoHide&&snap\.sourceLoadSeen&&snap\.bufferedPosition-snap\.time>=5/);
  const prefetch = app.match(/useEffect\(\(\)=>\{\s*if\(!mayPrefetch[\s\S]*?\},\[mayPrefetch,source\?\.loadId,detail,episodeCache,clearWarmup\]\);/)?.[0];
  assert(prefetch);
  assert.match(prefetch, /const n=source\.resolution\.episodeNumber\+1/);
  assert.match(prefetch, /if\(!detail\.episodes\[n-1\]\?\.advertisedAvailable\)return/);
  assert.match(prefetch, /episodeCache\.prefetch\(key,signal=>prepareEpisode\(detail,n,signal\),\{signal:ctrl\.signal\}\)/);
  assert.match(prefetch, /if\(ctrl\.signal\.aborted\|\|!mounted\.current\|\|active\.current\?\.loadId!==source\.loadId\)return/);
  assert.match(prefetch, /return\(\)=>\{ctrl\.abort\(\);episodeCache\.cancelPrefetch\(\);clearWarmup\(\);\}/);
  assert.doesNotMatch(prefetch, /setInterval|setTimeout|\.play\(|episodeNumber\+2/);
});

test('parent owns the warm manifest lease before scheduling a native child, including cancelled mount', () => {
  const app = read('../App.tsx'), warmup = read('../ui/NextEpisodeWarmup.tsx');
  assert.match(app, /const warmLease=useRef<\(\(\)=>void\)\|null>\(null\)/);
  assert.match(app, /const releaseLease=episodeCache\.pin\(result\.entry\);warmLease\.current=releaseLease;setWarmSource/);
  assert.match(app, /const release=warmLease\.current;warmLease\.current=null;if\(release\)setTimeout\(release,1000\)/);
  assert.match(app, /useEffect\(\(\)=>\(\)=>\{clearPrepared\(\);clearWarmup\(\);episodeCache\.clear\(\);\}/);
  assert.match(app, /<NextEpisodeWarmup key=\{warmSource\.entry\.uri\} uri=\{warmSource\.entry\.uri\}/);
  assert.match(warmup, /p\.muted = true/);
  assert.match(warmup, /p\.staysActiveInBackground = false/);
  assert.match(warmup, /preferredForwardBufferDuration: 6/);
  assert.match(warmup, /maxBufferBytes: 2 \* 1024 \* 1024/);
  assert.match(warmup, /replaceAsync\(\{uri, contentType: 'hls', useCaching: true\}\)/);
  assert.match(warmup, /return \(\) => \{alive = false; try \{player\.pause\(\);\} catch \{\}\}/);
  assert.doesNotMatch(warmup, /VideoView|releaseLease|releasePin|episodeCache|\.play\(/);
});

test('Android disk cache stays bounded and initializes before any active or warm native player', () => {
  const app = read('../App.tsx'), cache = read('../video-cache.ts'), player = read('../player.tsx');
  assert.match(cache, /VIDEO_CACHE_BYTES = 128 \* 1024 \* 1024/);
  assert.match(cache, /initialization \?\?= Platform\.OS === 'android'/);
  assert.match(cache, /setVideoCacheSizeAsync\(VIDEO_CACHE_BYTES\)\.then\(\(\) => true, \(\) => false\)/);
  assert.match(app, /\[cacheSetup,setCacheSetup\]=useState<boolean\|null>\(null\)/);
  assert.match(app, /prepareVideoCache\(\)\.then\(enabled=>\{if\(alive\)setCacheSetup\(enabled\);\}\)/);
  assert.match(app, /\(ready\|\|error\)&&cacheSetup!==null\?<ReelmApp videoCaching=\{cacheSetup\}/);
  assert.match(app, /source=\{source\} caching=\{videoCaching\}/);
  assert.match(player, /replaceAsync\(\{uri:source\.uri,contentType:'hls',useCaching:caching\}\)/);
  assert.doesNotMatch(player, /setVideoCacheSizeAsync/);
  assert.match(app, /entry instanceof File&&\/\^reelm-prepared-/);
});
