import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {BackHandler,FlatList,Image,Keyboard,StyleSheet,Text,View,type NativeScrollEvent,type NativeSyntheticEvent} from 'react-native';
import {SafeAreaProvider,useSafeAreaInsets,initialWindowMetrics} from 'react-native-safe-area-context';
import {StatusBar} from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import {useFonts} from 'expo-font';
import * as Linking from 'expo-linking';
import {Directory,File,Paths} from 'expo-file-system';
import {fetchPlatformDirectory,fetchCatalogue,searchCatalogue,fetchDetail,resolveEpisode,clearSourceCache,parseEpisode,parseSlug,SourceError,type DramaCard,type DramaDetail,type Episode,type ResolvedEpisode} from './services/source';
import {CatalogueScreen,PlayerOverlay,EpisodeSheet,SeriesDetailSheet,StatePanel,NativeMeasurementRoot} from './ui';
import {colors,fonts,type MainTab} from './theme';
import {NativePlayer,EMPTY_PLAYER,type ActiveSource,type PlayerControls,type PlayerSnapshot} from './player';
import {readLibrary,writeLibrary,type Library} from './library';
import {boundedProgress} from './library-policy';
import {E2E_ENABLED,record,setTestRun,getTestRun,startDiagnostics,testCommands} from './diagnostics';
import {controlsMayAutoHide,shouldShowChrome} from './immersion-policy';
import {AnimatedPresence,MotionProvider,useAppActive} from './ui/Motion';
import {useSystemBars} from './ui/SystemBars';
import {PlaybackSurface} from './ui/PlaybackSurface';
import {createEpisodeCache,type PreparedEpisode} from './episode-cache';
import {prepareVideoCache} from './video-cache';
import {NextEpisodeWarmup} from './ui/NextEpisodeWarmup';
import {LaunchSplash} from './ui/LaunchSplash';
import {isLaunchReady} from './splash-policy';
import {createPlatformDirectoryLoader,type PlatformDirectoryState} from './platform-directory';
import {SubtitleOverlay} from './ui/SubtitleOverlay';

const FONT_MAP={Geist:require('./assets/Geist-Regular.ttf'),GeistBold:require('./assets/Geist-Bold.ttf'),GeistMono:require('./assets/GeistMono-Regular.ttf')};
const EMPTY_LIBRARY:Library={saved:[],liked:[],progress:{}};
function problem(e:unknown){const code=e instanceof SourceError?e.code:'NETWORK_ERROR';if(code.startsWith('HTTP_'))return 'This episode is unavailable from the source right now. Try again or choose another.';if(code==='DEADLINE_EXCEEDED'||code==='NETWORK_ERROR')return 'The source did not respond. Check your connection and retry.';if(code==='INVALID_DETAIL')return 'The source returned inconsistent episode details. Try another story.';if(code==='EPISODE_NOT_ADVERTISED')return 'This episode is not available yet. Choose a listed episode.';return 'This source could not be opened. Retry or choose another story.';}
const failureCode=(e:unknown)=>e instanceof SourceError?e.code:'APP_LOAD_ERROR';
const identity=(d:DramaDetail,n:number)=>({seriesId:d.id,slug:d.slug,platform:d.platform,episodeNumber:n});
const cardOnly=(d:DramaCard):DramaCard=>({id:d.id,slug:d.slug,title:d.title,platform:d.platform,cover:d.cover,totalEpisodes:d.totalEpisodes,availableEpisodes:d.availableEpisodes,catalogueLanguage:d.catalogueLanguage,audioEvidence:d.audioEvidence,languageQualification:d.languageQualification,countWarning:d.countWarning,isNew:d.isNew,isPopular:d.isPopular});

