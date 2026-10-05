import {sha256,utf8} from '../sha256.ts';
import {SourceError,type SourceFailureCode,type DramaPlatform,type DramaPlatformDirectory,type DramaCard,type DramaDetail,type Episode,type SourcePage,type DramaHome,type SourceReceipt,type SourceRequestReceipt,type ResolvedEpisode,type SubtitleCue,type CatalogueOptions,type SearchOptions} from './types.ts';
export * from './types.ts';

export const SOURCE_CONTRACT=Object.freeze({origin:'https://dramadunyam.com',language:'en',maxConcurrency:2,deadlineMs:15000,maxJSONBytes:524288,maxManifestBytes:131072,maxSubtitleBytes:262144,cacheTTLms:120000,cacheEntries:48,mediaHosts:Object.freeze(['cdn2.dramaflix.net','cdn.dramaflix.net','dramadunyam.com','v-mps.crazymaplestudios.com','ns-aws-cdn.netshort.com','hwztakavideoto.dramaboxdb.com','v45e-eu.tiktokcdn.com','v77e.tiktokcdn.com','v19e.tiktokcdn.com','v16me.tiktokcdn.com']),requestProfile:'observed-desktop-UA'} as const);
const BASE=SOURCE_CONTRACT.origin;
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';
const LANGUAGE_NOTE='English-localized catalogue metadata, not verified spoken language or all-episode English subtitle proof. Original audio with English captions is allowed; playback is rechecked per episode.';
const EPISODE_NOTE='Ordinal derived from advertised source counts, not a provider chapter ID or successful playback guarantee.';
const proven=Object.freeze([
 {id:'154805',slug:'eternal-illumination',platform:'MeloShort'},
 {id:'148667',slug:'dubbed-love-lies-and-lost-redemption',platform:'ShortMax'},
 {id:'147444',slug:'modern-journey-of-an-ancient-queen-flickreels-en',platform:'FlickReels'},
 {id:'117774',slug:'dubbedborn-again-payback-time',platform:'FlexTV'},
]);
const nonEnglish=Object.freeze([{id:'152742',platform:'NetShort'},{id:'149757',platform:'DramaBox'}]);
function fail(code:SourceFailureCode):never {throw new SourceError(code);}
function obj(v:unknown,code:SourceFailureCode):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))fail(code);return v as Record<string,unknown>;}
function str(v:unknown,max:number,code:SourceFailureCode):string {if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f\u007f]/.test(v))fail(code);return v.trim();}
function count(v:unknown,max=1000000,code:SourceFailureCode='INVALID_CARD'):number {if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>max)fail(code);return v;}
export function parseSeriesId(v:unknown):string {const s=typeof v==='number'&&Number.isSafeInteger(v)?String(v):v;if(typeof s!=='string'||!/^\d{1,10}$/.test(s)||Number(s)<=0)fail('INVALID_CARD');return s;}
export function parseSlug(v:unknown):string {const s=str(v,240,'INVALID_CARD');if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(s))fail('INVALID_CARD');return s;}
export function parseEpisode(v:unknown):number {if(typeof v==='string'&&/^[1-9]\d{0,3}$/.test(v))v=Number(v);if(typeof v!=='number'||!Number.isSafeInteger(v)||v<1||v>5000)fail('INVALID_EPISODE');return v;}
function image(v:unknown):string|null {if(v===null||v===undefined||v==='')return null;if(typeof v!=='string'||v.length>1024)return null;try{const u=new URL(v,BASE),legacy=u.origin===BASE&&/^\/(?:covers|logos)\/[a-zA-Z0-9_.-]+\.(?:webp|jpg|jpeg|png|svg)$/i.test(u.pathname),cdn=u.origin==='https://dramaflix.net'&&/^\/dfl-media\/(?:img\/covers\/[a-f0-9]{16}\/480\.webp|logos\/[a-zA-Z0-9_.-]+\.(?:webp|png|svg))$/.test(u.pathname);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search||!legacy&&!cdn)return null;return u.href;}catch{return null;}}
export function parsePlatforms(value:unknown):readonly DramaPlatform[] {
 if(!Array.isArray(value)||value.length>128)fail('INVALID_PLATFORM');const seen=new Set<string>();
 return Object.freeze(value.map(v=>{const p=obj(v,'INVALID_PLATFORM'),name=str(p.name,80,'INVALID_PLATFORM');if(seen.has(name)||/[/?#\\]/.test(name))fail('INVALID_PLATFORM');seen.add(name);return Object.freeze({name,logo:image(p.logo),count:count(p.count,1000000,'INVALID_PLATFORM')});}));
}
export function parseCard(value:unknown):DramaCard {
 const v=obj(value,'INVALID_CARD'),id=parseSeriesId(v.id),slug=parseSlug(v.slug),title=str(v.title,240,'INVALID_CARD'),platform=str(v.platform,80,'INVALID_CARD');
 if(/[/?#\\]/.test(platform)||v.language!==undefined&&v.language!=='en')fail('INVALID_CARD');const totalEpisodes=count(v.total_episodes,5000),availableEpisodes=count(v.available_episodes,5000);
 const sampled=proven.some(x=>x.id===id&&x.slug===slug&&x.platform===platform),knownNonEnglish=nonEnglish.some(x=>x.id===id&&x.platform===platform);
 const audioEvidence=sampled?'sampled-english':knownNonEnglish?'sampled-non-english':/dubbed|dublaj/i.test(title)?'dubbed-label-unverified':'unknown';
 return Object.freeze({id,slug,title,platform,cover:image(v.cover),totalEpisodes,availableEpisodes,catalogueLanguage:'en',audioEvidence,countWarning:availableEpisodes>totalEpisodes?'Source counts disagree; detail availability must be validated before playback.':null,languageQualification:sampled?'Prior bounded E16/E20 English audio inference and visible English captions, not whole-series certification.':knownNonEnglish?'Prior bounded clips used non-English audio; English subtitles may still be available and must be checked per episode.':LANGUAGE_NOTE,isNew:v.is_new===true,isPopular:v.is_popular===true});
}
export function parseDetail(value:unknown,expected?:Pick<DramaCard,'id'|'slug'|'platform'>|string):DramaDetail {
 const v=obj(value,'INVALID_DETAIL');if(v.language!=='en')fail('INVALID_DETAIL');const card=parseCard(v);if(card.availableEpisodes>card.totalEpisodes)fail('INVALID_DETAIL');
 if(typeof expected==='string'&&card.slug!==expected||expected&&typeof expected==='object'&&(card.id!==expected.id||card.slug!==expected.slug||card.platform!==expected.platform))fail('DETAIL_IDENTITY_MISMATCH');
 const episodesInDB=count(v.episodes_in_db,5000,'INVALID_DETAIL');if(episodesInDB>card.totalEpisodes)fail('INVALID_DETAIL');
 const description=typeof v.description==='string'?v.description.trim().slice(0,12000):'';
 const upper=Math.min(card.availableEpisodes,episodesInDB),episodes:Episode[]=Array.from({length:card.totalEpisodes},(_,i)=>Object.freeze({number:i+1,advertisedAvailable:i+1<=upper,qualification:EPISODE_NOTE}));
 const mode=v.metin&&typeof v.metin==='object'&&!Array.isArray(v.metin)?(v.metin as Record<string,unknown>).dil:null;
 return Object.freeze({...card,description,episodesInDB,episodes:Object.freeze(episodes),sourceDeclaredLanguage:'en',sourceDeclaredMode:typeof mode==='string'?mode.slice(0,160):null,subtitleEvidence:card.audioEvidence==='sampled-english'?'prior-sampled-english-captions':'unverified',sampledEnglishEpisodes:Object.freeze(card.audioEvidence==='sampled-english'?[16,20]:[]),receipt:null,cached:false});
}
export function parsePage(value:unknown,receipt:SourceReceipt,cached=false,expectedPlatform?:string):SourcePage {
 const v=obj(value,'INVALID_PAGE');if(!Array.isArray(v.data)||v.data.length>80)fail('INVALID_PAGE');const items=v.data.map(parseCard);if(expectedPlatform&&items.some(x=>x.platform!==expectedPlatform))fail('INVALID_PAGE');
 const total=count(v.total,1000000,'INVALID_PAGE'),page=count(v.page,100000,'INVALID_PAGE'),pages=count(v.pages,100000,'INVALID_PAGE'),limit=count(v.limit,80,'INVALID_PAGE');if(page<1||limit<1||total===0&&items.length!==0||pages>0&&page>pages||items.length>limit)fail('INVALID_PAGE');
 if(new Set(items.map(x=>x.id+'|'+x.slug)).size!==items.length)fail('INVALID_PAGE');return Object.freeze({items:Object.freeze(items),total,page,pages,limit,receipt,cached});
}
export function parseHome(value:unknown,receipt:SourceReceipt,cached=false):DramaHome {
 const v=obj(value,'INVALID_HOME');if(!Array.isArray(v.hero)||v.hero.length>40||!Array.isArray(v.rows)||v.rows.length>40)fail('INVALID_HOME');
 const rows=v.rows.map(x=>{const r=obj(x,'INVALID_HOME');if(!Array.isArray(r.items)||r.items.length>80)fail('INVALID_HOME');return Object.freeze({key:str(r.key,120,'INVALID_HOME'),title:str(r.title,240,'INVALID_HOME'),total:count(r.total,1000000,'INVALID_HOME'),items:Object.freeze(r.items.map(parseCard))});});
 return Object.freeze({hero:Object.freeze(v.hero.map(parseCard)),rows:Object.freeze(rows),platforms:parsePlatforms(v.platforms),receipt,cached});
}
function mediaURL(value:string,base:string=BASE):URL {let u:URL;try{u=new URL(value,base);}catch{fail('REDIRECT_REJECTED');}if(value.length>16384||u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!(SOURCE_CONTRACT.mediaHosts as readonly string[]).includes(u.hostname))fail('REDIRECT_REJECTED');return u;}
function hlsVariant(text:string,base:string):{url:string;attributes:string;audioTag:string|null;audioURL:string|null}|null {
 if(!text.includes('#EXT-X-STREAM-INF:'))return null;
 if(!text.trimStart().startsWith('#EXTM3U')||/#EXT-X-(?:KEY|SESSION-KEY|MAP):|\bSUBTITLES=/.test(text))fail('UNSUPPORTED_MANIFEST');
 const lines=text.split(/\r?\n/).map(x=>x.trim()),audio=lines.filter(x=>x.startsWith('#EXT-X-MEDIA:')),variants:{url:string;size:number;bandwidth:number;attributes:string}[]=[];
 if(audio.length>1)fail('UNSUPPORTED_MANIFEST');const audioTag=audio[0]??null,audioPath=audioTag?/\bURI="([^"]+)"/.exec(audioTag)?.[1]:null,audioGroup=audioTag?/\bGROUP-ID="([A-Za-z0-9_-]+)"/.exec(audioTag)?.[1]:null;
 if(audioTag&&(!audioPath||!audioGroup||!audioTag.startsWith('#EXT-X-MEDIA:TYPE=AUDIO,')))fail('UNSUPPORTED_MANIFEST');const audioURL=audioPath?mediaURL(audioPath,base).href:null;
 if(audioURL&&!new URL(audioURL).pathname.endsWith('.m3u8'))fail('INVALID_MANIFEST');
 for(let i=0;i<lines.length;i++)if(lines[i].startsWith('#EXT-X-STREAM-INF:')){const attributes=lines[i],path=lines[++i],u=mediaURL(path??'',base),dimensions=/\bRESOLUTION=(\d+)x(\d+)(?:,|$)/.exec(attributes),width=Number(dimensions?.[1]),height=Number(dimensions?.[2]),group=/\bAUDIO="([^"]+)"/.exec(attributes)?.[1];if(!path||path.startsWith('#')||!u.pathname.endsWith('.m3u8')||variants.length>=32||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||group!==(audioGroup??undefined))fail('INVALID_MANIFEST');const bandwidth=Number(/\bBANDWIDTH=(\d+)/.exec(attributes)?.[1]??0);if(!Number.isSafeInteger(bandwidth))fail('INVALID_MANIFEST');variants.push({url:u.href,size:Math.min(width,height),bandwidth,attributes});}
 const selected=variants.filter(x=>x.size<=1080).sort((a,b)=>b.size-a.size||b.bandwidth-a.bandwidth)[0];if(!selected)fail('UNSUPPORTED_MANIFEST');return {...selected,audioTag,audioURL};
}
export function prepareManifest(text:string,manifestPath:string,now=Date.now()):Readonly<{body:string;bodySHA256:string;referenceHosts:readonly string[];referenceCount:number;expiresAt:number}> {
 const base=mediaURL(manifestPath);if(typeof text!=='string'||utf8(text).length>SOURCE_CONTRACT.maxManifestBytes||!text.trimStart().startsWith('#EXTM3U')||!text.includes('#EXT-X-ENDLIST')||!base.pathname.endsWith('.m3u8'))fail('INVALID_MANIFEST');
 // Unencrypted finite TS, plus the observed public /vr/fr/vt/ fMP4 namespace.
 const fragmented=base.origin===BASE&&base.pathname.startsWith('/vr/fr/vt/');
 if(/#EXT-X-(?:KEY|SESSION-KEY|STREAM-INF|MEDIA):/.test(text)||!fragmented&&/#EXT-X-MAP:|\bURI=/.test(text))fail('UNSUPPORTED_MANIFEST');
 const hosts=new Set<string>(),expires:number[]=[];let n=0;
 const reference=(raw:string)=>{if(++n>1000)fail('INVALID_MANIFEST');let u:URL;try{u=new URL(raw,base.href);}catch{fail('UNSAFE_MEDIA_REFERENCE');}
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!(SOURCE_CONTRACT.mediaHosts as readonly string[]).includes(u.hostname)||!(u.pathname.endsWith('.ts')||fragmented&&u.origin===BASE&&u.pathname.startsWith('/vr/fr/vt/')&&u.pathname.endsWith('.mp4')))fail('UNSAFE_MEDIA_REFERENCE');hosts.add(u.hostname);const p=u.searchParams.get('pexp');if(p&&/^\d{10}$/.test(p))expires.push(Number(p)*1000);return u.href;};
 const body=text.split(/\r?\n/).map(line=>{const raw=line.trim();if(raw.startsWith('#EXT-X-MAP:')){const map=/^#EXT-X-MAP:URI="([^"]+)"(?:,BYTERANGE="\d+(?:@\d+)?")?$/.exec(raw);if(!fragmented||!map)fail('UNSUPPORTED_MANIFEST');return raw.replace(map[1],reference(map[1]));}if(/\bURI=/.test(raw))fail('UNSUPPORTED_MANIFEST');if(!raw||raw.startsWith('#'))return line;return reference(raw);
 }).join('\n');if(n===0)fail('INVALID_MANIFEST');const expiresAt=Math.min(now+300000,...expires);if(expiresAt<=now)fail('INVALID_MANIFEST');
 return Object.freeze({body,bodySHA256:sha256(body),referenceHosts:Object.freeze([...hosts].sort()),referenceCount:n,expiresAt});
}
export function englishSubtitleLanguage(value:unknown):string|null {if(!Array.isArray(value)||value.length>64)fail('INVALID_SUBTITLE');if(!value.every(v=>typeof v==='string'&&/^[A-Za-z][A-Za-z_-]{0,31}$/.test(v)))fail('INVALID_SUBTITLE');return (value as string[]).find(v=>/^(?:en(?:[-_]us|[-_]gb)?|eng|english)$/i.test(v))??null;}
function cueTime(value:string):number {const m=/^(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(value);if(!m)return NaN;const h=Number(m[1]??0),min=Number(m[2]),s=Number(m[3]);return min<60&&s<60?h*3600+min*60+s+Number(m[4])/1000:NaN;}
export function parseEnglishVTT(text:string):readonly SubtitleCue[] {
 if(utf8(text).length>SOURCE_CONTRACT.maxSubtitleBytes||!text.trimStart().startsWith('WEBVTT'))fail('INVALID_SUBTITLE');const cues:SubtitleCue[]=[];
 for(const block of text.replace(/\r/g,'').split(/\n\s*\n/)){const lines=block.split('\n'),i=lines.findIndex(l=>l.includes(' --> '));if(i<0)continue;const [startRaw,endRaw]=lines[i].split(' --> '),start=cueTime(startRaw.trim()),end=cueTime(endRaw.trim().split(/\s/)[0]);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>86400)fail('INVALID_SUBTITLE');const cue=lines.slice(i+1).join('\n').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'').trim();
  if(cue.length>1000||cues.length>=1000)fail('INVALID_SUBTITLE');if(cue)cues.push(Object.freeze({start,end,text:cue}));
 }return Object.freeze(cues);
}

type Fetcher=typeof fetch;
type Options=Readonly<{fetchImpl?:Fetcher;now?:()=>number;deadlineMs?:number}>;
type Context={signal:AbortSignal;requests:SourceRequestReceipt[];cookie:string|null;requestId:string;cacheEpoch:number;playbackMode:unknown};
function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{if(signal.aborted)return Promise.reject(new SourceError('ABORTED'));return new Promise((resolve,reject)=>{const cancel=()=>{signal.removeEventListener('abort',cancel);reject(new SourceError('ABORTED'));};signal.addEventListener('abort',cancel,{once:true});promise.then(v=>{signal.removeEventListener('abort',cancel);resolve(v);},e=>{signal.removeEventListener('abort',cancel);reject(e);});});}
export function createSourceClient(options:Options={}){
 const getFetch=()=>options.fetchImpl??fetch,now=options.now??Date.now,cache=new Map<string,{time:number;value:unknown}>(),issuedDetails=new WeakSet<object>();let requestSequence=0,active=0,cacheEpoch=0;
 const waiters:{signal:AbortSignal;resolve:()=>void;reject:(e:unknown)=>void;cancel:()=>void}[]=[];
 async function acquire(signal:AbortSignal){if(signal.aborted)fail('ABORTED');if(active<2){active++;return;}await new Promise<void>((resolve,reject)=>{const waiter={signal,resolve:()=>{signal.removeEventListener('abort',waiter.cancel);active++;resolve();},reject,cancel:()=>{const i=waiters.indexOf(waiter);if(i>=0)waiters.splice(i,1);reject(new SourceError('ABORTED'));}};waiters.push(waiter);signal.addEventListener('abort',waiter.cancel,{once:true});});}
 function release(){active--;while(waiters.length){const w=waiters.shift()!;if(!w.signal.aborted){w.resolve();break;}}}
 function cached(key:string):unknown|null {const c=cache.get(key);if(!c)return null;if(now()-c.time>SOURCE_CONTRACT.cacheTTLms){cache.delete(key);return null;}cache.delete(key);cache.set(key,c);return c.value;}
 function put(key:string,value:unknown,epoch:number){if(epoch!==cacheEpoch)return;cache.set(key,{time:now(),value});while(cache.size>SOURCE_CONTRACT.cacheEntries)cache.delete(cache.keys().next().value!);}
 const receipt=(ctx:Context,cached=false):SourceReceipt=>Object.freeze({requestId:ctx.requestId,requestProfile:'observed-desktop-UA',requests:Object.freeze([...ctx.requests]),freshGuestSessionReceived:!!ctx.cookie,cached});
 async function get(ctx:Context,path:string,lane:SourceRequestReceipt['lane'],max:number=SOURCE_CONTRACT.maxJSONBytes,json=true){
  const u=new URL(path,BASE);if(u.origin!==BASE||u.username||u.password||u.hash)fail('REDIRECT_REJECTED');
  const r=await abortable(getFetch()(u.href,{method:'GET',signal:ctx.signal,credentials:'omit',redirect:'error',headers:{'User-Agent':UA,'Cache-Control':'no-cache',Accept:json?'application/json':'*/*',...(ctx.cookie?{Cookie:ctx.cookie}:{})}}),ctx.signal);
  if(r.url&&new URL(r.url).origin!==BASE)fail('REDIRECT_REJECTED');const text=await abortable(r.text(),ctx.signal),bytesRead=utf8(text).length;
  ctx.requests.push(Object.freeze({lane,host:'dramadunyam.com',pathSHA256:sha256(u.pathname),status:r.status,bytesRead,bodySHA256:sha256(text)}));
  if(bytesRead>max)fail('BODY_LIMIT');if(r.status!==200)fail(`HTTP_${r.status}`);if(json&&!r.headers.get('content-type')?.includes('json'))fail('INVALID_CONTENT_TYPE');
  if(lane==='guest-config'){const h=r.headers.get('set-cookie')??'',m=/(?:^|,\s*)(dd_bilet=[^;,\r\n]{1,8192})(?=;|,|$)/.exec(h);if(!m)fail('FRESH_GUEST_SESSION_MISSING');ctx.cookie=m[1];}
  if(!json)return text;try{return JSON.parse(text) as unknown;}catch{fail('INVALID_JSON');}
 }
 async function rangeMP4(ctx:Context,u:URL):Promise<void>{
  const ctl=new AbortController(),abort=()=>ctl.abort();ctx.signal.addEventListener('abort',abort,{once:true});if(ctx.signal.aborted)abort();let reader:ReadableStreamDefaultReader<Uint8Array>|null=null;
  try{const r=await abortable(getFetch()(u.href,{method:'GET',signal:ctl.signal,credentials:'omit',redirect:'manual',headers:{'User-Agent':UA,'Cache-Control':'no-cache',Accept:'*/*',Range:'bytes=0-1'}}),ctx.signal);
   if(r.url&&r.url!==u.href)fail('REDIRECT_REJECTED');if(r.status!==206)fail(`HTTP_${r.status}`);if(!r.headers.get('content-type')?.toLowerCase().startsWith('video/mp4'))fail('INVALID_CONTENT_TYPE');
   const range=/^bytes 0-1\/([1-9]\d*)$/.exec(r.headers.get('content-range')??''),total=Number(range?.[1]),length=r.headers.get('content-length');if(!range||!Number.isSafeInteger(total)||total<2||length!==null&&length!=='2')fail('INVALID_CONTENT_TYPE');
   if(!r.body?.getReader)fail('INVALID_CONTENT_TYPE');reader=r.body.getReader();const bytes=new Uint8Array(2);let count=0;
   while(true){const part=await abortable(reader.read(),ctx.signal);if(part.done)break;if(count+part.value.length>2)fail('BODY_LIMIT');bytes.set(part.value,count);count+=part.value.length;}
   if(count!==2)fail('INVALID_CONTENT_TYPE');ctx.requests.push(Object.freeze({lane:'manifest',host:u.hostname,pathSHA256:sha256(u.pathname),status:r.status,bytesRead:count,bodySHA256:''}));
  }finally{ctl.abort();if(reader)void reader.cancel().catch(()=>{});ctx.signal.removeEventListener('abort',abort);}
 }
 async function media(ctx:Context,path:string,includeCookie=true,expectedType?:'hls'|'mp4'):Promise<{type:'hls';url:string;text:string}|{type:'mp4';uri:string}>{
  let u=mediaURL(path);const visited=new Set<string>();
  for(let hops=0;hops<=3;hops++){
   if(visited.has(u.href))fail('REDIRECT_REJECTED');visited.add(u.href);
   const mp4=expectedType==='mp4'||(u.hostname==='ns-aws-cdn.netshort.com'||u.hostname.endsWith('.tiktokcdn.com'))&&u.searchParams.get('mime_type')==='video_mp4'||u.hostname==='hwztakavideoto.dramaboxdb.com'&&u.pathname.endsWith('.mp4');
   if(expectedType==='hls'&&mp4)fail('INVALID_EPISODE_RESOLVER');
   if(!mp4&&!u.pathname.endsWith('.m3u8'))fail('REDIRECT_REJECTED');
   const r=await abortable(getFetch()(u.href,{method:mp4?'HEAD':'GET',signal:ctx.signal,credentials:'omit',redirect:'manual',headers:{'User-Agent':UA,'Cache-Control':'no-cache',Accept:'*/*',...(includeCookie&&u.origin===BASE&&ctx.cookie?{Cookie:ctx.cookie}:{})}}),ctx.signal);
   if(r.url&&r.url!==u.href)fail('REDIRECT_REJECTED');
   const text=mp4?'':await abortable(r.text(),ctx.signal),bytesRead=utf8(text).length;
   ctx.requests.push(Object.freeze({lane:'manifest',host:u.hostname,pathSHA256:sha256(u.pathname),status:r.status,bytesRead,bodySHA256:sha256(text)}));
   if(bytesRead>SOURCE_CONTRACT.maxManifestBytes)fail('BODY_LIMIT');
   if([301,302,303,307,308].includes(r.status)){const location=r.headers.get('location');if(!location||hops===3)fail('REDIRECT_REJECTED');u=mediaURL(location,u.href);continue;}
   if(mp4&&u.hostname.endsWith('.tiktokcdn.com')&&r.status===503){await rangeMP4(ctx,u);return {type:'mp4',uri:u.href};}
   if(r.status!==200)fail(`HTTP_${r.status}`);
   if(mp4){if(!r.headers.get('content-type')?.toLowerCase().startsWith('video/mp4'))fail('INVALID_CONTENT_TYPE');return {type:'mp4',uri:u.href};}
   return {type:'hls',url:u.href,text};
  }fail('REDIRECT_REJECTED');
 }
 async function episodeRoute(ctx:Context,id:string,episodeNumber:number):Promise<{url:string;includeCookie:boolean;type?:'hls'|'mp4';expiresAt:number}>{
  const legacy={url:'/hls/'+id+'/'+episodeNumber+'/playlist.m3u8',includeCookie:true,expiresAt:now()+300000};
  if(ctx.playbackMode==='legacy'||ctx.playbackMode===null||ctx.playbackMode==='')return legacy;
  if(ctx.playbackMode!=='hybrid'&&ctx.playbackMode!=='direct')fail('INVALID_EPISODE_RESOLVER');
  let value:unknown;
  try{value=await get(ctx,'/play/'+id+'/'+episodeNumber,'episode-resolver');}
  catch(e){
   // One ordinary legacy fallback only for resolver transport failure, never a
   // malformed envelope, missing episode, or failed direct-media validation.
   if(ctx.signal.aborted)throw e;
   if(e instanceof SourceError&&/^HTTP_(?:429|5\d\d)$/.test(e.code)||e instanceof TypeError)return legacy;
   throw e;
  }
  const resolved=obj(value,'INVALID_EPISODE_RESOLVER');if(resolved.delivery==='psig')return legacy;
  if(typeof resolved.delivery!=='string'||!['direct','relay','relay_auth'].includes(resolved.delivery)||resolved.type!=='hls'&&resolved.type!=='mp4')fail('INVALID_EPISODE_RESOLVER');
  const issued=str(resolved.url,16384,'INVALID_EPISODE_RESOLVER'),relative=(resolved.delivery==='relay'||resolved.delivery==='relay_auth')&&resolved.type==='hls'&&/^\/vr\/(?:dr\/hls|fr\/vt)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.m3u8(?:\?[^#\\]*)?$/.test(issued);
  if(!issued.startsWith('https://')&&!relative)fail('INVALID_EPISODE_RESOLVER');const url=relative?new URL(issued,BASE).href:issued;mediaURL(url);
  let expiresAt=legacy.expiresAt;
  if(resolved.expires_at!==null&&resolved.expires_at!==undefined){
   const expiry=str(resolved.expires_at,24,'INVALID_EPISODE_RESOLVER');
   if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(expiry))fail('INVALID_EPISODE_RESOLVER');
   const milliseconds=Date.parse(expiry);if(!Number.isFinite(milliseconds)||new Date(milliseconds).toISOString().replace('.000Z','Z')!==expiry)fail('INVALID_EPISODE_RESOLVER');
   expiresAt=Math.min(expiresAt,milliseconds);if(expiresAt<=now())fail('INVALID_EPISODE_RESOLVER');
  }
  return {url,includeCookie:false,type:resolved.type,expiresAt};
 }
 async function job<T>(caller:AbortSignal,work:(ctx:Context)=>Promise<T>):Promise<T>{
  if(caller.aborted)fail('ABORTED');const ctl=new AbortController();let timedOut=false,acquired=false;const abort=()=>ctl.abort(),timer=setTimeout(()=>{timedOut=true;ctl.abort();},options.deadlineMs??SOURCE_CONTRACT.deadlineMs);caller.addEventListener('abort',abort,{once:true});const ctx:Context={signal:ctl.signal,requests:[],cookie:null,requestId:'source-'+now().toString(36)+'-'+(++requestSequence),cacheEpoch,playbackMode:'legacy'};
  try{await acquire(ctl.signal);acquired=true;const config=await get(ctx,'/api/config?lang=en','guest-config',131072);
   const playback=config&&typeof config==='object'&&!Array.isArray(config)?(config as Record<string,unknown>).oynatma:undefined;
   ctx.playbackMode=playback&&typeof playback==='object'&&!Array.isArray(playback)?(playback as Record<string,unknown>).mod??'legacy':playback??'legacy';
   const result=await work(ctx);if(ctl.signal.aborted)fail('ABORTED');return result;}
  catch(e){const code=caller.aborted?'ABORTED':timedOut?'DEADLINE_EXCEEDED':e instanceof SourceError?e.code:'NETWORK_ERROR';throw new SourceError(code,receipt(ctx));}
  finally{clearTimeout(timer);caller.removeEventListener('abort',abort);ctx.cookie=null;if(acquired)release();}
 }
 async function fetchPlatformDirectory(signal:AbortSignal):Promise<DramaPlatformDirectory>{if(signal.aborted)fail('ABORTED');const c=cached('platforms') as DramaPlatformDirectory|null;if(c)return Object.freeze({...c,cached:true,receipt:Object.freeze({...c.receipt,cached:true})});return job(signal,async ctx=>{const platforms=parsePlatforms(await get(ctx,'/api/platforms?lang=en','platforms'));const p=Object.freeze({platforms,receipt:receipt(ctx),cached:false});put('platforms',p,ctx.cacheEpoch);return p;});}
 async function fetchPlatforms(signal:AbortSignal):Promise<readonly DramaPlatform[]>{return(await fetchPlatformDirectory(signal)).platforms;}
 async function fetchCatalogue(opts:CatalogueOptions={},signal:AbortSignal):Promise<SourcePage>{
  if(signal.aborted)fail('ABORTED');const page=opts.page??1;if(!Number.isSafeInteger(page)||page<1||page>100000)fail('INVALID_PAGE');const platform=opts.platform;
  if(platform!==undefined){const platforms=await fetchPlatforms(signal);if(!platforms.some(p=>p.name===platform))fail('INVALID_PLATFORM');}
  const query=new URLSearchParams({page:String(page),limit:'40',sort:'yeni',...(platform?{platform}:{}),lang:'en'}),key='catalogue:'+query,c=cached(key) as SourcePage|null;if(c)return Object.freeze({...c,cached:true,receipt:Object.freeze({...c.receipt,cached:true})});
  return job(signal,async ctx=>{const p=parsePage(await get(ctx,'/api/series?'+query,'catalogue'),receipt(ctx),false,platform);put(key,p,ctx.cacheEpoch);return p;});
 }
 async function searchCatalogue(query:string,opts:SearchOptions={},signal:AbortSignal):Promise<SourcePage>{
  if(typeof query!=='string'||query.trim().length<2||query.length>100||/[\u0000-\u001f\u007f]/.test(query))fail('INVALID_SEARCH');const page=opts.page??1;if(!Number.isSafeInteger(page)||page<1||page>100000)fail('INVALID_PAGE');if(signal.aborted)fail('ABORTED');
  const q=new URLSearchParams({q:query.trim(),page:String(page),limit:'36',lang:'en'}),key='search:'+q,c=cached(key) as SourcePage|null;if(c)return Object.freeze({...c,cached:true,receipt:Object.freeze({...c.receipt,cached:true})});
  return job(signal,async ctx=>{const p=parsePage(await get(ctx,'/api/search?'+q,'search'),receipt(ctx));put(key,p,ctx.cacheEpoch);return p;});
 }
 async function fetchHome(signal:AbortSignal):Promise<DramaHome>{if(signal.aborted)fail('ABORTED');const c=cached('home') as DramaHome|null;if(c)return Object.freeze({...c,cached:true,receipt:Object.freeze({...c.receipt,cached:true})});return job(signal,async ctx=>{const h=parseHome(await get(ctx,'/api/home?lang=en','home'),receipt(ctx));put('home',h,ctx.cacheEpoch);return h;});}
 async function fetchDetail(cardOrSlug:DramaCard|string,signal:AbortSignal):Promise<DramaDetail>{
  if(typeof cardOrSlug!=='string')obj(cardOrSlug,'INVALID_CARD');const slug=parseSlug(typeof cardOrSlug==='string'?cardOrSlug:cardOrSlug.slug);if(signal.aborted)fail('ABORTED');const c=cached('detail:'+slug);if(c){const detail=c as DramaDetail;if(typeof cardOrSlug!=='string'&&(detail.id!==cardOrSlug.id||detail.platform!==cardOrSlug.platform))fail('DETAIL_IDENTITY_MISMATCH');const d=Object.freeze({...detail,cached:true,receipt:detail.receipt?Object.freeze({...detail.receipt,cached:true}):null});issuedDetails.add(d);return d;}
  return job(signal,async ctx=>{const parsed=parseDetail(await get(ctx,'/api/series/'+encodeURIComponent(slug)+'?lang=en','detail'),cardOrSlug),d=Object.freeze({...parsed,receipt:receipt(ctx)});issuedDetails.add(d);put('detail:'+slug,d,ctx.cacheEpoch);return d;});
 }
 async function resolveEpisode(detail:DramaDetail,episodeValue:unknown,signal:AbortSignal):Promise<ResolvedEpisode>{
  if(!detail||!issuedDetails.has(detail))fail('DETAIL_NOT_ISSUED');const episodeNumber=parseEpisode(episodeValue);if(episodeNumber>Math.min(detail.totalEpisodes,detail.availableEpisodes,detail.episodesInDB))fail('EPISODE_NOT_ADVERTISED');
  return job(signal,async ctx=>{const route=await episodeRoute(ctx,detail.id,episodeNumber);let result=await media(ctx,route.url,route.includeCookie,route.type),manifest:ReturnType<typeof prepareManifest>|null=null,master=false;
   if(result.type==='hls'){const variant=hlsVariant(result.text,result.url);if(variant?.audioURL){
    // Keep audio, not just the video variant. These public proxy playlists are
    // checked without the guest cookie before native HLS receives their URLs.
    for(const url of [variant.url,variant.audioURL]){const u=new URL(url);if(u.origin!==BASE||!u.pathname.startsWith('/vr/fr/vt/'))fail('UNSUPPORTED_MANIFEST');}
    const video=await media(ctx,variant.url,false),audio=await media(ctx,variant.audioURL,false);if(video.type!=='hls'||audio.type!=='hls')fail('UNSUPPORTED_MANIFEST');
    const v=prepareManifest(video.text,video.url,now()),a=prepareManifest(audio.text,audio.url,now()),body='#EXTM3U\n#EXT-X-INDEPENDENT-SEGMENTS\n'+variant.audioTag!.replace(/\bURI="[^"]+"/,'URI="'+audio.url+'"')+'\n'+variant.attributes+'\n'+video.url+'\n';
    manifest=Object.freeze({body,bodySHA256:sha256(body),referenceHosts:Object.freeze([...new Set([...v.referenceHosts,...a.referenceHosts])].sort()),referenceCount:v.referenceCount+a.referenceCount,expiresAt:Math.min(v.expiresAt,a.expiresAt)});master=true;
   }else if(variant)result=await media(ctx,variant.url,route.includeCookie,route.type);if(!manifest&&result.type==='hls')manifest=prepareManifest(result.text,result.url,now());}
   let englishSubtitleCues:readonly SubtitleCue[]=Object.freeze([]),subtitleStatus:ResolvedEpisode['subtitleStatus']='unavailable';
   try{const lg=englishSubtitleLanguage(await get(ctx,'/api/subtitles/'+detail.id+'/'+episodeNumber+'?lang=en','subtitle-index',131072));if(lg){englishSubtitleCues=parseEnglishVTT(await get(ctx,'/sub/'+detail.id+'/'+episodeNumber+'/'+encodeURIComponent(lg),'english-subtitle',SOURCE_CONTRACT.maxSubtitleBytes,false) as string);subtitleStatus='english-sidecar';}else subtitleStatus='no-english-sidecar';}
   catch(e){if(ctx.signal.aborted)throw e;subtitleStatus='unavailable';}
   const common={sourceId:'dramadunyam' as const,identity:Object.freeze({seriesId:detail.id,slug:detail.slug,platform:detail.platform,episodeNumber}),title:detail.title,episodeNumber,englishSubtitleCues,subtitleStatus,receipt:receipt(ctx),cdnCredentialsAttached:false as const,languageQualification:detail.languageQualification};
   if(ctx.signal.aborted)fail('ABORTED');return result.type==='mp4'?Object.freeze({...common,type:'mp4',uri:result.uri,manifestBody:null,manifestSHA256:null,referenceHosts:Object.freeze([new URL(result.uri).hostname]),referenceCount:1,expiresAt:Math.min(now()+300000,route.expiresAt),transport:'direct-https-mp4'}):Object.freeze({...common,type:'hls',manifestBody:manifest!.body,manifestSHA256:manifest!.bodySHA256,referenceHosts:manifest!.referenceHosts,referenceCount:manifest!.referenceCount,expiresAt:Math.min(manifest!.expiresAt,route.expiresAt),transport:master?'app-cache-master-direct-https-playlists-and-segments':'app-cache-manifest-direct-https-segments'});
  });
 }
 return Object.freeze({fetchPlatforms,fetchPlatformDirectory,fetchCatalogue,searchCatalogue,fetchHome,fetchDetail,resolveEpisode,clearCache:()=>{cacheEpoch++;cache.clear();}});
}
const defaultClient=createSourceClient();
export const fetchPlatforms=defaultClient.fetchPlatforms;
export const fetchPlatformDirectory=defaultClient.fetchPlatformDirectory;
export const fetchCatalogue=defaultClient.fetchCatalogue;
export const searchCatalogue=defaultClient.searchCatalogue;
export const fetchHome=defaultClient.fetchHome;
export const fetchDetail=defaultClient.fetchDetail;
export const resolveEpisode=defaultClient.resolveEpisode;
export const clearSourceCache=defaultClient.clearCache;
