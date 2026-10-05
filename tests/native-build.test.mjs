import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
test('native data composition preserves stock streaming and reverses historical offline routes', () => {
  const {composeDataSource, baselineDataSource, hash} = require('../plugins/withReelmNative.cjs');
  const stock = fs.readFileSync(path.join(root, 'node_modules/expo-video/android/src/main/java/expo/modules/video/utils/DataSourceUtils.kt'), 'utf8');
  const observer = fs.readFileSync(path.join(root, 'tests/fixtures/native-observer/DataSourceUtils.MODIFIED.kt'), 'utf8');
  for (const [base, e2e] of [[stock, false], [observer, true]]) {
    const product = composeDataSource(base, e2e);
    assert.equal(composeDataSource(product, e2e), product);
    assert.equal(baselineDataSource(product), base);
    assert.equal(product,base);
    assert.doesNotMatch(product,/ReelmEncryptedDataSource|reelm-offline/);
    const historical=base.replace('  val dataSourceFactory = if (videoSource.useCaching) {',`  val dataSourceFactory = if (videoSource.uri?.scheme == "reelm-offline") {\n    ReelmEncryptedDataSource.Factory(context${e2e?', NativeProbeTransferListener()':''})\n  } else if (videoSource.useCaching) {`);
    assert.equal(composeDataSource(historical,e2e),base);
    assert.throws(() => composeDataSource(product + '\n// unknown', e2e), /Unknown/);
  }
  assert.equal(hash(baselineDataSource(composeDataSource(observer, true))), hash(observer));
  assert.throws(() => composeDataSource(observer, false), /mode/);
  assert.throws(() => composeDataSource(stock, true), /mode/);
});
test('hidden lock omits root and platform-excluded optional packages', () => {
  const {dependenciesMatch} = require('../plugins/withReelmNative.cjs');
  const locked = {packages: {'': {version: '1'}, 'node_modules/a': {version: '1', integrity: 'hash'}, 'node_modules/fsevents': {version: '2', optional: true, os: ['darwin']}}};
  const hidden = {packages: {'node_modules/a': {version: '1', integrity: 'hash'}}};
  assert.equal(dependenciesMatch(locked, hidden, () => true, 'win32'), true);
  assert.equal(dependenciesMatch(locked, hidden, () => false, 'win32'), false);
  assert.equal(dependenciesMatch(locked, hidden, () => true, 'darwin'), false);
  locked.packages['node_modules/arm-only'] = {version: '1', optional: true, os: ['win32'], cpu: ['arm64']};
  assert.equal(dependenciesMatch(locked, hidden, () => true, 'win32', 'x64'), true);
  assert.equal(dependenciesMatch(locked, hidden, () => true, 'win32', 'arm64'), false);
  hidden.packages['node_modules/a'].version = '2';
  assert.equal(dependenciesMatch(locked, hidden, () => true, 'win32'), false);
});
test('native product composition is idempotent and rejects unknown input', () => {
  const {compose} = require('../plugins/withReelmNative.cjs');
  const stock = fs.readFileSync(path.join(root, 'node_modules/expo-video/android/src/main/java/expo/modules/video/VideoModule.kt'), 'utf8');
  const modified = compose(stock);
  assert.equal(compose(modified), modified);
  assert.throws(() => compose(stock + '\n// unknown'), /Unknown/);
  assert.equal((modified.match(/OnDestroy/g) ?? []).length, 1);
  assert.match(modified, /finally \{ reelmBridge.destroy\(\) \}/);
  assert.equal((modified.match(/OnActivityEntersBackground/g) ?? []).length,1);
  assert.equal((modified.match(/OnActivityEntersForeground/g) ?? []).length,1);
  assert.match(modified,/VideoManager.onModuleCreated\(appContext\)\n      reelmBridge.retireDownloads\(appContext\)/);
  assert.doesNotMatch(modified,/setNativeDownloadsForeground|setDownloadsActive/);
});
test('deleted stage source is reconciled', () => {
  const build = fs.readFileSync(path.join(root, 'scripts/Build-Android.ps1'), 'utf8');
  assert.match(build, /source-inputs.json/);
  assert.match(build, /Remove-Item -LiteralPath/);
  assert.match(build, /package-lock/);
});
test('switching pilot identity invalidates only the recognized generated autolinking JSON', {skip:process.platform!=='win32'},()=>{
 const source=fs.readFileSync(path.join(root,'scripts/Build-Android.ps1'),'utf8');
 const reset=source.match(/# Refresh generated native identity;[^\r\n]*\r?\n([\s\S]*?)\r?\n \$gradle=/)?.[1];
 assert.ok(reset,'identity reset exists before Gradle');
 const result=spawnSync('pwsh',['-NoProfile','-Command',`
 $ErrorActionPreference='Stop';. '${path.join(root,'scripts/Signing.ps1').replaceAll("'","''")}';
 $build=Join-Path ([IO.Path]::GetTempPath()) ('reelm-autolink-'+[Guid]::NewGuid());$package='org.reelm.drama';
 $folder=Join-Path $build 'android/build/generated/autolinking';New-Item $folder -ItemType Directory -Force|Out-Null;
 $file=Join-Path $folder 'autolinking.json';$keep=Join-Path $folder 'unknown.txt';Set-Content $keep 'keep';
 try{
  @{root=$build;project=@{android=@{packageName='org.reelm.drama.pilot'}}}|ConvertTo-Json -Depth 5|Set-Content $file;
  ${reset}
  if(Test-Path $file){throw 'stale pilot retained'};if((Get-Content $keep)-ne 'keep'){throw 'unrelated removed'};
  @{root=$build;project=@{android=@{packageName=$package}}}|ConvertTo-Json -Depth 5|Set-Content $file;
  ${reset}
  if(!(Test-Path $file)){throw 'same identity removed'};
  @{root=$build;project=@{android=@{packageName='unknown.app'}}}|ConvertTo-Json -Depth 5|Set-Content $file;
  try{${reset};throw 'unknown accepted'}catch{if($_.Exception.Message -eq 'unknown accepted'){throw}};
  if(!(Test-Path $file)){throw 'unknown removed'};'AUTOLINK_IDENTITY_RESET_PASS'
 }finally{Remove-Item -LiteralPath $file,$keep -Force;Remove-Item -LiteralPath $folder;Remove-Item -LiteralPath (Split-Path $folder),(Join-Path $build 'android/build'),(Join-Path $build 'android'),$build}
 `],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/AUTOLINK_IDENTITY_RESET_PASS/);
});
test('actual source sync reconciles declared deletion and preserves unknown inputs', {skip: process.platform !== 'win32'}, t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'reelm-source-sync-'));
  const app = path.join(fixture, 'app'), stage = path.join(fixture, 'stage');
  fs.mkdirSync(app); fs.mkdirSync(stage);
  fs.writeFileSync(path.join(app, 'current.ts'), 'current');
  fs.writeFileSync(path.join(stage, 'current.ts'), 'stale');
  fs.writeFileSync(path.join(stage, 'removed.ts'), 'removed');
  fs.writeFileSync(path.join(stage, 'unknown.txt'), 'keep');
  fs.writeFileSync(path.join(stage, '.env'), 'keep-private-fixture');
  const sha256 = body => createHash('sha256').update(body).digest('hex');
  fs.writeFileSync(path.join(stage, 'source-inputs.json'), JSON.stringify([{path: 'current.ts', sha256: sha256('stale')}, {path: 'removed.ts', sha256: sha256('removed')}]));
  t.after(() => {
    for (const [directory, names] of [[app, ['current.ts']], [stage, ['current.ts', 'removed.ts', 'unknown.txt', '.env', 'source-inputs.json']]]) {
      for (const name of names) if (fs.existsSync(path.join(directory, name))) fs.unlinkSync(path.join(directory, name));
      fs.rmdirSync(directory);
    }
    fs.rmdirSync(fixture);
  });
  const build = fs.readFileSync(path.join(root, 'scripts/Build-Android.ps1'), 'utf8');
  const block = build.slice(build.indexOf('$manifest='), build.indexOf('$environmentNames='));
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', `$ErrorActionPreference='Stop';$app=${quote(app)};$build=${quote(stage)};$Output=$null;${block}`], {encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(stage, 'current.ts'), 'utf8'), 'current');
  assert.equal(fs.existsSync(path.join(stage, 'removed.ts')), false);
  assert.equal(fs.readFileSync(path.join(stage, 'unknown.txt'), 'utf8'), 'keep');
  assert.equal(fs.readFileSync(path.join(stage, '.env'), 'utf8'), 'keep-private-fixture');
  fs.writeFileSync(path.join(stage, 'removed.ts'), 'stage-edited');
  fs.writeFileSync(path.join(stage, 'source-inputs.json'), JSON.stringify([{path: 'removed.ts', sha256: '0'.repeat(64)}]));
  const changed = spawnSync('pwsh', ['-NoProfile', '-Command', `$ErrorActionPreference='Stop';$app=${quote(app)};$build=${quote(stage)};$Output=$null;${block}`], {encoding: 'utf8', windowsHide: true});
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /Changed deleted stage input; preserved/);
  assert.equal(fs.readFileSync(path.join(stage, 'removed.ts'), 'utf8'), 'stage-edited');
  fs.writeFileSync(path.join(stage, 'source-inputs.json'), JSON.stringify(['removed.ts']));
  const legacy = spawnSync('pwsh', ['-NoProfile', '-Command', `$ErrorActionPreference='Stop';$app=${quote(app)};$build=${quote(stage)};$Output=$null;${block}`], {encoding: 'utf8', windowsHide: true});
  assert.notEqual(legacy.status, 0);
  assert.match(legacy.stderr, /Unhashed stale stage input; preserved/);
  assert.equal(fs.readFileSync(path.join(stage, 'removed.ts'), 'utf8'), 'stage-edited');
});
test('Release removes observer but retains product', () => {
  const {sourceNames} = require('../plugins/withReelmNative.cjs');
  assert.deepEqual(sourceNames(false), ['ReelmVideoBridge.kt', 'ReelmLibraryStore.kt', 'ReelmDownloadRetirement.kt', 'ReelmApkUpdater.kt', 'ReelmLibraryTransfer.kt']);
  assert.deepEqual(sourceNames(true), [...sourceNames(false), 'ReelmNativeChecks.kt']);
  const prepare = fs.readFileSync(path.join(root, 'scripts/prepare-reelm-native.mjs'), 'utf8');
  assert.match(prepare, /8ffd704064677f8862f093b43a14c20584c6235b9602384979a0e5498cb943ee/);
  assert.match(prepare, /6b13ffee57e97c915933d0c5b3df38d30660276650bb90657cf18a2366fcfba7/);
});
test('real native composition round trip removes only recognized E2E source', t => {
  const {inject, hash, sourceNames} = require('../plugins/withReelmNative.cjs');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'reelm-native-check-'));
  const directory = path.join(fixture, 'node_modules/expo-video/android/src/main/java/expo/modules/video');
  t.after(() => {
    // Only this tiny fixture's explicitly written files; never recursive removal.
    const files = ['.reelm-native.json', '.reelm-stock-data-source.kt', ...['ReelmFileCrypto.kt','ReelmDownloadStore.kt','ReelmEncryptedDataSource.kt'].map(name=>path.relative(fixture,path.join(directory,name))), 'node_modules/expo-video/package.json', ...sourceNames(false).map(name => `native/android/${name}`), 'tests/android/ReelmNativeChecks.kt'];
    files.push(path.relative(fixture, path.join(directory, 'utils/DataSourceUtils.kt')));
    files.push(...['VideoModule.kt', 'ReelmBuildConfig.kt', ...sourceNames(true)].map(name => path.relative(fixture, path.join(directory, name))));
    for (const file of files) if (fs.existsSync(path.join(fixture, file))) fs.unlinkSync(path.join(fixture, file));
    const dirs = new Set(files.flatMap(file => {
      const rows = []; let parent = path.dirname(path.join(fixture, file));
      while (parent !== fixture) { rows.push(parent); parent = path.dirname(parent); }
      return rows;
    }));
    for (const dir of [...dirs].sort((a,b) => b.length-a.length)) fs.rmdirSync(dir);
    fs.rmdirSync(fixture);
  });
  fs.mkdirSync(directory, {recursive: true});
  fs.mkdirSync(path.join(directory, 'utils'));
  fs.mkdirSync(path.join(fixture, 'native/android'), {recursive: true});
  fs.mkdirSync(path.join(fixture, 'tests/android'), {recursive: true});
  fs.writeFileSync(path.join(fixture, 'node_modules/expo-video/package.json'), JSON.stringify({version: '55.0.21'}));
  const stock = fs.readFileSync(path.join(root, 'node_modules/expo-video/android/src/main/java/expo/modules/video/VideoModule.kt'));
  fs.writeFileSync(path.join(directory, 'VideoModule.kt'), stock);
  const dataFile = path.join(directory, 'utils/DataSourceUtils.kt');
  const stockData = fs.readFileSync(path.join(root, 'node_modules/expo-video/android/src/main/java/expo/modules/video/utils/DataSourceUtils.kt'));
  fs.writeFileSync(dataFile, stockData);
  for (const name of sourceNames(true)) {
    const input = name === 'ReelmNativeChecks.kt' ? 'tests/android' : 'native/android';
    fs.copyFileSync(path.join(root, input, name), path.join(fixture, input, name));
  }
  const reset = () => spawnSync(process.execPath, [path.join(root, 'scripts/prepare-reelm-native.mjs')], {cwd: fixture, encoding: 'utf8', windowsHide: true});
  assert.equal(reset().status, 0);
  assert.throws(() => inject(fixture, true), /mode/);
  const observer = fs.readFileSync(path.join(root, 'tests/fixtures/native-observer/DataSourceUtils.MODIFIED.kt'));
  fs.writeFileSync(dataFile, observer);
  inject(fixture, true);
  const composed = hash(fs.readFileSync(path.join(directory, 'VideoModule.kt')));
  inject(fixture, true);
  assert.equal(hash(fs.readFileSync(path.join(directory, 'VideoModule.kt'))), composed);
  assert.throws(() => inject(fixture, false), /mode/);
  assert.equal(reset().status, 0);
  assert.equal(hash(fs.readFileSync(dataFile)), hash(stockData));
  inject(fixture, false);
  assert.equal(fs.existsSync(path.join(directory, 'ReelmNativeChecks.kt')), false);
  assert.equal(fs.existsSync(path.join(directory, 'ReelmLibraryStore.kt')), true);
  assert.equal(reset().status, 0);
  assert.equal(hash(fs.readFileSync(dataFile)), hash(stockData));
  fs.copyFileSync(path.join(root, 'tests/fixtures/native-observer/DataSourceUtils.MODIFIED.kt'), dataFile);
  assert.equal(reset().status, 0);
  assert.equal(hash(fs.readFileSync(dataFile)), hash(stockData));
  inject(fixture, false);
  const obsolete=path.join(directory,'ReelmDownloadStore.kt');
  fs.writeFileSync(obsolete,'recognized previous injection');
  const receiptFile=path.join(fixture,'.reelm-native.json');
  const receipt=JSON.parse(fs.readFileSync(receiptFile));receipt.inputs['ReelmDownloadStore.kt']=hash(fs.readFileSync(obsolete));fs.writeFileSync(receiptFile,JSON.stringify(receipt));
  inject(fixture,false);assert.equal(fs.existsSync(obsolete),false);
  fs.writeFileSync(obsolete,'unknown previous injection');
  assert.throws(()=>inject(fixture,false),/Unknown retired source/);assert.equal(fs.readFileSync(obsolete,'utf8'),'unknown previous injection');
  fs.unlinkSync(obsolete);
  fs.appendFileSync(dataFile, '\n// unknown');
  assert.throws(() => inject(fixture, false), /Unknown DataSourceUtils/);
  fs.writeFileSync(dataFile, stockData);
  fs.appendFileSync(path.join(directory, 'VideoModule.kt'), '\n// unknown');
  assert.throws(() => inject(fixture, false), /Unknown/);
});
