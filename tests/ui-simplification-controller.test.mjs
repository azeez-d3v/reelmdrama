import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const app=fs.readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
test('controller has online-only episode selection but retains prepared cache and resume',()=>{
 assert.doesNotMatch(app,/from '\.\/downloads'|detailOrigin|offlineLease|downloadPump|watchDownload|queueEpisodes/);
 assert.match(app,/await episodeCache\.load\(episodeCacheKey\(d,n\)/);
 assert.match(app,/const progress=savedLibrary\.current\.progress\[d\.slug\]/);
 assert.match(app,/n===undefined&&progress\?\.episode===ordinal\?progress\.time:0/);
 assert.match(app,/prepareVideoCache\(\)/);
});
test('font setting scopes only the player subtitles, never app shell or splash',()=>{
 assert.match(app,/<FontScaleContext\.Provider value=\{library\.preferences\.fontScale\}><SubtitleOverlay[^]*?<\/FontScaleContext\.Provider>/);
 const entry=app.slice(app.indexOf('export default function App()'));
 assert.doesNotMatch(entry,/FontScaleContext\.Provider/);
});
test('search and platform selection use the sole home catalogue',()=>{
 assert.doesNotMatch(app,/setTab\('discover'\)/);
 for(const name of ['selectPlatform','submitSearch']){
  const body=app.match(new RegExp('const '+name+'=useCallback[^]*?\\},\\['))?.[0];
  assert(body);assert.match(body,/setTab\('home'\)/);
 }
 assert.equal(fs.readFileSync(new URL('../theme.ts',import.meta.url),'utf8').match(/export type MainTab = ([^;]+)/)?.[1],"'home' | 'saved' | 'settings'");
});

test('Android Back clears Home search or platform results, but not the unfiltered Home',()=>{
 const callback=app.match(/const back=useCallback\([^]*?\},\[[^]*?\]\);/)?.[0];
 assert(callback);
 for(const [tab,platform,query,handled] of [['home',null,'iron',true],['home','PineDrama','',true],['saved',null,'',true],['home',null,'',false]]){
  const calls=[],box={useCallback:f=>f,episodeOpen:false,detailOpen:false,viewRef:{current:'browse'},platformRef:{current:platform},queryRef:{current:query},tab,browse:()=>calls.push('browse'),closeEpisodes:()=>{},setTab:t=>calls.push(t),loadCatalogue:value=>calls.push(value)};
  vm.createContext(box);vm.runInContext(ts.transpileModule(callback+'\nglobalThis.invoke=back;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,box);
  assert.equal(box.invoke(),handled,`${tab}:${platform}:${query}`);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),handled?['home',{platform:null,query:''}]:[]);
 }
});
