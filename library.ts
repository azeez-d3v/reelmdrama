import {native} from './native';
import {normalizeLibrary,emptyLibrary,type Library} from './library-policy';
export type {Library,WatchProgress,PlaybackPreferences} from './library-policy';
const MAX_BYTES=2097152;
// Counting encoded bytes also works on RN runtimes without TextEncoder.
export function utf8Bytes(value:string){let n=0;for(let i=0;i<value.length;i++){const x=value.codePointAt(i)!;n+=x<=127?1:x<=2047?2:x<=65535?3:4;if(x>65535)i++;}return n;}
let writing:Promise<void>=Promise.resolve(),revision=0;
export async function readLibrary():Promise<Library>{const raw=await native.reelmReadLibraryJson();if(raw===null)return emptyLibrary();if(utf8Bytes(raw)>MAX_BYTES)throw Error('Library exceeds 2 MiB. Original retained.');try{return normalizeLibrary(JSON.parse(raw));}catch{throw Error('Library could not be read. Original retained; retry or explicitly save new changes.');}}
export function writeLibrary(value:Library):Promise<void>{const body=JSON.stringify(normalizeLibrary(value));if(utf8Bytes(body)>MAX_BYTES)return Promise.reject(Error('Library exceeds 2 MiB. Remove some entries and retry.'));revision++;const next=writing.catch(()=>{}).then(()=>native.reelmWriteLibraryJsonAtomic(body));writing=next;return next;}
export function flushLibrary():Promise<void>{return writing;}

const unicode=(value:string)=>!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
function identical(value:unknown,normalized:unknown):boolean{
 if(typeof value==='string')return value===normalized&&unicode(value);
 if(value===null||typeof value!=='object')return Object.is(value,normalized);
 if(!normalized||typeof normalized!=='object'||Array.isArray(value)!==Array.isArray(normalized))return false;
 const keys=Object.keys(value),other=normalized as Record<string,unknown>;
 return keys.length===Object.keys(other).length&&keys.every(key=>Object.prototype.hasOwnProperty.call(other,key)&&identical((value as Record<string,unknown>)[key],other[key]));
}
export function parseLibraryTransfer(body:string):Library{
 try{
  if(typeof body!=='string'||!unicode(body)||utf8Bytes(body)>MAX_BYTES)throw Error();
  const doc=JSON.parse(body);if(!doc||typeof doc!=='object'||Array.isArray(doc)||Object.keys(doc).length!==3||!Object.keys(doc).every(key=>['format','version','library'].includes(key))||doc.format!=='reelm-drama-library'||doc.version!==1)throw Error();
  const library=normalizeLibrary(doc.library);if(!identical(doc.library,library))throw Error();return library;
 }catch{throw Error('Library transfer is invalid. Current library retained.');}
}
export function serializeLibraryTransfer(value:Library):string{
 const library=normalizeLibrary(value),body=JSON.stringify({format:'reelm-drama-library',version:1,library});
 if(!identical(library,parseLibraryTransfer(body)))throw Error('Library transfer roundtrip failed. Current library retained.');return body;
}
export async function exportLibrary(value:Library):Promise<boolean>{
 const body=serializeLibraryTransfer(value),start=revision;await flushLibrary();
 if(start!==revision)throw Error('Library changed during transfer. Please try again.');
 const exported=await native.reelmExportLibrary(body);if(exported&&start!==revision)throw Error('Library changed during transfer. Please export the current library again.');return exported;
}
export async function importLibrary():Promise<Library|null>{
 const start=revision,body=await native.reelmImportLibrary();if(body===null)return null;
 const library=parseLibraryTransfer(body);if(start!==revision)throw Error('Library changed during transfer. Current library retained; please try again.');
 const persisted=writeLibrary(library),expected=revision;await persisted;
 if(expected!==revision)throw Error('Library changed during transfer. Newer changes retained; please try again.');return library;
}
