import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const obsolete=['ReelmFileCrypto.kt','ReelmDownloadStore.kt','ReelmEncryptedDataSource.kt'];
test('native product retains streaming, updater and library without offline episode APIs',()=>{
 const {sourceNames,composeDataSource}=require('../plugins/withReelmNative.cjs');
 for(const name of obsolete)assert(!sourceNames(false).includes(name));
 for(const name of ['ReelmVideoBridge.kt','ReelmLibraryStore.kt','ReelmLibraryTransfer.kt','ReelmApkUpdater.kt','ReelmDownloadRetirement.kt'])assert(sourceNames(false).includes(name));
 const stock=read('node_modules/expo-video/android/src/main/java/expo/modules/video/utils/DataSourceUtils.kt');
 assert.doesNotMatch(composeDataSource(stock,false),/reelm-offline|ReelmEncryptedDataSource/);
 assert.doesNotMatch(read('native/android/ReelmVideoBridge.kt'),/AsyncFunction\("reelm(?:ListDownloads|EnqueueDownloads|AcquireOffline|StartDownload)/);
 for(const name of ['reelmReadLibraryJson','reelmExportLibrary','reelmDownloadUpdate','reelmInstallVerifiedUpdate'])assert(read('native/android/ReelmVideoBridge.kt').includes(name));
 assert(read('native/android/ReelmVideoBridge.kt').includes('ReelmDownloadRetirement.retire'));
});
test('stale injected offline sources retire only against the prior receipt and preserve unknown files',()=>{
 const {retiredSources,hash}=require('../plugins/withReelmNative.cjs');
 assert.equal(typeof retiredSources,'function');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'reelm-retired-native-'));
 try{
  const file=path.join(dir,obsolete[0]);fs.writeFileSync(file,'recognized');
  assert.deepEqual(retiredSources(dir,{inputs:{[obsolete[0]]:hash('recognized')}}),[file]);
  assert(fs.existsSync(file),'validation itself never deletes');
  fs.writeFileSync(file,'unknown');assert.throws(()=>retiredSources(dir,{inputs:{[obsolete[0]]:hash('recognized')}}),/Unknown retired source/);
  assert.equal(fs.readFileSync(file,'utf8'),'unknown');
  assert.throws(()=>retiredSources(dir,null),/Unknown retired source/);
 }finally{for(const name of obsolete){const file=path.join(dir,name);if(fs.existsSync(file))fs.unlinkSync(file);}fs.rmdirSync(dir);}
});
test('retirement uses an exact flat owned root and key alias, never recursive parent cleanup',()=>{
 const source=read('native/android/ReelmDownloadRetirement.kt');
 assert.match(source,/File\(context\.noBackupFilesDir, "reelmDownloads"\)/);
 assert.match(source,/context\.packageName \+ "\.reelm\.downloads\."/);
 assert.match(source,/S_ISREG/);assert.match(source,/canonicalFile/);assert.match(source,/RETIREMENT_UNKNOWN_FILE/);
 assert.doesNotMatch(source,/deleteRecursively|reelmUpdates|reelm-drama-library|aliases\(/);
 assert(source.indexOf('RETIREMENT_UNKNOWN_FILE')<source.indexOf('file.delete()'));
});
