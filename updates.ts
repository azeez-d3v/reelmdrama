import {fetch as expoFetch} from 'expo/fetch';
import {native} from './native';

export type UpdateCandidate={releaseTag:string;assetName:string;url:string;bytes:number;sha256:string};
export type UpdateStatus={state:'idle'|'downloading'|'verified'|'installing'|'failed';bytes:number;total:number|null;errorCode:string|null};
export type UpdateCheck={status:'current'|'available'|'unverified';candidate:UpdateCandidate|null;releaseTag:string|null;checkedAt:number};
const LATEST='https://api.github.com/repos/azeez-d3v/reelmdrama/releases/latest',ASSET='ReelmDrama-arm64-v8a.apk',JSON_LIMIT=1048576;
const HOSTS=['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'];
let lastCheck:UpdateCheck|null=null;
export const getLastUpdateCheck=()=>lastCheck;
export const downloadUpdate=(candidate:UpdateCandidate)=>native.reelmDownloadUpdate(candidate);
export const cancelUpdate=()=>native.reelmCancelUpdate();
export const getUpdateStatus=()=>native.reelmGetUpdateStatus();
export const installVerifiedUpdate=()=>native.reelmInstallVerifiedUpdate();

function approvedURL(value:string){
 const url=new URL(value);
 if(value.length>16384||/[\u0000-\u0020\u007f]/.test(value)||url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!HOSTS.includes(url.hostname))throw Error('UPDATE_REDIRECT');
 return url;
}
function cancellable<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(Error('UPDATE_CANCELLED'));
  if(signal.aborted){abort();return;}
  signal.addEventListener('abort',abort,{once:true});
  work.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
}
async function metadata(response:Response,signal:AbortSignal){
 const length=response.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>JSON_LIMIT))throw Error('UPDATE_METADATA_LIMIT');
 const reader=response.body?.getReader();if(!reader)throw Error('UPDATE_METADATA_INVALID');
 let bytes=0,body='';const decoder=new TextDecoder();
 try{
  while(true){const next=await cancellable(reader.read(),signal);if(next.done)break;bytes+=next.value.byteLength;if(bytes>JSON_LIMIT)throw Error('UPDATE_METADATA_LIMIT');body+=decoder.decode(next.value,{stream:true});}
  body+=decoder.decode();
  try{return JSON.parse(body) as unknown;}catch{throw Error('UPDATE_METADATA_INVALID');}
 }catch(error){void reader.cancel().catch(()=>{});throw error;}
 finally{try{reader.releaseLock();}catch{/* An aborted native read may still own its lock until cancellation settles. */}}
}
function select(value:unknown,versionName:string):Omit<UpdateCheck,'checkedAt'>{
 const unverified={status:'unverified' as const,candidate:null,releaseTag:null};
 if(!value||typeof value!=='object'||Array.isArray(value))return unverified;
 const release=value as Record<string,unknown>,tag=release.tag_name;
 if(release.draft!==false||release.prerelease!==false||typeof tag!=='string'||!tag||tag.length>128||/[\u0000-\u0020\u007f]/.test(tag)||!Array.isArray(release.assets))return unverified;
 const result={...unverified,releaseTag:tag};
 const assets=release.assets.filter(asset=>asset&&typeof asset==='object'&&asset.name===ASSET);
 if(assets.length!==1)return result;
 const asset=assets[0] as Record<string,unknown>;
 if(asset.state!=='uploaded'||!Number.isSafeInteger(asset.size)||(asset.size as number)<1||(asset.size as number)>268435456||typeof asset.digest!=='string'||!/^sha256:[a-f0-9]{64}$/i.test(asset.digest)||typeof asset.browser_download_url!=='string')return result;
 let url:URL;try{url=approvedURL(asset.browser_download_url);}catch{return result;}
 if(url.hostname!=='github.com'||url.search||url.pathname!==`/azeez-d3v/reelmdrama/releases/download/${encodeURIComponent(tag)}/${ASSET}`)return result;
 // Release labels only inform the UI. Native archive versionCode/signature decide install eligibility.
 if(tag.replace(/^v/,'')===versionName)return {status:'current',candidate:null,releaseTag:tag};
 return {status:'available',releaseTag:tag,candidate:{releaseTag:tag,assetName:ASSET,url:url.href,bytes:asset.size as number,sha256:asset.digest.slice(7).toLowerCase()}};
}
export async function checkForUpdate(signal:AbortSignal):Promise<UpdateCheck>{
 if(signal.aborted)throw Error('UPDATE_CANCELLED');
 const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
 let expired=false;const timer=setTimeout(()=>{expired=true;controller.abort();},15000);
 try{
  const installed=await cancellable(native.reelmGetInstalledVersion(),controller.signal);
  let url=LATEST;
  for(let redirects=0;redirects<=5;redirects++){
   approvedURL(url);
   const response=await cancellable(expoFetch(url,{method:'GET',credentials:'omit',redirect:'manual',signal:controller.signal,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'}}),controller.signal);
   if(response.redirected||response.url&&response.url!==url)throw Error('UPDATE_REDIRECT');
   if([301,302,303,307,308].includes(response.status)){
    const location=response.headers.get('location');void response.body?.cancel().catch(()=>{});
    if(!location||redirects===5)throw Error('UPDATE_REDIRECT');
    url=approvedURL(new URL(location,url).href).href;continue;
   }
   if(response.status===404)return lastCheck={status:'current',candidate:null,releaseTag:null,checkedAt:Date.now()};
   if(!response.ok)throw Error('UPDATE_HTTP_'+response.status);
   const result=select(await metadata(response,controller.signal),installed.versionName);
   return lastCheck={...result,checkedAt:Date.now()};
  }
  throw Error('UPDATE_REDIRECT');
 }catch(error){
  if(controller.signal.aborted)throw Error(expired?'UPDATE_CHECK_TIMEOUT':'UPDATE_CANCELLED');
  if(error instanceof Error&&/^UPDATE_/.test(error.message))throw error;
  throw Error('UPDATE_NETWORK');
 }finally{controller.abort();clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
