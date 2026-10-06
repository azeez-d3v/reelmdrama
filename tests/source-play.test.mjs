import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceClient,SOURCE_CONTRACT} from '../services/source.ts';
const detail={id:'145057',slug:'godforged-ten-scraps-of-iron',title:'GODFORGED: TEN SCRAPS OF IRON',platform:'ReelShort',language:'en',total_episodes:40,available_episodes:40,episodes_in_db:40};
const direct='https://v-mps.crazymaplestudios.com/fixture/episode.m3u8';
const manifest='#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\none.ts?fixture=exact\n#EXT-X-ENDLIST\n';
const legacy=manifest.replace('one.ts?fixture=exact','https://cdn2.dramaflix.net/fixture/legacy.ts');
const envelope={delivery:'direct',type:'hls',url:direct,source_tag:'fixture',expires_at:null,altyazilar:[],mod:'hybrid'};
function response(value,status=200,headers={}){return new Response(typeof value==='string'?value:JSON.stringify(value),{status,headers:{'content-type':typeof value==='string'?'application/vnd.apple.mpegurl':'application/json',...headers}});}
function setup({mode='hybrid',play=envelope,playStatus=200,media=()=>response(manifest),now=()=>Date.now(),deadlineMs}={}){
 const seen=[];const fetchImpl=async(url,options)=>{const u=new URL(url);seen.push({u,options});
  if(u.pathname==='/api/config')return response({oynatma:mode===undefined?{}:{mod:typeof mode==='function'?mode():mode}},200,{'set-cookie':'dd_bilet=synthetic-only; Path=/; Secure; HttpOnly'});
  if(u.pathname==='/api/series/'+detail.slug)return response(detail);
  if(u.pathname==='/play/145057/1'){if(typeof play==='function')return play(u,options);return response(play,playStatus);}
  if(u.pathname==='/hls/145057/1/playlist.m3u8')return response(legacy);
  if(u.pathname==='/api/subtitles/145057/1')return response([]);
  if(u.hostname!=='dramadunyam.com'||u.pathname.startsWith('/relay/fixture/')||u.pathname.startsWith('/vr/dr/hls/')||u.pathname.startsWith('/vr/fr/vt/'))return media(u,options);
  throw Error('Unexpected fixture source route');};
 const client=createSourceClient({fetchImpl,now,deadlineMs});const signal=new AbortController().signal;
 return {seen,client,signal,resolve:async()=>client.resolveEpisode(await client.fetchDetail(detail.slug,signal),1,signal)};
}
const requests=(f,path)=>f.seen.filter(x=>x.u.pathname===path);

test('hybrid config prefers exact issued /play identity and cookie-free direct HLS instead of legacy',async()=>{
 const f=setup(),r=await f.resolve();assert.deepEqual(r.referenceHosts,['v-mps.crazymaplestudios.com']);assert.equal(r.identity.seriesId,'145057');assert.equal(r.identity.episodeNumber,1);
 assert.equal(requests(f,'/hls/145057/1/playlist.m3u8').length,0);const play=requests(f,'/play/145057/1');assert.equal(play.length,1);assert.equal(play[0].options.headers.Cookie,'dd_bilet=synthetic-only');
 const media=f.seen.find(x=>x.u.href===direct);assert.equal(media.options.method,'GET');assert.equal(media.options.headers.Cookie,undefined);assert.equal(media.options.credentials,'omit');assert.equal(media.options.redirect,'manual');
 assert(r.manifestBody.includes('https://v-mps.crazymaplestudios.com/fixture/one.ts?fixture=exact'));assert.equal(r.receipt.requests.find(x=>x.lane==='episode-resolver').status,200);assert(!JSON.stringify(r.receipt).includes('synthetic-only'));
});

test('direct declared MP4 uses allowlisted URL plus cookie-free HEAD content proof, not historical host inference',async()=>{
 const url='https://v-mps.crazymaplestudios.com/fixture/video.mp4?fixture=exact';const f=setup({mode:'direct',play:{...envelope,type:'mp4',url},media:()=>({status:200,url,headers:new Headers({'content-type':'video/mp4'}),text(){throw Error('MP4 body must not download');}})});const r=await f.resolve();
 assert.equal(r.type,'mp4');assert.equal(r.uri,url);assert.equal(f.seen.find(x=>x.u.href===url).options.method,'HEAD');assert.equal(f.seen.find(x=>x.u.href===url).options.headers.Cookie,undefined);assert.equal(r.receipt.requests.find(x=>x.host==='v-mps.crazymaplestudios.com').bytesRead,0);
});