const episodeCacheKey=(d:DramaDetail,n:number)=>[d.id,d.slug,d.platform,n,'en'].join('|');
let preparedSequence=0;
async function prepareEpisode(d:DramaDetail,n:number,signal:AbortSignal):Promise<PreparedEpisode<ResolvedEpisode>>{
 const value=await resolveEpisode(d,n,signal);if(signal.aborted)throw new SourceError('ABORTED');
 const f=new File(Paths.cache,'reelm-prepared-'+Date.now()+'-'+(++preparedSequence)+'.m3u8');
 try{f.create({overwrite:false});f.write(value.manifestBody);return {key:episodeCacheKey(d,n),uri:f.uri,expiresAt:value.expiresAt,value};}catch(e){try{if(f.exists)f.delete();}catch{}throw e;}
}
function ReelmApp({videoCaching}:{videoCaching:boolean}){
 const insets=useSafeAreaInsets();
 const [tab,setTab]=useState<MainTab>('home'),[view,setView]=useState<'catalogue'|'player'>('catalogue');
 const [directory,setDirectory]=useState<PlatformDirectoryState>({platforms:[],loading:true,error:null});
 const platforms=directory.platforms;
 const directoryLoader=useMemo(()=>createPlatformDirectoryLoader({load:fetchPlatformDirectory,onState:setDirectory,describeError:()=> 'The platform list could not be loaded. Retry here or refresh the catalogue.',onReady:p=>record('directoryReady',{platforms:p.platforms,receipt:p.receipt,cached:p.cached}),onError:e=>record('directoryError',{errorCategory:failureCode(e)})}),[]);
 const [items,setItems]=useState<readonly DramaCard[]>([]),[platform,setPlatform]=useState<string|null>(null),[query,setQuery]=useState('');
 const [loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false),[catalogueError,setCatalogueError]=useState<string|null>(null),[total,setTotal]=useState(0),[hasMore,setHasMore]=useState(false);
 const [detail,setDetail]=useState<DramaDetail|null>(null),[detailOpen,setDetailOpen]=useState(false),[detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState<string|null>(null);
 const [source,setSource]=useState<ActiveSource|null>(null),[episode,setEpisode]=useState(1),[playerError,setPlayerError]=useState<string|null>(null),[playerLoading,setPlayerLoading]=useState(false),[snap,setSnap]=useState<PlayerSnapshot>(EMPTY_PLAYER),[episodeOpen,setEpisodeOpen]=useState(false),[overlayVisible,setOverlayVisible]=useState(true),[captionsEnabled,setCaptionsEnabled]=useState(true);
 const [size,setSize]=useState({width:0,height:0}),[library,setLibrary]=useState<Library>(EMPTY_LIBRARY);
 const [holding,setHolding]=useState(false),holdOwner=useRef<PlayerControls|null>(null);
 const episodeCache=useMemo(()=>createEpisodeCache<ResolvedEpisode>({capacity:5,safetyMs:5000,release:entry=>{try{const f=new File(entry.uri);if(f.exists)f.delete();}catch{}}}),[]);
 const [warmSource,setWarmSource]=useState<{entry:PreparedEpisode<ResolvedEpisode>;releaseLease:()=>void}|null>(null);
 const warmLease=useRef<(()=>void)|null>(null);
 const preparedLease=useRef<(()=>void)|null>(null);
 const appActive=useAppActive();
 const immersionState={view,playing:snap.playing,loading:playerLoading||snap.status==='loading',error:!!playerError,sheetOpen:episodeOpen||detailOpen,appActive};
 const mayAutoHide=controlsMayAutoHide(immersionState),chromeVisible=shouldShowChrome(immersionState,overlayVisible);
 const showSystemBars=useSystemBars(chromeVisible,appActive);
 const mounted=useRef(true),catalogueEpoch=useRef(0),detailEpoch=useRef(0),mediaEpoch=useRef(0),page=useRef(1),pages=useRef(1),queryRef=useRef(''),platformRef=useRef<string|null>(null),catalogueBusy=useRef(false);
 const catalogueRequest=useRef<AbortController|null>(null),detailRequest=useRef<AbortController|null>(null),mediaRequest=useRef<AbortController|null>(null),detailRef=useRef<DramaDetail|null>(null),active=useRef<ActiveSource|null>(null),controls=useRef<PlayerControls|null>(null),feed=useRef<FlatList<Episode>>(null),savedLibrary=useRef(EMPTY_LIBRARY),episodeRef=useRef(1),hideTimer=useRef<ReturnType<typeof setTimeout>|null>(null),viewRef=useRef(view),snapshotRef=useRef(EMPTY_PLAYER),lastSlug=useRef<string|null>(null);
 viewRef.current=view;savedLibrary.current=library;detailRef.current=detail;active.current=source;episodeRef.current=episode;snapshotRef.current=snap;
 const libraryRevision=useRef(0);
 const dragIntent=useRef(false),dragTimer=useRef<ReturnType<typeof setTimeout>|null>(null),sheetIntent=useRef<{loadId:string;playing:boolean}|null>(null);
 const savedIds=useMemo(()=>new Set(library.saved.map(x=>x.id)),[library.saved]);
 const endHold=useCallback(()=>{holdOwner.current?.endSpeedBoost();holdOwner.current=null;setHolding(false);},[]);
 const clearWarmup=useCallback(()=>{const release=warmLease.current;warmLease.current=null;if(release)setTimeout(release,1000);if(mounted.current)setWarmSource(null);},[]);
 const clearPrepared=useCallback(()=>{const release=preparedLease.current;preparedLease.current=null;if(release)setTimeout(release,1000);},[]);
 const remember=useCallback(()=>{const a=active.current,s=controls.current?.snapshot()??snapshotRef.current;if(!a||s.time<=0)return;++libraryRevision.current;setLibrary(old=>{const next={...old,progress:boundedProgress({...old.progress,[a.resolution.identity.slug]:{slug:a.resolution.identity.slug,episode:a.resolution.episodeNumber,time:s.time,updatedAt:Date.now()}})};writeLibrary(next);return next;});},[]);
 const reveal=useCallback(()=>{setOverlayVisible(true);if(hideTimer.current)clearTimeout(hideTimer.current);hideTimer.current=setTimeout(()=>setOverlayVisible(false),4500);},[]);
 const beginHold=useCallback(()=>{const player=controls.current;if(!mayAutoHide||!player||!player.beginSpeedBoost())return false;holdOwner.current=player;setHolding(true);if(hideTimer.current){clearTimeout(hideTimer.current);hideTimer.current=null;}setOverlayVisible(false);return true;},[mayAutoHide]);
 const stopVideo=useCallback(()=>{endHold();clearPrepared();++detailEpoch.current;detailRequest.current?.abort();setDetailLoading(false);setDetailOpen(false);remember();++mediaEpoch.current;mediaRequest.current?.abort();mediaRequest.current=null;controls.current?.pause();active.current=null;setSource(null);setSnap(EMPTY_PLAYER);setPlayerLoading(false);setEpisodeOpen(false);},[remember,endHold,clearPrepared]);
 const browse=useCallback(()=>{stopVideo();setView('catalogue');viewRef.current='catalogue';record('viewChanged',{view:'catalogue'});},[stopVideo]);
 const changeLibrary=useCallback((kind:'saved'|'liked',card:DramaCard)=>{++libraryRevision.current;setLibrary(old=>{let next:Library;if(kind==='saved')next={...old,saved:old.saved.some(x=>x.id===card.id)?old.saved.filter(x=>x.id!==card.id):[cardOnly(card),...old.saved].slice(0,300)};else next={...old,liked:old.liked.includes(card.id)?old.liked.filter(x=>x!==card.id):[card.id,...old.liked].slice(0,300)};writeLibrary(next);record('libraryChanged',{kind,seriesId:card.id,savedCount:next.saved.length});return next;});},[]);
 const loadCatalogue=useCallback(async(opts:{platform?:string|null;query?:string;append?:boolean;refresh?:boolean;page?:number}={})=>{
  if(opts.append&&(!hasMore||catalogueBusy.current))return;catalogueRequest.current?.abort();const g=++catalogueEpoch.current,runId=getTestRun(),ctrl=new AbortController();catalogueRequest.current=ctrl;catalogueBusy.current=true;
  const selected=opts.platform===undefined?platformRef.current:opts.platform,q=(opts.query??queryRef.current).trim(),n=opts.page??(opts.append?page.current+1:1);
  platformRef.current=selected;queryRef.current=q;setPlatform(selected);setQuery(q);if(!opts.append){setItems([]);setLoading(!opts.refresh);}setRefreshing(!!opts.refresh);setCatalogueError(null);
  record('catalogueRequested',{runId,generation:g,platform:selected,query:q,page:n});
  try{const result=q?await searchCatalogue(q,{page:n},ctrl.signal):await fetchCatalogue({...(selected?{platform:selected}:{}),page:n},ctrl.signal);if(!mounted.current||ctrl.signal.aborted||g!==catalogueEpoch.current)return;
   setItems(old=>opts.append?[...old,...result.items.filter(x=>!old.some(y=>x.id===y.id))]:result.items);setTotal(result.total);page.current=result.page;pages.current=result.pages;setHasMore(result.page<result.pages);record('catalogueReady',{runId,generation:g,platform:selected,query:q,page:n,total:result.total,pages:result.pages,items:result.items,receipt:result.receipt,cached:result.cached});
  }catch(e){if(g!==catalogueEpoch.current||ctrl.signal.aborted)return;setCatalogueError(problem(e));record('catalogueError',{runId,generation:g,platform:selected,page:n,errorCategory:failureCode(e),receipt:e instanceof SourceError?e.receipt:null});}finally{if(g===catalogueEpoch.current){catalogueBusy.current=false;setLoading(false);setRefreshing(false);}if(catalogueRequest.current===ctrl)catalogueRequest.current=null;}
 },[hasMore]);
 const openDetail=useCallback(async(card:DramaCard|string,show=true):Promise<DramaDetail|null>=>{
  detailRequest.current?.abort();const g=++detailEpoch.current,ctrl=new AbortController(),runId=getTestRun();detailRequest.current=ctrl;lastSlug.current=typeof card==='string'?card:card.slug;setDetail(null);detailRef.current=null;setDetailLoading(true);setDetailError(null);if(show){reveal();await showSystemBars();if(!mounted.current||ctrl.signal.aborted||g!==detailEpoch.current)return null;setDetailOpen(true);}record('detailRequested',{runId,generation:g,slug:lastSlug.current});
  try{const d=await fetchDetail(card,ctrl.signal);if(!mounted.current||ctrl.signal.aborted||g!==detailEpoch.current)return null;detailRef.current=d;setDetail(d);record('detailReady',{runId,generation:g,detail:d,receipt:d.receipt,cached:d.cached});return d;}catch(e){if(g===detailEpoch.current&&!ctrl.signal.aborted){setDetailError(problem(e));record('detailError',{runId,generation:g,errorCategory:failureCode(e),receipt:e instanceof SourceError?e.receipt:null});}return null;}finally{if(g===detailEpoch.current)setDetailLoading(false);if(detailRequest.current===ctrl)detailRequest.current=null;}
 },[reveal,showSystemBars]);
 const loadEpisode=useCallback(async(d:DramaDetail,n:number,startTime=0,autoplay=true)=>{
  endHold();clearPrepared();mediaRequest.current?.abort();const g=++mediaEpoch.current,ctrl=new AbortController(),loadId='load-'+g,sourceSessionId='native-'+Date.now()+'-'+g,runId=getTestRun();mediaRequest.current=ctrl;remember();controls.current?.pause();active.current=null;setSource(null);setSnap(EMPTY_PLAYER);setPlayerLoading(true);setPlayerError(null);setView('player');viewRef.current='player';setDetailOpen(false);setEpisodeOpen(false);episodeRef.current=n;setEpisode(n);setCaptionsEnabled(true);reveal();
  const ctx={runId,loadId,sourceSessionId,identity:identity(d,n)};record('metadataRequested',{...ctx,reason:'episode-selection'});
  let releasePrepared:(()=>void)|null=null;
  try{if(!d.episodes[n-1]?.advertisedAvailable)throw new SourceError('EPISODE_NOT_ADVERTISED');
   // Join a selected next episode before the old effect cancels prefetch subscribers.
   const result=await episodeCache.load(episodeCacheKey(d,n),signal=>prepareEpisode(d,n,signal),{signal:ctrl.signal});releasePrepared=result.releasePin;
   if(!mounted.current||ctrl.signal.aborted||g!==mediaEpoch.current){releasePrepared();return;}
   preparedLease.current=releasePrepared;const resolved=result.entry.value,next:ActiveSource={uri:result.entry.uri,resolution:resolved,loadId,sourceSessionId,startTime,autoplay,runId,releasePrepared};active.current=next;setSource(next);setPlayerLoading(false);record('metadataReady',{...ctx,cached:result.cached,receipt:resolved.receipt,resolutionEvidence:{identity:resolved.identity,assignedUriScheme:'file:',transport:resolved.transport,cdnCredentialsAttached:false,referenceHosts:resolved.referenceHosts,referenceCount:resolved.referenceCount,manifestSHA256:resolved.manifestSHA256},subtitleStatus:resolved.subtitleStatus});
  }catch(e){releasePrepared?.();if(g!==mediaEpoch.current||ctrl.signal.aborted)return;setPlayerLoading(false);setPlayerError(problem(e));record('metadataError',{...ctx,errorCategory:failureCode(e),receipt:e instanceof SourceError?e.receipt:null});}finally{if(mediaRequest.current===ctrl)mediaRequest.current=null;}
 },[remember,reveal,endHold,episodeCache,clearPrepared]);
 const playOrdinal=useCallback((n:number)=>{const d=detailRef.current;if(!d||n<1||n>d.totalEpisodes||!d.episodes[n-1]?.advertisedAvailable)return;try{feed.current?.scrollToIndex({index:n-1,animated:true});}catch{};void loadEpisode(d,n);},[loadEpisode]);
 const watchCard=useCallback(async(card:DramaCard|string,n?:number)=>{stopVideo();const d=await openDetail(card,true);if(!d)return;const progress=savedLibrary.current.progress[d.slug],ordinal=n??(progress&&d.episodes[progress.episode-1]?.advertisedAvailable?progress.episode:1);await loadEpisode(d,ordinal,n===undefined&&progress?.episode===ordinal?progress.time:0);},[stopVideo,openDetail,loadEpisode]);
 const next=useCallback(()=>playOrdinal(episodeRef.current+1),[playOrdinal]);
 const previous=useCallback(()=>playOrdinal(episodeRef.current-1),[playOrdinal]);
 const closeEpisodes=useCallback(()=>{setEpisodeOpen(false);const intent=sheetIntent.current;sheetIntent.current=null;if(intent&&intent.loadId===active.current?.loadId&&intent.playing)controls.current?.play();reveal();},[reveal]);
 const back=useCallback(()=>{if(episodeOpen){closeEpisodes();return true;}if(detailOpen){++detailEpoch.current;detailRequest.current?.abort();setDetailOpen(false);return true;}if(viewRef.current==='player'){browse();return true;}if(tab!=='home'){setTab('home');void loadCatalogue({platform:null,query:''});return true;}return false;},[episodeOpen,detailOpen,tab,browse,loadCatalogue,closeEpisodes]);
 const selectPlatform=useCallback((p:string|null)=>{browse();setTab('discover');void loadCatalogue({platform:p,query:''});},[browse,loadCatalogue]);
 const retryPlatforms=useCallback(()=>{void directoryLoader.refresh();},[directoryLoader]);
 const refreshCatalogue=useCallback(()=>{clearSourceCache();void directoryLoader.refresh();void loadCatalogue({refresh:true});},[directoryLoader,loadCatalogue]);
 const changeTab=useCallback((t:MainTab)=>{browse();setTab(t);if(t==='saved'){++catalogueEpoch.current;catalogueRequest.current?.abort();catalogueBusy.current=false;setLoading(false);setCatalogueError(null);}else {if(!directory.loading&&(directory.error||!platforms.length))void directoryLoader.refresh();void loadCatalogue({platform:null,query:''});}},[browse,loadCatalogue,directory.loading,directory.error,platforms.length,directoryLoader]);
 const submitSearch=useCallback(()=>{Keyboard.dismiss();browse();setTab('discover');void loadCatalogue({platform:null,query:queryRef.current});},[browse,loadCatalogue]);
 const retryPlayer=useCallback(()=>{const d=detailRef.current;if(d){episodeCache.delete(episodeCacheKey(d,episodeRef.current));void loadEpisode(d,episodeRef.current,snapshotRef.current.time);}},[loadEpisode,episodeCache]);
 const openEpisodes=useCallback(async()=>{endHold();const current=active.current;sheetIntent.current=current?{loadId:current.loadId,playing:controls.current?.isDesiredPlaying()??current.autoplay}:null;controls.current?.pause();reveal();await showSystemBars();if(!mounted.current||viewRef.current!=='player'||current?.loadId!==active.current?.loadId)return;setEpisodeOpen(true);record('episodesOpened',{identity:detailRef.current?identity(detailRef.current,episodeRef.current):null});},[reveal,showSystemBars,endHold]);
 const onSnapshot=useCallback((s:PlayerSnapshot)=>{if(active.current){snapshotRef.current=s;setSnap(s);if(s.status==='error')setPlayerError('Playback was interrupted. Retry this episode.');}},[]);
 const sourceSnapshot=useCallback((s:PlayerSnapshot)=>{if(source&&active.current?.loadId===source.loadId)onSnapshot(s);},[source,onSnapshot]);
 const testAction=useCallback(async(action:string,params:Record<string,unknown>={})=>{
  if(action==='platform'){const p=String(params.platform??'');if(!platforms.some(x=>x.name===p))throw Error('INVALID_PLATFORM');browse();setTab('discover');clearSourceCache();const requestedPage=Number(params.page??1);if(!Number.isInteger(requestedPage)||requestedPage<1||requestedPage>1000)throw Error('INVALID_PAGE');void loadCatalogue({platform:p,query:'',page:requestedPage});}
  else if(action==='search'){queryRef.current=String(params.q??'').slice(0,120);setQuery(queryRef.current);submitSearch();}
  else if(action==='watch')await watchCard(parseSlug(params.slug),parseEpisode(params.episode??20));
  else if(action==='open'){browse();await openDetail(parseSlug(params.slug));}
  else if(action==='next')next();else if(action==='previous')previous();else if(action==='back')back();else if(action==='home')changeTab('home');else if(action==='saved')changeTab('saved');else if(action==='episodes')openEpisodes();else if(action==='save'){const d=detailRef.current;if(d)changeLibrary('saved',d);}
  else if(action==='pause'){controls.current?.pause();reveal();}else if(action==='play'){controls.current?.play();reveal();}else if(action==='seek'){const seconds=Number(params.seconds);if(!Number.isFinite(seconds)||seconds<0||seconds>86400)throw Error('INVALID_SEEK');controls.current?.seek(seconds);}else throw Error('INVALID_ACTION');
 },[platforms,selectPlatform,submitSearch,watchCard,browse,openDetail,next,previous,back,changeTab,openEpisodes,changeLibrary,loadCatalogue,reveal]);
 const actionRef=useRef(testAction);actionRef.current=testAction;
 useEffect(()=>{const sub=BackHandler.addEventListener('hardwareBackPress',back);return()=>sub.remove();},[back]);
 useEffect(()=>{reveal();return()=>{if(hideTimer.current){clearTimeout(hideTimer.current);hideTimer.current=null;}};},[mayAutoHide,reveal]);
 useEffect(()=>{if(!mayAutoHide)endHold();return endHold;},[mayAutoHide,source?.loadId,endHold]);
 useEffect(()=>{const cleanup=startDiagnostics();record('boot',{view:'catalogue',initialMediaRequested:false,edgeToEdge:true});void directoryLoader.refresh();void loadCatalogue();void readLibrary().then(v=>{if(mounted.current&&libraryRevision.current===0)setLibrary(v);});void NavigationBar.setButtonStyleAsync('light').catch(()=>{});
  return()=>{mounted.current=false;directoryLoader.dispose();catalogueRequest.current?.abort();detailRequest.current?.abort();mediaRequest.current?.abort();cleanup();if(hideTimer.current)clearTimeout(hideTimer.current);if(dragTimer.current)clearTimeout(dragTimer.current);};
 // Bootstrap once; subsequent loading is exclusively user/controller driven.
 },[]);
 useEffect(()=>{let alive=true;const handle=async(url:string)=>{try{const u=new URL(url);if(u.protocol!=='reelm-drama:')return;if(u.hostname==='e2e'&&E2E_ENABLED){const run=u.searchParams.get('runId');if(run)setTestRun(run);await actionRef.current(u.searchParams.get('action')??'',Object.fromEntries(u.searchParams));}else if(u.hostname==='watch')await watchCard(parseSlug(u.searchParams.get('slug')),parseEpisode(u.searchParams.get('episode')??1));else if(u.hostname==='series'){browse();await openDetail(parseSlug(u.searchParams.get('slug')));}}catch{record('actionRejected',{errorCategory:'INVALID_ACTION'});}};
  void Linking.getInitialURL().then(u=>{if(alive&&u)void handle(u);});const listener=Linking.addEventListener('url',e=>void handle(e.url));return()=>{alive=false;listener.remove();};
 },[watchCard,browse,openDetail]);
 useEffect(()=>{if(!E2E_ENABLED)return;let alive=true,busy=false,last=0,previousRun=getTestRun();const timer=setInterval(async()=>{if(busy)return;busy=true;try{const run=getTestRun();if(run!==previousRun){last=0;previousRun=run;}const commands=await testCommands(last);for(const c of commands){if(!alive||run!==getTestRun()||!Number.isInteger(c.id)||c.id<=last)break;const a=active.current,ctx=a?{identity:a.resolution.identity,loadId:a.loadId,sourceSessionId:a.sourceSessionId}:{};record('commandRequested',{...ctx,command:c.action,actionId:'command-'+c.id});try{await actionRef.current(c.action,c);record('commandApplied',{...ctx,command:c.action,actionId:'command-'+c.id});}catch{record('commandRejected',{...ctx,command:c.action,actionId:'command-'+c.id,errorCategory:'INVALID_ACTION'});}last=c.id;}}finally{busy=false;}},350);return()=>{alive=false;clearInterval(timer);};},[]);
 useEffect(()=>{const t=setInterval(remember,10000);return()=>clearInterval(t);},[remember]);
 useEffect(()=>()=>{clearPrepared();clearWarmup();episodeCache.clear();},[episodeCache,clearWarmup,clearPrepared]);
 const mayPrefetch=videoCaching&&mayAutoHide&&snap.sourceLoadSeen&&snap.bufferedPosition-snap.time>=5;
 useEffect(()=>{
  if(!mayPrefetch||!source||!detail)return;const n=source.resolution.episodeNumber+1;
  if(!detail.episodes[n-1]?.advertisedAvailable)return;const ctrl=new AbortController(),key=episodeCacheKey(detail,n);
  void episodeCache.prefetch(key,signal=>prepareEpisode(detail,n,signal),{signal:ctrl.signal}).then(result=>{
   if(ctrl.signal.aborted||!mounted.current||active.current?.loadId!==source.loadId)return;
   clearWarmup();const releaseLease=episodeCache.pin(result.entry);warmLease.current=releaseLease;setWarmSource({entry:result.entry,releaseLease});
   record('nextEpisodePrepared',{episodeNumber:n,cached:result.cached,manifestSHA256:result.entry.value.manifestSHA256});
  }).catch(()=>{});
  return()=>{ctrl.abort();episodeCache.cancelPrefetch();clearWarmup();};
 },[mayPrefetch,source?.loadId,detail,episodeCache,clearWarmup]);
 const swipe=useCallback((e:NativeSyntheticEvent<NativeScrollEvent>)=>{if(dragTimer.current)clearTimeout(dragTimer.current);if(!size.height)return;const n=Math.round(e.nativeEvent.contentOffset.y/size.height)+1;if(n!==episodeRef.current){record('swipeCommitted',{fromEpisode:episodeRef.current,toEpisode:n});playOrdinal(n);}else if(dragIntent.current)controls.current?.play();dragIntent.current=false;},[size.height,playOrdinal]);
 const recover=useCallback((position:number,autoplay:boolean)=>{const d=detailRef.current;if(d){episodeCache.delete(episodeCacheKey(d,episodeRef.current));void loadEpisode(d,episodeRef.current,position,autoplay);}},[loadEpisode,episodeCache]);
 const cue=source?.resolution.englishSubtitleCues.find(c=>snap.time>=c.start&&snap.time<c.end);
 const catalogueItems=tab==='saved'?library.saved:items;
 const renderEpisode=useCallback(({item}:{item:Episode})=><PlaybackSurface active={item.number===episode&&!!source} onReveal={reveal} onHoldStart={beginHold} onHoldEnd={endHold} style={[styles.page,{height:size.height,width:size.width}]}>{item.number===episode&&source?<NativePlayer key={source.loadId} ref={controls} source={source} caching={videoCaching} onSnapshot={sourceSnapshot} onEnded={next} onRecovery={recover}/>:detail?.cover?<Image source={{uri:detail.cover}} style={styles.poster} resizeMode="contain"/>:null}</PlaybackSurface>,[size,episode,source,detail,sourceSnapshot,next,recover,reveal,beginHold,endHold,videoCaching]);
 return <NativeMeasurementRoot calibrationId="app-root" style={styles.root} onLayout={e=>{const {width,height}=e.nativeEvent.layout;setSize({width,height});record('layout',{view,insets,rootWidth:width,rootHeight:height,statusbarStyle:'light',edgeToEdge:true});}}>
  <StatusBar style="light" hidden={!chromeVisible} animated/>
  {warmSource?<NextEpisodeWarmup key={warmSource.entry.uri} uri={warmSource.entry.uri}/>:null}
  {view==='catalogue'?<CatalogueScreen tab={tab} items={catalogueItems} platforms={platforms} platformsLoading={directory.loading} platformsError={directory.error} onRetryPlatforms={retryPlatforms} selectedPlatform={platform} query={query} loading={tab!=='saved'&&loading} refreshing={refreshing} error={catalogueError} hasMore={tab!=='saved'&&hasMore} savedIds={savedIds} insets={insets} total={tab==='saved'?library.saved.length:total} onQueryChange={v=>{queryRef.current=v;setQuery(v);}} onSearchSubmit={submitSearch} onPlatformChange={selectPlatform} onRefresh={refreshCatalogue} onLoadMore={()=>void loadCatalogue({append:true})} onOpenSeries={c=>{browse();void openDetail(c);}} onWatch={c=>void watchCard(c)} onTabChange={changeTab}/>:
   <View style={styles.player}>
    {detail&&size.height>0?<FlatList ref={feed} data={detail.episodes} key={detail.slug} keyExtractor={x=>String(x.number)} renderItem={renderEpisode} pagingEnabled initialScrollIndex={Math.min(episode-1,Math.max(0,detail.episodes.length-1))} getItemLayout={(_,i)=>({length:size.height,offset:size.height*i,index:i})} onMomentumScrollEnd={swipe} onScrollBeginDrag={()=>{endHold();dragIntent.current=controls.current?.isDesiredPlaying()??false;controls.current?.pause();}} onMomentumScrollBegin={()=>{if(dragTimer.current)clearTimeout(dragTimer.current);}} onScrollEndDrag={e=>{const event={nativeEvent:{contentOffset:{...e.nativeEvent.contentOffset}}} as NativeSyntheticEvent<NativeScrollEvent>;dragTimer.current=setTimeout(()=>swipe(event),250);}} showsVerticalScrollIndicator={false} initialNumToRender={1} maxToRenderPerBatch={2} windowSize={3} removeClippedSubviews={false} extraData={source?.loadId}/>:null}
    {captionsEnabled&&cue?<SubtitleOverlay text={cue.text} bottomInset={insets.bottom} leftInset={insets.left} rightInset={insets.right} chromeVisible={chromeVisible}/>:null}
    <AnimatedPresence visible={holding} testID="player-speed-boost" style={[styles.boost,{top:insets.top+20}]}><View pointerEvents="none"><Text style={styles.boostText}>1.5× speed</Text></View></AnimatedPresence>
    <PlayerOverlay title={detail?.title??'Loading story…'} platform={detail?.platform??''} episodeNumber={episode} totalEpisodes={detail?.totalEpisodes??0} playing={snap.playing} buffering={playerLoading||snap.status==='loading'} time={snap.time} duration={snap.duration} saved={!!detail&&savedIds.has(detail.id)} liked={!!detail&&library.liked.includes(detail.id)} visible={chromeVisible} insets={insets} error={playerError} hasNext={!!detail&&!!detail.episodes[episode]?.advertisedAvailable} hasPrevious={episode>1} captionsAvailable={!!source?.resolution.englishSubtitleCues.length} captionsEnabled={captionsEnabled} onBack={browse} onTogglePlay={()=>{if(snap.playing)controls.current?.pause();else controls.current?.play();reveal();}} onToggleSave={()=>{if(detail)changeLibrary('saved',detail);reveal();}} onToggleLike={()=>{if(detail)changeLibrary('liked',detail);reveal();}} onEpisodes={openEpisodes} onNext={next} onPrevious={previous} onSeekFraction={fraction=>{controls.current?.seek(fraction*snap.duration);reveal();}} onRetry={retryPlayer} onToggleCaptions={()=>{setCaptionsEnabled(x=>!x);reveal();}}/>
   </View>}
  {detailOpen?<SeriesDetailSheet detail={detail} loading={detailLoading} error={detailError} saved={!!detail&&savedIds.has(detail.id)} onClose={()=>{++detailEpoch.current;detailRequest.current?.abort();setDetailOpen(false);}} onWatchEpisode={n=>{if(detail)void loadEpisode(detail,n);}} onToggleSave={()=>{if(detail)changeLibrary('saved',detail);}} onRetry={()=>{if(lastSlug.current)void openDetail(lastSlug.current);}} bottomInset={insets.bottom} topInset={insets.top}/>:null}
  {episodeOpen&&detail?<EpisodeSheet episodes={detail.episodes} currentEpisode={episode} onSelect={playOrdinal} onClose={closeEpisodes} bottomInset={insets.bottom}/>:null}
 </NativeMeasurementRoot>;
}
export default function App(){const [ready,error]=useFonts(FONT_MAP),[cacheSetup,setCacheSetup]=useState<boolean|null>(null);
 useEffect(()=>{let alive=true;try{for(const entry of new Directory(Paths.cache).list())if(entry instanceof File&&/^reelm-prepared-\d+-\d+\.m3u8$/.test(entry.name))try{entry.delete();}catch{}}catch{}
  void prepareVideoCache().then(enabled=>{if(alive)setCacheSetup(enabled);});return()=>{alive=false;};},[]);
 const appReady=isLaunchReady(ready,!!error,cacheSetup);
 return <MotionProvider><SafeAreaProvider initialMetrics={initialWindowMetrics}><View style={styles.launchRoot}>
  {!appReady?<StatusBar style="light"/>:null}
  {(ready||error)&&cacheSetup!==null?<ReelmApp videoCaching={cacheSetup}/>:null}
  <LaunchSplash ready={appReady} fontsLoaded={ready} fontsSettled={ready||!!error}/>
 </View></SafeAreaProvider></MotionProvider>;}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:colors.background},player:{flex:1,backgroundColor:colors.deep},page:{backgroundColor:colors.deep},boost:{position:'absolute',alignSelf:'center',paddingHorizontal:12,paddingVertical:6,backgroundColor:colors.scrim},boostText:{fontFamily:fonts.bold,fontSize:13,lineHeight:18,color:colors.signal},poster:{...StyleSheet.absoluteFillObject,opacity:.24},launchRoot:{flex:1,backgroundColor:colors.background}});
