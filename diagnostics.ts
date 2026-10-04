import {sha256} from './sha256';
export const E2E_ENABLED=process.env.EXPO_PUBLIC_E2E==='1';
const SINK='http://127.0.0.1:4399/events';
let runId='integration-default',sequence=0,sending=false;
const queue:Record<string,unknown>[]=[];
export function setTestRun(value:string){if(E2E_ENABLED&&/^[A-Za-z0-9_-]{1,100}$/.test(value))runId=value;}
export function getTestRun(){return runId;}
function clean(value:unknown,key='',depth=0):unknown{
 if(depth>7)return null;
 if(/cookie|authorization|headers|token|password|manifestBody|SubtitleCues|uri$/i.test(key))return '[omitted]';
 if(typeof value==='string')return /^https?:|^file:/i.test(value)?{sha256:sha256(value)}:value.slice(0,400);
 if(typeof value==='number')return Number.isFinite(value)?value:0;
 if(typeof value==='boolean'||value===null)return value;
 if(Array.isArray(value))return value.slice(0,128).map(x=>clean(x,key,depth+1));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clean(v,k,depth+1)]));
 return null;
}
export function record(event:string,fields:Record<string,unknown>={}){
 if(!E2E_ENABLED)return;
 const captured=typeof fields.runId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(fields.runId)?fields.runId:runId;
 queue.push({...clean(fields) as object,runId:captured,event,sequence:++sequence,timestamp:new Date().toISOString()});
 if(queue.length>512)queue.shift();void flush();
}
async function flush(){
 if(sending||!queue.length)return;sending=true;
 const batch=queue.slice(0,12),ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),2000);
 try{const r=await fetch(SINK,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:batch}),signal:ctrl.signal});if(r.ok)queue.splice(0,batch.length);}catch{}finally{clearTimeout(timer);sending=false;}
}
export function startDiagnostics(){if(!E2E_ENABLED)return()=>{};const timer=setInterval(()=>void flush(),700);return()=>clearInterval(timer);}
export async function testCommands(after:number){if(!E2E_ENABLED)return [];const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),1800),captured=runId;try{const r=await fetch('http://127.0.0.1:4399/api/command?runId='+captured+'&after='+after,{signal:ctrl.signal});const v=await r.json();return captured===runId&&Array.isArray(v.commands)?v.commands:[];}catch{return [];}finally{clearTimeout(timer);}}