test('legacy and absent/null/empty modes retain original HLS route without /play',async()=>{
 for(const mode of ['legacy',null,'',()=>undefined]){const f=setup({mode});assert.deepEqual((await f.resolve()).referenceHosts,['cdn2.dramaflix.net']);assert.equal(requests(f,'/play/145057/1').length,0);}
});

test('fresh operation config mode is not cached from earlier metadata job',async()=>{
 let mode='hybrid';const f=setup({mode:()=>mode});const d=await f.client.fetchDetail(detail.slug,f.signal);mode='legacy';assert.deepEqual((await f.client.resolveEpisode(d,1,f.signal)).referenceHosts,['cdn2.dramaflix.net']);mode='hybrid';assert.deepEqual((await f.client.resolveEpisode(d,1,f.signal)).referenceHosts,['v-mps.crazymaplestudios.com']);assert.equal(requests(f,'/api/config').length,3);
});

test('explicit psig fallback is exactly one validated legacy route',async()=>{
 const f=setup({play:{delivery:'psig'}}),r=await f.resolve();assert.deepEqual(r.referenceHosts,['cdn2.dramaflix.net']);assert.equal(requests(f,'/play/145057/1').length,1);assert.equal(requests(f,'/hls/145057/1/playlist.m3u8').length,1);assert.equal(r.receipt.requests.filter(x=>x.lane==='episode-resolver').length,1);
});

test('only transient resolver statuses/network failure fall back once; 409/410 and ordinary errors stay terminal',async()=>{
 for(const playStatus of [429,500,502,503,504]){const f=setup({playStatus});assert.deepEqual((await f.resolve()).referenceHosts,['cdn2.dramaflix.net']);assert.equal(requests(f,'/play/145057/1').length,1);assert.equal(requests(f,'/hls/145057/1/playlist.m3u8').length,1);}
 const network=setup({play:()=>{throw new TypeError('Network request failed');}});assert.deepEqual((await network.resolve()).referenceHosts,['cdn2.dramaflix.net']);
 for(const playStatus of [400,401,403,404,409,410]){const f=setup({playStatus});await assert.rejects(f.resolve(),e=>e.code===`HTTP_${playStatus}`);assert.equal(requests(f,'/hls/145057/1/playlist.m3u8').length,0);assert.equal(f.seen.filter(x=>x.u.hostname!=='dramadunyam.com').length,0);}
});

test('unknown nonlegacy mode and unsupported or unsafe direct envelope fail without fallback/media fetch',async()=>{
 const mode=setup({mode:'future-unknown'});await assert.rejects(mode.resolve());assert.equal(requests(mode,'/play/145057/1').length,0);assert.equal(requests(mode,'/hls/145057/1/playlist.m3u8').length,0);
 for(const play of [null,[],{}, {...envelope,delivery:['direct']}, {...envelope,delivery:{kind:'direct'}}, {...envelope,delivery:'future-unknown'},{...envelope,type:'dash'}, {...envelope,url:''}, {...envelope,url:'http://v-mps.crazymaplestudios.com/fixture/a.m3u8'}, {...envelope,url:'https://evil.invalid/a.m3u8'}, {...envelope,url:'https://v-mps.crazymaplestudios.com.evil.invalid/a.m3u8'}, {...envelope,url:'https://user:pass@v-mps.crazymaplestudios.com/a.m3u8'}, {...envelope,url:'https://v-mps.crazymaplestudios.com:8443/a.m3u8'}, {...envelope,url:direct+'#fragment'}]){
  const f=setup({play});await assert.rejects(f.resolve());assert.equal(requests(f,'/hls/145057/1/playlist.m3u8').length,0);assert.equal(f.seen.filter(x=>x.u.hostname!=='dramadunyam.com').length,0);
 }
});

test('successful resolver with invalid JSON/content/body contract does not silently fall back',async()=>{
 for(const play of [()=>response('{bad',200,{'content-type':'application/json'}),()=>response(envelope,200,{'content-type':'text/html'}),()=>response('x'.repeat(SOURCE_CONTRACT.maxJSONBytes+1),200,{'content-type':'application/json'})]){const f=setup({play});await assert.rejects(f.resolve());assert.equal(requests(f,'/hls/145057/1/playlist.m3u8').length,0);}
});

