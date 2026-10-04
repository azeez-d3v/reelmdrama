import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
test('quick-watch code keeps pending detail and source errors in the existing visible sheet',()=>{
 const watch=source.match(/const watchCard=useCallback\(async[\s\S]*?\},\[stopVideo,openDetail,loadEpisode\]\);/)?.[0];
 assert(watch);assert(watch.includes('await openDetail(card,true)'));assert(watch.includes('if(!d)return;'));
 const opening=source.match(/const openDetail=useCallback\(async[\s\S]*?\},\[reveal,showSystemBars\]\);/)?.[0];
 assert(opening);
 assert.match(opening,/if\(show\)\{reveal\(\);await showSystemBars\(\);if\(!mounted\.current\|\|ctrl\.signal\.aborted\|\|g!==detailEpoch\.current\)return null;setDetailOpen\(true\);\}/);
 assert(opening.indexOf('setDetailOpen(true)')<opening.indexOf('await fetchDetail(card,ctrl.signal)'));
 assert(source.includes('detailOpen?<SeriesDetailSheet detail={detail} loading={detailLoading} error={detailError}'));
});
test('the shared quick-watch sheet closes/cancels pending detail and closes on successful video selection',()=>{
 assert(source.includes("if(detailOpen){++detailEpoch.current;detailRequest.current?.abort();setDetailOpen(false);return true;}"));
 assert(source.includes('onClose={()=>{++detailEpoch.current;detailRequest.current?.abort();setDetailOpen(false);}}'));
 const load=source.match(/const loadEpisode=useCallback\(async[\s\S]*?\},\[remember,reveal,endHold,episodeCache(?:,[^\]]+)?\]\);/)?.[0];
 assert(load?.includes("setView('player')"));assert(load?.includes('setDetailOpen(false)'));
 assert(source.includes('ctrl.signal.aborted||g!==detailEpoch.current)return null'));
});
