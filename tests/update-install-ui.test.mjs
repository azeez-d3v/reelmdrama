import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('installer UI probe is pilot-only and delegates to the ordinary app button, never OS confirmation',()=>{
 const runner=new URL('../scripts/Run-AndroidChecks.mjs',import.meta.url);
 const denied=spawnSync(process.execPath,[fileURLToPath(runner),'--serial','fixture','--package','org.reelm.drama','--suite','install-ui'],{encoding:'utf8',windowsHide:true});
 assert.notEqual(denied.status,0);
 assert.match(denied.stderr,/Install UI requires isolated pilot/);
 const source=fs.readFileSync(new URL('android/OwnActivityProbe.java',import.meta.url),'utf8');
 assert.match(source,/"install-ui"\.equals\(suite\)\)\{openUpdateInstall\(\);completed=true;/);
 const body=source.slice(source.indexOf('private void openUpdateInstall()'),source.indexOf('private void updateContinuity('));
 assert.match(body,/TARGET\.equals\("org\.reelm\.drama\.pilot"\)/);
 assert.match(body,/"verified"\.equals/);
 assert.match(body,/uiClick\("Install verified APK with Android confirmation"\)/);
 assert.match(body,/librarySHA256/);
 assert.doesNotMatch(body,/\.install\(|\.invoke\([^;]*install|ACTION_INSTALL_PACKAGE|\.commit\(|cancel|setSetting|injectInputEvent/i);
});

test('controlled preference probe is isolated, validates supported sizes and uses the normal Settings action',()=>{
 const runner=new URL('../scripts/Run-AndroidChecks.mjs',import.meta.url);
 const denied=spawnSync(process.execPath,[fileURLToPath(runner),'--serial','fixture','--package','org.reelm.drama','--suite','preferences'],{encoding:'utf8',windowsHide:true});
 assert.notEqual(denied.status,0);assert.match(denied.stderr,/Preferences require isolated pilot/);
 for(const font of ['99','130foo']){const invalid=spawnSync(process.execPath,[fileURLToPath(runner),'--serial','fixture','--package','org.reelm.drama.pilot','--suite','preferences','--font',font],{encoding:'utf8',windowsHide:true});assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/Unsupported text size/);}
 const source=fs.readFileSync(new URL('android/OwnActivityProbe.java',import.meta.url),'utf8');
 assert.match(source,/"preferences"\.equals\(suite\)/);
 assert.match(source,/uiClick\("Subtitle size "\+fontPercent\+" percent"\)/);
 assert.match(source,/PERSISTED_FONT_REQUIRED/);
});

test('continuity failure emits bounded observed fields before strict comparison and never recreates missing key fixtures',()=>{
 const source=fs.readFileSync(new URL('android/OwnActivityProbe.java',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('private void updateContinuity('),source.indexOf('private JSONObject library()'));
 assert.match(body,/CONTINUITY_INPUTS_REQUIRED/);
 assert(body.indexOf('CONTINUITY_INPUTS_REQUIRED')<body.indexOf('readContinuityFixture(root,id,resource)'));
 assert.doesNotMatch(source,/ReelmFileCrypto|generator\.generateKey\(|newInstance\(root,TARGET/);
 assert.match(body,/stage\("update-observed","READ_ONLY_POST_UPDATE_FIELDS"/);
 assert(body.indexOf('READ_ONLY_POST_UPDATE_FIELDS')<body.indexOf('UPDATE_PRESERVE_'));
 assert.match(body,/"savedCount"/);
 assert.match(body,/"recentCount"/);
});

test('staging the next candidate requires a pilot and exclusive validated update flag',()=>{
 const runner=fileURLToPath(new URL('../scripts/Run-AndroidChecks.mjs',import.meta.url));
 for(const [target,extra,expected] of [['org.reelm.drama',[],/Upgrade actions require isolated pilot/],['org.reelm.drama.pilot',['--verify-upgrade','1'],/Choose one upgrade action/],['org.reelm.drama.pilot',['--stage-candidate','2'],/Upgrade flags require value 1/]]){
  const result=spawnSync(process.execPath,[runner,'--serial','fixture','--package',target,'--suite','updates','--stage-candidate','1',...extra],{encoding:'utf8',windowsHide:true});assert.notEqual(result.status,0);assert.match(result.stderr,expected);
 }
});

test('continuity checkpoint input is pilot-only and accepts only five bounded observed fields',()=>{
 const runner=fileURLToPath(new URL('../scripts/Run-AndroidChecks.mjs',import.meta.url));
 const denied=spawnSync(process.execPath,[runner,'--serial','fixture','--package','org.reelm.drama','--suite','updates','--continuity-json','fixture'],{encoding:'utf8',windowsHide:true});assert.notEqual(denied.status,0);assert.match(denied.stderr,/Continuity input requires isolated pilot/);
 const fixture=new URL('../.local/drama2/app-updates/continuity/invalid-checkpoint.fixture',import.meta.url);
 assert.equal(fs.existsSync(fixture),false,'Existing checkpoint fixture retained');
 fs.mkdirSync(new URL('./',fixture),{recursive:true});
 try{
 for(const value of [{fontScale:1.3,token:'unexpected'},{fontScale:1.3,librarySHA256:['a'.repeat(64)],keyIdSHA256:'b'.repeat(64),ciphertextSHA256:'c'.repeat(64),plaintextSHA256:'d'.repeat(64)}]){
  fs.writeFileSync(fixture,JSON.stringify(value));
  const invalid=spawnSync(process.execPath,[runner,'--serial','fixture','--package','org.reelm.drama.pilot','--suite','updates','--verify-upgrade','1','--continuity-json',fileURLToPath(fixture)],{encoding:'utf8',windowsHide:true});assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/Invalid continuity checkpoint/);
 }
 }finally{fs.unlinkSync(fixture);}
});

test('preference checkpoint cannot replace the original encrypted continuity fields',()=>{
 const source=fs.readFileSync(new URL('android/OwnActivityProbe.java',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('private void updateContinuity('),source.indexOf('private JSONObject library()'));
 assert.match(body,/JSONObject original=new JSONObject\(new String\(java\.nio\.file\.Files\.readAllBytes\(receipt\.toPath\(\)\)/);
 assert.match(body,/new String\[\]\{"keyIdSHA256","ciphertextSHA256","plaintextSHA256"\}\)require\(before\.getString\(key\)\.equals\(original\.getString\(key\)\),"ORIGINAL_CRYPTO_CHECKPOINT_REQUIRED"\)/);
 const stage=body.slice(body.indexOf('private void stageUpdateCandidate()'));
 assert.doesNotMatch(stage,/sha\(library\(\)\.toString/);
});