test('direct media HTTP/content/manifest validation failure never retries obsolete legacy',async()=>{
 for(const media of [()=>response('',504),()=>response(manifest.replace('#EXTINF:','#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:'))]){const f=setup({media});await assert.rejects(f.resolve());assert.equal(requests(f,'/hls/145057/1/playlist.m3u8').length,0);}
 const f=setup({play:{...envelope,type:'mp4',url:'https://v-mps.crazymaplestudios.com/fixture/video.mp4'},media:()=>response('',200,{'content-type':'text/html'})});await assert.rejects(f.resolve(),e=>e.code==='INVALID_CONTENT_TYPE');assert.equal(requests(f,'/hls/145057/1/playlist.m3u8').length,0);
});

test('resolver abort/deadline never falls back or starts another request',async()=>{
 const f=setup({deadlineMs:20,play:()=>new Promise(()=>{})});await assert.rejects(f.resolve(),e=>e.code==='DEADLINE_EXCEEDED');assert.equal(requests(f,'/hls/145057/1/playlist.m3u8').length,0);
});

test('direct response expiry bounds prepared cache lifetime and rejects stale/invalid expiry before media',async()=>{
 const now=1700000000000;const f=setup({now:()=>now,play:{...envelope,expires_at:'2023-11-14T22:13:40Z'}});assert.equal((await f.resolve()).expiresAt,now+20000);
 for(const expires_at of ['2023-11-14T22:13:19Z','invalid',-1,1700000020,'2023-02-31T22:13:40Z',[],{}]){const bad=setup({now:()=>now,play:{...envelope,expires_at}});await assert.rejects(bad.resolve());assert.equal(bad.seen.filter(x=>x.u.hostname!=='dramadunyam.com').length,0);assert.equal(requests(bad,'/hls/145057/1/playlist.m3u8').length,0);}
});

test('direct HLS redirects retain actual final base and relative signed segment bytes without cookies',async()=>{
 const final='https://v-mps.crazymaplestudios.com/final/episode.m3u8?fixture=exact';const f=setup({media:(u)=>u.href===direct?response('',302,{location:final}):response(manifest)});const r=await f.resolve();assert(r.manifestBody.includes('https://v-mps.crazymaplestudios.com/final/one.ts?fixture=exact'));for(const x of f.seen.filter(x=>x.u.hostname!=='dramadunyam.com'))assert.equal(x.options.headers.Cookie,undefined);
});

for(const delivery of ['relay','relay_auth'])test(`known ${delivery} reuses validated issued URL without guest cookies or new auth headers`,async()=>{
 const url='https://dramadunyam.com/relay/fixture/episode.m3u8?sig=synthetic-only';const f=setup({play:{...envelope,delivery,url}});const r=await f.resolve();assert.equal(r.type,'hls');assert.deepEqual(r.referenceHosts,['dramadunyam.com']);
 const request=f.seen.find(x=>x.u.href===url);assert.equal(request.options.headers.Cookie,undefined);assert.equal(request.options.credentials,'omit');assert.equal(request.options.headers.Authorization,undefined);assert.equal(requests(f,'/hls/145057/1/playlist.m3u8').length,0);
 const unsafe=setup({play:{...envelope,delivery,url:'https://evil.invalid/fixture.m3u8'}});await assert.rejects(unsafe.resolve());assert.equal(requests(unsafe,'/hls/145057/1/playlist.m3u8').length,0);assert.equal(unsafe.seen.filter(x=>x.u.hostname!=='dramadunyam.com').length,0);
});

for(const delivery of ['relay','relay_auth'])test(`issued root-relative ${delivery} TS playlist retains the observed namespace and signed query without cookies`,async()=>{
 const path='/vr/dr/hls/11111111-1111-4111-8111-111111111111_720/main.m3u8?auth_key=synthetic-only';
 const f=setup({play:{...envelope,delivery,url:path}}),r=await f.resolve();assert.equal(r.type,'hls');assert.equal(r.transport,'app-cache-manifest-direct-https-segments');
 assert(r.manifestBody.includes('https://dramadunyam.com/vr/dr/hls/11111111-1111-4111-8111-111111111111_720/one.ts?fixture=exact'));
 const request=f.seen.find(x=>x.u.href==='https://dramadunyam.com'+path);assert(request);assert.equal(request.options.method,'GET');assert.equal(request.options.headers.Cookie,undefined);assert.equal(request.options.credentials,'omit');assert.equal(request.options.redirect,'manual');assert.equal(request.options.headers.Authorization,undefined);
 assert.equal(requests(f,'/hls/145057/1/playlist.m3u8').length,0);assert.equal(requests(f,'/play/145057/1').length,1);
});

