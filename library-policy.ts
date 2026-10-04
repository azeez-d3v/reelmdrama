import {parseCard} from './services/source.ts';
import type {DramaCard} from './services/types.ts';
export type WatchProgress={slug:string;episode:number;time:number;updatedAt:number};
export type Library={saved:DramaCard[];liked:string[];progress:Record<string,WatchProgress>};
export const emptyLibrary=():Library=>({saved:[],liked:[],progress:{}});
export function boundedProgress(value:Record<string,WatchProgress>){return Object.fromEntries(Object.entries(value).sort((a,b)=>b[1].updatedAt-a[1].updatedAt).slice(0,300));}
export function normalizeLibrary(value:unknown):Library{
 if(!value||typeof value!=='object'||Array.isArray(value))return emptyLibrary();const v=value as Record<string,unknown>;
 const saved:DramaCard[]=[];const seen=new Set<string>();
 if(Array.isArray(v.saved))for(const x of v.saved){try{if(!x||x.catalogueLanguage!=='en')continue;const card=parseCard({id:x.id,slug:x.slug,title:x.title,platform:x.platform,cover:x.cover,total_episodes:x.totalEpisodes,available_episodes:x.availableEpisodes,is_new:x.isNew,is_popular:x.isPopular,language:'en'});if(!seen.has(card.id)){saved.push(card);seen.add(card.id);}if(saved.length===300)break;}catch{}}
 const liked=Array.isArray(v.liked)?[...new Set(v.liked.filter((x:unknown)=>typeof x==='string'&&/^[1-9]\d{0,9}$/.test(x)))].slice(0,300) as string[]:[];
 const progress:Record<string,WatchProgress>={};if(v.progress&&typeof v.progress==='object')for(const[k,x]of Object.entries(v.progress)){const p=x as WatchProgress;if(p&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,239}$/.test(k)&&p.slug===k&&Number.isInteger(p.episode)&&p.episode>0&&p.episode<=5000&&Number.isFinite(p.time)&&p.time>=0&&p.time<=86400&&Number.isFinite(p.updatedAt)&&p.updatedAt>=0)progress[k]={slug:k,episode:p.episode,time:p.time,updatedAt:p.updatedAt};}
 return{saved,liked,progress:boundedProgress(progress)};
}
