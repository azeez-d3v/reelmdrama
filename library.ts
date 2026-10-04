import {File,Paths} from 'expo-file-system';
import {normalizeLibrary,emptyLibrary,type Library} from './library-policy';
export type {Library,WatchProgress} from './library-policy';
const file=()=>new File(Paths.document,'reelm-drama-library.json');
let writing:Promise<unknown>=Promise.resolve();
export async function readLibrary():Promise<Library>{try{const f=file();if(!f.exists)return emptyLibrary();const raw=await f.text();if(raw.length>524288)return emptyLibrary();return normalizeLibrary(JSON.parse(raw));}catch{return emptyLibrary();}}
export function writeLibrary(value:Library){const body=JSON.stringify(normalizeLibrary(value));writing=writing.catch(()=>{}).then(()=>{const f=file();f.create({overwrite:true});f.write(body);}).catch(()=>{});}
