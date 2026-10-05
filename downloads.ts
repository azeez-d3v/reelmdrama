import {native} from './native';
import type {DramaCard,DramaDetail,ResolvedEpisode} from './services/types';
import type {OfflineResolvedEpisode} from './playback-types';
export type DownloadState='queued'|'resolving'|'downloading'|'paused'|'complete'|'failed'|'unreadable'|'deleting';
export type DownloadSummary={id:string;card:DramaCard;episodeNumber:number;state:DownloadState;bytesStored:number;bytesReceived:number;bytesTotal:number|null;errorCode:string|null};
export type DownloadClaim={ticket:string;card:DramaCard;episodeNumber:number};
export function groupDownloads(rows:readonly DownloadSummary[]){
 const groups=new Map<string,{key:string;card:DramaCard;rows:DownloadSummary[];bytesStored:number;complete:number;unavailable:number;failed:number}>();
 for(const row of rows){const key=[row.card.id,row.card.slug,row.card.platform].join('|');let group=groups.get(key);if(!group){group={key,card:row.card,rows:[],bytesStored:0,complete:0,unavailable:0,failed:0};groups.set(key,group);}group.rows.push(row);group.bytesStored+=row.bytesStored;if(row.state==='complete')group.complete++;else if(row.errorCode==='EPISODE_NOT_ADVERTISED')group.unavailable++;else if(row.state==='failed'||row.state==='unreadable')group.failed++;}
 return Array.from(groups.values());
}
let wakeOwner:(()=>Promise<void>)|null=null,abortOwner:(()=>void)|null=null,targetOwner:((rows:DownloadSummary[],ids:readonly string[])=>void)|null=null,pumpError:unknown=null;
export const getDownloadPumpError=()=>pumpError;
const kick=()=>{void wakeOwner?.().catch(error=>{pumpError=error;});};
export const listDownloads=()=>native.reelmListDownloads();
export const downloadStorageBytes=()=>native.reelmDownloadStorageBytes();
export const releaseOfflineEpisode=(leaseId:string)=>native.reelmReleaseOffline(leaseId);
export async function acquireOfflineEpisode(downloadId:string):Promise<{resolution:OfflineResolvedEpisode;detail:DramaDetail;uri:string;leaseId:string}>{
 if(!/^[a-f0-9]{32}$/.test(downloadId))throw Error('OFFLINE_UNREADABLE');
 const lease=await native.reelmAcquireOffline(downloadId);
 try{
  if(lease.downloadId!==downloadId||!/^[a-f0-9]{32}$/.test(lease.leaseId)||!new RegExp('^reelm-offline://'+lease.leaseId+'/[a-f0-9]{32}$').test(lease.rootUri))throw Error('OFFLINE_UNREADABLE');
  const metadata=await native.reelmReadOfflineMetadata(lease.leaseId),d=metadata.detail,n=metadata.episodeNumber,i=metadata.identity;
  if(metadata.version!==1||!Number.isInteger(n)||n<1||n>d.totalEpisodes||i.episodeNumber!==n||i.seriesId!==d.id||i.slug!==d.slug||i.platform!==d.platform||d.receipt!==null||!(metadata.type==='mp4'&&lease.contentType==='video/mp4'||metadata.type==='hls'&&lease.contentType==='application/vnd.apple.mpegurl'))throw Error('OFFLINE_UNREADABLE');
  const detail:DramaDetail={...d,cover:null,receipt:null,cached:false,episodes:Array.from({length:d.totalEpisodes},(_,index)=>({number:index+1,advertisedAvailable:index+1<=Math.min(d.availableEpisodes,d.episodesInDB),qualification:'Stored source listing; only completed downloads play offline.'}))};
  const resolution:OfflineResolvedEpisode={sourceId:'offline',downloadId,identity:i,title:d.title,episodeNumber:n,type:metadata.type,englishSubtitleCues:metadata.englishSubtitleCues,subtitleStatus:metadata.subtitleStatus,languageQualification:d.languageQualification,transport:'app-private-encrypted'};
  return {resolution,detail,uri:lease.rootUri,leaseId:lease.leaseId};
 }catch(error){await releaseOfflineEpisode(lease.leaseId);throw error;}
}
export async function enqueueDownloads(detail:DramaDetail,ordinals:readonly number[]){await native.reelmEnqueueDownloads(detail,ordinals);kick();}
export const claimNextDownload=()=>native.reelmClaimNextDownload();
export const startDownload=(ticket:string,detail:DramaDetail,resolved:ResolvedEpisode)=>native.reelmStartDownload(ticket,detail,resolved);
export const failDownload=(ticket:string,code:string)=>native.reelmFailDownload(ticket,code);
export async function pauseDownloads(){abortOwner?.();await native.reelmPauseDownloads();}
export async function resumeDownloads(){await native.reelmResumeDownloads();kick();}
async function target(ids:readonly string[],remove:boolean){if(targetOwner)targetOwner(await listDownloads(),ids);await (remove?native.reelmDeleteDownloads(ids):native.reelmCancelDownloads(ids));kick();}
export const cancelDownloads=(ids:readonly string[])=>target(ids,false);
export async function retryDownloads(ids:readonly string[]){await native.reelmRetryDownloads(ids);kick();}
export const deleteDownloads=(ids:readonly string[])=>target(ids,true);
export function createDownloadPump(source:{fetchDetail(card:DramaCard,signal?:AbortSignal):Promise<DramaDetail>;resolveEpisode(detail:DramaDetail,ordinal:number,signal?:AbortSignal):Promise<ResolvedEpisode>}){
 let active=false,disposed=false,generation=0,controller:AbortController|null=null,running:Promise<void>|null=null,activeClaim:DownloadClaim|null=null;
 let readiness=Promise.resolve();
 const writeReady=(value:boolean)=>{const next=readiness.catch(()=>{}).then(()=>native.reelmSetDownloadsActive(value));readiness=next;return next;};
 const invalidate=()=>{generation++;controller?.abort();};
 const wake=():Promise<void>=>{
  if(running)return running;
  running=(async()=>{
   while(active&&!disposed){
    const g=generation,claim=await claimNextDownload();
    if(g!==generation||!active||disposed||!claim)break;
    activeClaim=claim;controller=new AbortController();const signal=controller.signal;
    let started=false;
    try{
     const detail=await source.fetchDetail(claim.card,signal);
     if(g!==generation||!active||disposed)break;
     const resolved=await source.resolveEpisode(detail,claim.episodeNumber,signal);
     if(g!==generation||!active||disposed)break;
     started=true;await startDownload(claim.ticket,detail,resolved);
    }catch(error){
     if(!started&&g===generation&&active&&!disposed&&!signal.aborted){const code=(error as {code?:unknown})?.code;await failDownload(claim.ticket,typeof code==='string'?code:'DOWNLOAD_FAILED');}
    }finally{controller=null;activeClaim=null;}
   }
  })().catch(error=>{pumpError=error;throw error;}).finally(()=>{running=null;});
  return running;
 };
 const wakeAfter=async()=>{await running;return wake();};
 wakeOwner=wakeAfter;abortOwner=invalidate;targetOwner=(rows,ids)=>{if(activeClaim&&rows.some(row=>ids.includes(row.id)&&row.episodeNumber===activeClaim!.episodeNumber&&row.card.id===activeClaim!.card.id&&row.card.slug===activeClaim!.card.slug&&row.card.platform===activeClaim!.card.platform))invalidate();};
 return {wake,async setActive(value:boolean){try{if(disposed)return;if(active!==value){active=value;invalidate();}const g=generation;await writeReady(value);if(value&&active&&!disposed&&g===generation)return wakeAfter();}catch(error){pumpError=error;throw error;}},async dispose(){disposed=true;active=false;invalidate();if(wakeOwner===wakeAfter){wakeOwner=null;abortOwner=null;targetOwner=null;}try{await writeReady(false);await running;}catch(error){pumpError=error;throw error;}}};
}