test('issued root-relative relay separate-audio master retains validated video and audio playlists and fragments',async()=>{
 const base='/vr/fr/vt/11111111-1111-4111-8111-111111111111/',path=base+'h264-22222222-2222-4222-8222-222222222222.m3u8';
 const master='#EXTM3U\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8",GROUP-ID="a",NAME="en"\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=720x1280,AUDIO="a"\nvideo.m3u8\n';
 const child='#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:5,\nfragment.mp4\n#EXT-X-ENDLIST\n';
 const f=setup({play:{...envelope,delivery:'relay',url:path},media:u=>response(u.pathname===path?master:child)}),r=await f.resolve();
 assert.equal(r.type,'hls');assert.equal(r.transport,'app-cache-master-direct-https-playlists-and-segments');assert.equal(r.referenceCount,4);assert.deepEqual(r.referenceHosts,['dramadunyam.com']);
 assert(r.manifestBody.includes('URI="https://dramadunyam.com'+base+'audio.m3u8"'));assert(r.manifestBody.endsWith('https://dramadunyam.com'+base+'video.m3u8\n'));
 for(const name of [path,base+'video.m3u8',base+'audio.m3u8']){const request=f.seen.find(x=>x.u.pathname===name);assert(request);assert.equal(request.options.headers.Cookie,undefined);assert.equal(request.options.credentials,'omit');assert.equal(request.options.redirect,'manual');}
 assert.equal(requests(f,'/hls/145057/1/playlist.m3u8').length,0);
});

test('relative resolver compatibility never accepts other namespaces, traversal, protocol-relative, direct or MP4 envelopes',async()=>{
 const path='/vr/dr/hls/fixture/main.m3u8';
 const paths=['//dramadunyam.com'+path,'vr/dr/hls/fixture/main.m3u8','///vr/dr/hls/fixture/main.m3u8','/vr/dr/hls/fixture\\main.m3u8','/vr/dr/hls/fixture/../main.m3u8','/vr/dr/hls/%2e%2e/main.m3u8','/vr/fr/vt/fixture/%2F..%2Fmain.m3u8','/hls/145057/1/playlist.m3u8','/vr/fr/other/fixture/main.m3u8','/vr/dr/hls/fixture/main.mp4',path+'#fragment',path+'?auth_key=bad\\query','//user:pass@dramadunyam.com'+path,'//dramadunyam.com:8443'+path];
 for(const play of [...paths.map(url=>({...envelope,delivery:'relay',url})),{...envelope,url:path},{...envelope,delivery:'relay',type:'mp4',url:path}]){
  const f=setup({play});await assert.rejects(f.resolve(),e=>e.code==='INVALID_EPISODE_RESOLVER');assert.equal(requests(f,'/hls/145057/1/playlist.m3u8').length,0);assert.equal(f.seen.filter(x=>x.u.pathname.startsWith('/vr/')).length,0);
 }
});

// Regression: Little Chef E1 is issued as a direct PineDrama MP4 on this exact CDN.
test('issued Little Chef PineDrama v58e MP4 reaches cookie-free HEAD without a legacy fallback',async()=>{
 const url='https://v58e.tiktokcdn.com/fixture/video?mime_type=video_mp4&fixture=exact';
 const f=setup({play:{...envelope,type:'mp4',url},media:()=>({status:200,url,headers:new Headers({'content-type':'video/mp4'}),text(){throw Error('No MP4 body download');}})});
 const r=await f.resolve();assert.equal(r.type,'mp4');assert.equal(r.uri,url);
 assert.equal(requests(f,'/hls/145057/1/playlist.m3u8').length,0);assert.equal(requests(f,'/play/145057/1').length,1);
 const req=f.seen.find(x=>x.u.href===url);assert.equal(req.options.method,'HEAD');assert.equal(req.options.headers.Cookie,undefined);assert.equal(req.options.headers.Authorization,undefined);assert.equal(r.receipt.requests.find(x=>x.host==='v58e.tiktokcdn.com').bytesRead,0);
});
