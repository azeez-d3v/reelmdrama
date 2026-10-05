import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn, spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = Object.fromEntries(process.argv.slice(2).reduce((rows, value, i, args) => {
  if (i % 2 === 0) {assert(value.startsWith('--') && args[i + 1], 'Expected --name value'); rows.push([value.slice(2), args[i + 1]]);} return rows;
}, []));
const serial = options.serial, target = options.package, suite = options.suite;
assert(/^[A-Za-z0-9_-]+$/.test(serial ?? ''), 'Explicit serial required');
assert(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(target ?? ''), 'Exact package required');
assert(['baseline', 'player', 'settings', 'resume', 'episode', 'simplification', 'update-feed', 'install-ui', 'preferences', 'library', 'migration', 'updates'].includes(suite), 'Unknown check suite');
assert(suite!=='install-ui'||target==='org.reelm.drama.pilot','Install UI requires isolated pilot');
assert(suite!=='preferences'||target==='org.reelm.drama.pilot','Preferences require isolated pilot');
const fontPercent=Number(options.font??130);assert([90,100,115,130].includes(fontPercent),'Unsupported text size');
assert(options['prepare-install']===undefined,'Continuity fixtures are immutable');
for(const option of ['verify-upgrade','stage-candidate'])assert(options[option]===undefined||options[option]==='1','Upgrade flags require value 1');
const verifyUpgrade=options['verify-upgrade']==='1',stageCandidate=options['stage-candidate']==='1';
assert((!verifyUpgrade&&!stageCandidate)||suite==='updates'&&target==='org.reelm.drama.pilot','Upgrade actions require isolated pilot');
assert(Number(verifyUpgrade)+Number(stageCandidate)<=1,'Choose one upgrade action');
assert(!stageCandidate||options['upgrade-apk'],'Staging requires exact higher-code APK');
let continuityJson='';
if(options['continuity-json']){
  assert(target==='org.reelm.drama.pilot'&&suite==='updates'&&(stageCandidate||verifyUpgrade),'Continuity input requires isolated pilot');
  const input=path.resolve(root,options['continuity-json']);assert(fs.statSync(input).size<=2048,'Invalid continuity checkpoint');
  let checkpoint;try{checkpoint=JSON.parse(fs.readFileSync(input,'utf8'));}catch{throw Error('Invalid continuity checkpoint');}
  const keys=['librarySHA256','keyIdSHA256','ciphertextSHA256','plaintextSHA256','fontScale'];
  assert(checkpoint&&Object.keys(checkpoint).length===5&&keys.every(k=>Object.hasOwn(checkpoint,k))&&keys.slice(0,4).every(k=>typeof checkpoint[k]==='string'&&/^[a-f0-9]{64}$/.test(checkpoint[k]))&&[.9,1,1.15,1.3].includes(checkpoint.fontScale),'Invalid continuity checkpoint');
  continuityJson=JSON.stringify(checkpoint);
}
const scheme = options.scheme ?? 'reelm-drama';
assert(/^[a-z][a-z0-9-]*$/.test(scheme), 'Invalid scheme');
const apk = path.resolve(root, options.apk), build = path.join(root, '.local/drama2/ui-probe');
const checks = path.join(root, '.local/drama2/checks'), receipts = [];
const sdk = options.sdk ?? process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
const adbExe = options.adb ?? (sdk ? path.join(sdk, 'platform-tools/adb.exe') : 'adb.exe');
const java = options.java ?? process.env.JAVA_HOME;
const signer = path.resolve(root, options.signer ?? '.local/drama2/android/app/debug.keystore');
const alias = options.alias ?? 'androiddebugkey';
assert(/^[A-Za-z0-9_-]+$/.test(alias), 'Invalid signer alias');
const passwordEnv = options['password-env'];
assert(!passwordEnv || /^[A-Za-z_][A-Za-z0-9_]*$/.test(passwordEnv), 'Invalid signer environment variable');
let signingPassword = passwordEnv ? process.env[passwordEnv] : null;
if (passwordEnv) {assert(signingPassword, 'Signer password environment absent'); delete process.env[passwordEnv];}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const source = path.join(root, 'tests/android/OwnActivityProbe.java');
const driverPackage = `${target}.uiprobe`, driverClass = 'org.reelm.drama.uiprobe.OwnActivityProbe';
const ordinal=Number(options.episode??20);assert(Number.isInteger(ordinal)&&ordinal>=1&&ordinal<=5000,'Invalid ordinal');
const uri = `${scheme}://${suite==='simplification'?'series':'watch'}?slug=${options.slug ?? 'after-rebirth-my-hushand-is-the-sea-god-netshort'}${suite==='resume'||suite==='simplification'?'':'&episode='+ordinal}`;
assert(/^[a-z0-9-]+$/.test(options.slug ?? 'after-rebirth-my-hushand-is-the-sea-god-netshort'), 'Invalid slug');
fs.mkdirSync(build, {recursive: true}); fs.mkdirSync(checks, {recursive: true});
const artifact = path.join(checks, `${suite}.json`);
const ownedApks=[];
const record = {suite, serial, target, apk, apkSHA256: hash(fs.readFileSync(apk)), sourceSHA256: hash(fs.readFileSync(source)), startedAt: new Date().toISOString(), receipts};
if(continuityJson)record.continuityCheckpointSHA256=hash(continuityJson);
function execute(exe, args, timeout = 120000, optional = false, env = process.env) {
  const result = spawnSync(exe, args, {windowsHide: true, encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024, env});
  receipts.push({exe, args, exit: result.status, output: result.stdout ?? '', error: result.stderr ?? '', errorCode: result.error?.code ?? null});
  if (!optional) assert.equal(result.status, 0, `Command failed: ${exe}`); return result.stdout ?? '';
}
const adb = args => execute(adbExe, ['-s', serial, ...args]);
function installed(packageName, optional = false) {
  const output = execute(adbExe, ['-s', serial, 'shell', 'pm', 'path', packageName], 120000, optional).trim();
  if (optional && !output) return null;
  assert(/^package:\/data\/app\/[A-Za-z0-9_./=+~-]+\/base\.apk$/.test(output), 'Expected one PM-bound APK');
  const file = output.slice(8), sha256 = adb(['shell', `sha256sum '${file}'`]).split(/\s/)[0];
  assert(/^[a-f0-9]{64}$/.test(sha256)); return {file, sha256};
}
const tools = path.join(sdk, 'build-tools/36.0.0'), androidJar = path.join(sdk, 'platforms/android-36/android.jar');
function certificate(file) {
  const output = execute('powershell.exe', ['-NoProfile', '-Command', `$env:JAVA_HOME=${quote(java)}; & ${quote(path.join(tools, 'apksigner.bat'))} verify --print-certs ${quote(file)}; exit $LASTEXITCODE`]);
  const digest = output.match(/Signer #1 certificate SHA-256 digest: ([a-f0-9]{64})/i)?.[1];
  assert(digest, 'Signer digest absent'); return digest.toLowerCase();
}
try {
  record.installedBefore = installed(target);
  assert.equal(record.installedBefore.sha256, record.apkSHA256, 'Supplied APK must match installed target; runner never installs target');
  record.targetCertificate = certificate(apk);
  for(const [option,name] of [['upgrade-apk','upgrade'],['legacy-apk','legacy']])if(options[option]){
    assert(suite==='updates'&&target==='org.reelm.drama.pilot','APK fixtures require update pilot suite');
    const input=path.resolve(root,options[option]);assert(fs.statSync(input).size<=268435456);
    if(name==='upgrade')assert.equal(certificate(input),record.targetCertificate,'Upgrade signer must match');
    const remote='/data/local/tmp/reelm-drama-'+name+'.apk',sha256=hash(fs.readFileSync(input));
    const found=execute(adbExe,['-s',serial,'shell','test','-e',remote],120000,true);
    if(receipts.at(-1).exit===0)assert.equal(adb(['shell','sha256sum',remote]).split(/\s/)[0],sha256,'Unknown remote fixture preserved');else adb(['push',input,remote]);
    assert.equal(adb(['shell','sha256sum',remote]).split(/\s/)[0],sha256);ownedApks.push({remote,sha256});
  }

  for (const file of [signer, androidJar, path.join(tools, 'aapt2.exe'), path.join(tools, 'd8.bat')]) assert(fs.existsSync(file), `Missing existing input ${file}`);
  const manifest = `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${driverPackage}"><uses-sdk android:minSdkVersion="24" android:targetSdkVersion="36"/><application android:label="Reelm player check" android:allowBackup="false" android:debuggable="true"/><instrumentation android:name="${driverClass}" android:targetPackage="${target}" android:targetProcesses="${target}" android:functionalTest="true"/></manifest>`;
  fs.writeFileSync(path.join(build, 'AndroidManifest.xml'), manifest);
  const pass = passwordEnv ? `env:${passwordEnv}` : 'pass:android';
  const buildScript = `$ErrorActionPreference='Stop'
$env:JAVA_HOME=${quote(java)}
$env:PATH="$env:JAVA_HOME\\bin;$env:PATH"
Set-Location -LiteralPath ${quote(build)}
New-Item -ItemType Directory -Path classes,dex -Force | Out-Null
& javac -encoding UTF-8 --release 8 -classpath ${quote(androidJar)} -d classes ${quote(source)}
if($LASTEXITCODE){throw 'javac failed'}
& jar cf probe-classes.jar -C classes .
if($LASTEXITCODE){throw 'jar failed'}
& ${quote(path.join(tools, 'd8.bat'))} --lib ${quote(androidJar)} --min-api 24 --output dex probe-classes.jar
if($LASTEXITCODE){throw 'd8 failed'}
& ${quote(path.join(tools, 'aapt2.exe'))} link --manifest AndroidManifest.xml -I ${quote(androidJar)} --min-sdk-version 24 --target-sdk-version 36 -o unsigned.apk
if($LASTEXITCODE){throw 'aapt2 failed'}
& jar uf unsigned.apk -C dex classes.dex
if($LASTEXITCODE){throw 'dex insertion failed'}
& ${quote(path.join(tools, 'zipalign.exe'))} -f 4 unsigned.apk aligned.apk
if($LASTEXITCODE){throw 'zipalign failed'}
Write-Output 'OWN_ACTIVITY_PROBE_COMPILE: PASS'
`;
  fs.writeFileSync(path.join(build, 'build.ps1'), buildScript);
  const driver = path.join(build, 'probe.apk'), bindingFile = path.join(build, 'binding.json');
  const inputs = {sourceSHA256: record.sourceSHA256, manifestSHA256: hash(manifest), targetCertificate: record.targetCertificate};
  const previous = fs.existsSync(bindingFile) ? JSON.parse(fs.readFileSync(bindingFile)) : null;
  const reusable = previous && Object.entries(inputs).every(([key, value]) => previous[key] === value) && fs.existsSync(driver) && previous.driverSHA256 === hash(fs.readFileSync(driver));
  if (!reusable) {
    execute('powershell.exe', ['-NoProfile', '-File', path.join(build, 'build.ps1')]);
    try {
      execute(path.join(java, 'bin/java.exe'), ['-jar', path.join(tools, 'lib/apksigner.jar'), 'sign', '--ks', signer, '--ks-key-alias', alias, '--ks-pass', pass, '--key-pass', pass, '--out', driver, path.join(build, 'aligned.apk')], 120000, false, passwordEnv ? {...process.env, [passwordEnv]: signingPassword} : process.env);
    } finally {signingPassword = null;}
  }
  signingPassword = null;
  record.driverSHA256 = hash(fs.readFileSync(driver));
  record.driverCertificate = certificate(driver);
  assert.equal(record.driverCertificate, record.targetCertificate, 'Target/helper signer mismatch');
  fs.writeFileSync(bindingFile, JSON.stringify({...inputs, driverSHA256: record.driverSHA256}, null, 2) + '\n');
  record.driverBefore = installed(driverPackage, true);
  if (record.driverBefore?.sha256 !== record.driverSHA256) adb(['install', '-r', driver]);
  record.driverAfter = installed(driverPackage); assert.equal(record.driverAfter.sha256, record.driverSHA256);
  if(options['upgrade-apk']){const remote='/data/local/tmp/reelm-drama-wrong.apk',sha256=record.driverSHA256;execute(adbExe,['-s',serial,'shell','test','-e',remote],120000,true);if(receipts.at(-1).exit===0)assert.equal(adb(['shell','sha256sum',remote]).split(/\s/)[0],sha256,'Unknown wrong-package fixture preserved');else adb(['push',driver,remote]);ownedApks.push({remote,sha256});}

  adb(['shell', 'am', 'force-stop', target]);
  const captureToken=randomUUID();
  const args = ['-s', serial, 'shell', 'am', 'instrument', '-w', '-e','captureToken',captureToken,'-e','continuityJson',quote(continuityJson),'-e','fontPercent',String(fontPercent),'-e','stageCandidate',stageCandidate?'1':'0','-e','verifyUpgrade',verifyUpgrade?'1':'0', '-e', 'targetPackage', target, '-e', 'consumerUri', `'${uri}'`, '-e', 'suite', suite, `${driverPackage}/${driverClass}`];
  const framework = {exe: adbExe, args, exit: null, output: '', error: ''}; receipts.push(framework);
  await new Promise((resolve, reject) => {
    const child = spawn(adbExe, args, {windowsHide: true}); let launched = false, resumed = false;
    const timer = setTimeout(() => {child.kill(); reject(new Error('INSTRUMENTATION_TIMEOUT'));}, suite==='simplification'?240000:150000);
    child.stdout.on('data', bytes => {
      framework.output += bytes.toString();
      if(suite==='simplification'||suite==='update-feed'){
        record.captures??=[];
        const stages=framework.output.split(/\r?\n/).filter(line=>line.startsWith('INSTRUMENTATION_STATUS: probeStage=')).map(line=>{try{return JSON.parse(line.slice('INSTRUMENTATION_STATUS: probeStage='.length));}catch{return null;}}).filter(row=>row?.stage?.startsWith(suite+'-'));
        for(const row of stages)if(!record.captures.some(c=>c.stage===row.stage)){
          try{const ownFocus=()=>adb(['shell','dumpsys','window']).split(/\r?\n/).find(line=>line.includes('mCurrentFocus'));assert(ownFocus()?.includes(`${target}/${target}.MainActivity`),'Own screenshot focus required');const png=spawnSync(adbExe,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true,timeout:12000,maxBuffer:8*1024*1024});assert.equal(png.status,0);assert.equal(png.stdout.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert(ownFocus()?.includes(`${target}/${target}.MainActivity`),'Own screenshot focus required');const file=path.join(checks,`${row.stage}.png`);fs.writeFileSync(file,png.stdout);record.captures.push({stage:row.stage,file,sha256:hash(png.stdout),bytes:png.stdout.length});}catch(error){record.captureFailure=error.message;}finally{try{adb(['shell','am','broadcast','-p',target,'-a',`${target}.uiprobe.capture`,'--es','token',captureToken,'--es','stage',row.stage]);}catch(error){record.captureFailure=error.message;}}
        }
      }
      if(suite==='resume'&&!resumed&&framework.output.includes('NATIVE_FILE_RETAINS32_BEFORE_TARGET_OBSERVED')){resumed=true;adb(['shell', `am start -W -n ${target}/.MainActivity -a android.intent.action.VIEW -d '${uri}'`]);}
      if(suite==='episode'&&!record.capture){
        const ready=framework.output.split(/\r?\n/).filter(line=>line.startsWith('INSTRUMENTATION_STATUS: probeStage=')).map(line=>{try{return JSON.parse(line.slice('INSTRUMENTATION_STATUS: probeStage='.length));}catch{return null;}}).find(row=>row?.stage==='episode-playing'&&row.dispatch?.playing&&row.dispatch?.positionMs>=2000&&row.dispatch?.renderedOutputBufferCount>0);
        if(ready){try{const ownFocus=()=>adb(['shell','dumpsys','window']).split(/\r?\n/).find(line=>line.includes('mCurrentFocus'));assert(ownFocus()?.includes(`${target}/${target}.MainActivity`),'Own screenshot focus required');const png=spawnSync(adbExe,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true,timeout:15000,maxBuffer:8*1024*1024});assert.equal(png.status,0);assert.equal(png.stdout.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert(ownFocus()?.includes(`${target}/${target}.MainActivity`));const file=path.join(checks,`episode-load-after-e${ordinal}.png`);fs.writeFileSync(file,png.stdout);record.capture={file,sha256:hash(png.stdout),bytes:png.stdout.length,nativeSample:ready.dispatch};}catch(error){record.captureFailure=error.message;}}
      }
      if (!launched && framework.output.includes('EXACT_OWN_ACTIVITY_MONITOR_ARMED')) {
        launched = true;
        const nativeSuite = !['baseline', 'player', 'settings', 'resume', 'episode'].includes(suite);
        try {adb(['shell', nativeSuite ? `am start -W -n ${target}/.MainActivity -f 0x10008000` : `am start -W -n ${target}/.MainActivity -a android.intent.action.VIEW -f 0x10008000 -d '${uri}'`]);} catch (error) {child.kill(); reject(error);}
      }
    });
    child.stderr.on('data', bytes => {framework.error += bytes.toString();});
    child.on('error', reject);
    child.on('close', code => {clearTimeout(timer); framework.exit = code; resolve();});
  });
  fs.writeFileSync(path.join(checks, `${suite}.raw.txt`), framework.output);
  const line = framework.output.split(/\r?\n/).find(value => value.startsWith('INSTRUMENTATION_RESULT: probeJSON='));
  record.result = line ? JSON.parse(line.slice('INSTRUMENTATION_RESULT: probeJSON='.length)) : null;
  assert.equal(framework.exit, 0); assert(record.result?.completed, record.result?.failure ?? 'No completed probe result');
  if(stageCandidate){
    record.observations=record.result.stages.find(row=>row.stage==='update-candidate')?.dispatch;
    assert.equal(record.observations?.sha256,hash(fs.readFileSync(path.resolve(root,options['upgrade-apk']))));
    assert(record.observations.versionCode>record.result.stages.find(row=>row.stage==='update-preserved')?.dispatch?.installedVersionCode);
  } else
  if(suite==='update-feed'){
    record.observations=record.result.stages.find(row=>row.stage==='update-feed-current')?.dispatch;assert.equal(record.observations?.currentUI,true);assert.equal(record.observations?.libraryUnchanged,true);assert.equal(record.captures?.length,1);assert.equal(record.captureFailure,undefined);
  } else if(suite==='simplification'){
    record.observations=record.result.stages.filter(row=>row.stage.startsWith('simplification-'));const expected=['home','library','settings-100','settings-130','transfer','detail','restored'].map(name=>'simplification-'+name);
    assert.deepEqual(record.observations.map(row=>row.stage),expected);assert.deepEqual(record.captures?.map(row=>row.stage),expected);assert.equal(record.captureFailure,undefined);assert(record.observations.at(-1).dispatch?.preferencesRestored===true);
  } else
  if(suite==='preferences'){record.observations=record.result.stages.find(row=>row.stage==='preferences-set')?.dispatch;assert.equal(record.observations?.fontScale,fontPercent/100);}else if(suite==='install-ui'){record.observations=record.result.stages.find(row=>row.stage==='update-install-opened')?.dispatch;assert(record.observations?.ordinaryInstallButton===true);}else if(suite==='episode'){record.observations=record.result.stages.filter(row=>row.stage==='episode-playing').map(row=>row.dispatch);assert(record.observations.length>=8);assert.equal(record.observations[0].currentMediaHost,'v45e-eu.tiktokcdn.com');assert(record.observations.at(-1).positionMs-record.observations[0].positionMs>6000);assert(record.observations.at(-1).renderedOutputBufferCount>record.observations[0].renderedOutputBufferCount);} else if(suite==='updates'&&verifyUpgrade){record.observations=record.result.stages.find(row=>row.stage==='update-preserved')?.dispatch;assert(record.observations?.ciphertextSHA256);}else if(suite==='resume'){record.observations=record.result.stages.filter(row=>row.stage==='pending-background'||row.stage==='resume-target');assert.equal(record.observations.length,2);} else if (suite !== 'player' && suite !== 'baseline' && suite !== 'settings') {
    const report = record.result.stages.find(row => row.stage === 'native-suite')?.dispatch?.nativeReport;
    assert.equal(report?.nativeChecks, `${suite} PASS`);
    assert.equal(report.installed.packageName, target);
    assert.equal(report.installed.certificateSHA256, record.targetCertificate);
    record.observations = report;
  } else {
  const samples = record.result.stages.filter(row => row.stage === 'held').map(row => row.dispatch);
  const boosted = samples.filter(row => row.rate > 1 && row.playing);
  assert(boosted.length >= 4, 'Held MotionEvents did not produce native speed boost');
  record.observations = {heldSampleCount: samples.length, nativePositionDeltaMs: boosted.at(-1).positionMs - boosted[0].positionMs, nativeRenderedFramesDelta: boosted.at(-1).renderedOutputBufferCount - boosted[0].renderedOutputBufferCount, hiddenTimelineSamples: boosted.filter(row => !row.timelineVisible).length, visibleTimelineSamples: boosted.filter(row => row.timelineVisible).length};
  assert(record.observations.nativePositionDeltaMs > 3000); assert(record.observations.nativeRenderedFramesDelta > 0);
  if (suite === 'player') assert.equal(record.observations.hiddenTimelineSamples, 0, 'Timeline disappeared during hold');
  }
  record.installedAfter = installed(target); if(suite!=='install-ui')assert.equal(record.installedAfter.sha256, record.apkSHA256);
  console.log(`ANDROID_${suite.toUpperCase()}: ${JSON.stringify(record.observations)}; PASS`);
} catch (error) {record.failure = error.message; throw error;}
finally {
  signingPassword = null;
  for(const {remote,sha256} of ownedApks){try{assert.equal(adb(['shell','sha256sum',remote]).split(/\s/)[0],sha256);adb(['shell','rm',remote]);}catch(error){record.fixtureCleanupFailure=error.message;}}
  record.endedAt = new Date().toISOString();
  fs.writeFileSync(artifact, JSON.stringify(record, null, 2) + '\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(artifact)), record);
}
