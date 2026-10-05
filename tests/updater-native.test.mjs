import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('updater native trust and installer are product code, not diagnostic bypasses',()=>{
 const text=fs.readFileSync(new URL('../native/android/ReelmApkUpdater.kt',import.meta.url),'utf8');
 for(const code of ['UPDATE_PACKAGE','UPDATE_SIGNER','UPDATE_DOWNGRADE','UPDATE_DIGEST','UPDATE_SIZE','UPDATE_REDIRECT','UPDATE_PERMISSION_REQUIRED'])assert.ok(text.includes(code),code);
 assert.ok(text.includes('apkContentsSigners'));
 assert.ok(!text.includes('signingCertificateHistory'));
 assert.ok(text.includes('PackageInstaller.SessionParams'));
 assert.ok(text.includes('STATUS_PENDING_USER_ACTION'));
 assert.ok(text.includes('canRequestPackageInstalls'));
 const {sourceNames}=require('../plugins/withReelmNative.cjs');
 assert.ok(sourceNames(false).includes('ReelmApkUpdater.kt'));
});
test('consumer links follow the exact built scheme without opening the other app identity',()=>{
 const text=fs.readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
 const condition=text.match(/const u=new URL\(url\);if\((.+?)\)return;/)?.[1];
 assert.ok(condition,'consumer scheme guard exists');
 const rejected=new Function('u','Linking',`return ${condition}`);
 for(const scheme of ['reelm-drama','reelm-drama-pilot']){
  const linking={resolveScheme:()=>scheme};
  assert.equal(rejected(new URL(scheme+'://watch?slug=test'),linking),false,scheme);
  for(const other of ['https','reelm-drama','reelm-drama-pilot'].filter(x=>x!==scheme))assert.equal(rejected(new URL(other+'://watch?slug=test'),linking),true,other);
 }
});
test('release continuity evidence includes installed code and excludes the native E2E checker',()=>{
 const helper=fs.readFileSync(new URL('./android/OwnActivityProbe.java',import.meta.url),'utf8');
 assert.ok(helper.includes('RELEASE_NATIVE_CHECKER_MUST_BE_ABSENT'));
 assert.ok(helper.includes('installedVersionCode'));
});
