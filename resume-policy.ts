import type {PlayerSnapshot} from './player';
export function clampResumeTime(time:number,duration:number):number{return Number.isFinite(time)&&time>=0&&Number.isFinite(duration)&&duration>0?Math.min(time,Math.max(0,duration-.2)):0;}
export function resumeSeekObserved(target:number,position:number):boolean{return Number.isFinite(target)&&target>=0&&Number.isFinite(position)&&position>=0&&!(target>0&&position===0)&&Math.abs(target-position)<=1;}
export function canSaveProgress(s:PlayerSnapshot,loadId:string):boolean{return s.loadId===loadId&&!s.resumePending&&s.sourceLoadSeen&&s.status==='readyToPlay'&&Number.isFinite(s.time)&&s.time>=0&&Number.isFinite(s.duration)&&s.duration>0;}
