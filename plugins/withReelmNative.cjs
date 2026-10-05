const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {withDangerousMod,withAndroidManifest} = require('expo/config-plugins');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const STOCK = 'bef486e97c7b5f4b66adb6f4fc3178b430937c54031f3d48870396fa1a8940af';
const DATA_STOCK = '8ffd704064677f8862f093b43a14c20584c6235b9602384979a0e5498cb943ee';
const DATA_OBSERVER = '6b13ffee57e97c915933d0c5b3df38d30660276650bb90657cf18a2366fcfba7';
const dataAnchor = '  val dataSourceFactory = if (videoSource.useCaching) {';
const dataPatch = e2e => '  val dataSourceFactory = if (videoSource.uri?.scheme == "reelm-offline") {\n' +
  `    ReelmEncryptedDataSource.Factory(context${e2e ? ', NativeProbeTransferListener()' : ''})\n` +
  '  } else if (videoSource.useCaching) {';
function baselineDataSource(text) {
  if ([DATA_STOCK, DATA_OBSERVER].includes(hash(text))) return text;
  for (const e2e of [false, true]) {
    const patch = dataPatch(e2e);
    if (text.split(patch).length === 2) {
      const base = text.replace(patch, dataAnchor);
      if (hash(base) === (e2e ? DATA_OBSERVER : DATA_STOCK)) return base;
    }
  }
  throw Error('Unknown DataSourceUtils input');
}
function composeDataSource(text, e2e) {
  const base = baselineDataSource(text);
  if (hash(base) !== (e2e ? DATA_OBSERVER : DATA_STOCK)) throw Error('DataSourceUtils mode mismatch');
  if (base.split(dataAnchor).length !== 2) throw Error('Unknown DataSourceUtils anchor');
  return base;
}
const legacyPatches = [
  ['class VideoModule : Module() {', 'class VideoModule : Module() {\n  private val reelmBridge = ReelmVideoBridge()'],
  ['    Name("ExpoVideo")', '    Name("ExpoVideo")\n    reelmLibrary(reelmBridge) { appContext }'],
  ['      VideoManager.onModuleDestroyed(appContext)', '      try { VideoManager.onModuleDestroyed(appContext) } finally { reelmBridge.destroy() }'],
];
const readinessLegacyPatches = [...legacyPatches,
  ['      VideoManager.onAppForegrounded()', '      VideoManager.onAppForegrounded()\n      reelmBridge.setDownloadsActive(true)'],
  ['      VideoManager.onAppBackgrounded()', '      try { VideoManager.onAppBackgrounded() } finally { reelmBridge.setDownloadsActive(false) }'],
];
const foregroundLegacyPatches = [...legacyPatches,
  ['      VideoManager.onAppForegrounded()', '      VideoManager.onAppForegrounded()\n      reelmBridge.setNativeDownloadsForeground(true)'],
  ['      VideoManager.onAppBackgrounded()', '      try { VideoManager.onAppBackgrounded() } finally { reelmBridge.setNativeDownloadsForeground(false) }'],
];
const patches = [...legacyPatches,
  ['      VideoManager.onModuleCreated(appContext)', '      VideoManager.onModuleCreated(appContext)\n      reelmBridge.retireDownloads(appContext)'],
];
function baseline(text) {
  if (hash(text) === STOCK) return text;
  for (const variant of [patches, foregroundLegacyPatches, readinessLegacyPatches, legacyPatches]) {
    let original = text;
    for (const [before, after] of variant) {
      if (original.split(after).length !== 2) break;
      original = original.replace(after, before);
    }
    if (hash(original) === STOCK) return original;
  }
  throw Error('Unknown VideoModule input');
}
function compose(text) {
  text = baseline(text);
  for (const [before, after] of patches) {
    if (text.split(before).length !== 2) throw Error('Unknown native anchor');
    text = text.replace(before, after);
  }
  return text;
}
const sourceNames = e2e => ['ReelmVideoBridge.kt', 'ReelmLibraryStore.kt', 'ReelmDownloadRetirement.kt', 'ReelmApkUpdater.kt', 'ReelmLibraryTransfer.kt', ...(e2e ? ['ReelmNativeChecks.kt'] : [])];
const obsoleteSources = ['ReelmFileCrypto.kt', 'ReelmDownloadStore.kt', 'ReelmEncryptedDataSource.kt'];
function retiredSources(directory, prior) {
  return obsoleteSources.flatMap(name => {
    const file = path.join(directory, name);
    let stat;
    try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || prior?.inputs?.[name] !== hash(fs.readFileSync(file))) throw Error(`Unknown retired source ${name}; preserved`);
    return [file];
  });
}
function dependenciesMatch(locked, installed, exists, platform = process.platform, architecture = process.arch) {
  return Object.entries(locked.packages).every(([name, item]) => {
    if (!name) return true; // npm's hidden lock intentionally omits the root.
    const actual = installed.packages[name];
    if (!actual && item.optional && ((item.os && !item.os.includes(platform)) || (item.cpu && !item.cpu.includes(architecture)))) return true;
    return actual?.version === item.version && actual?.integrity === item.integrity && exists(name);
  });
}
function inject(root, e2e) {
  const pkg = path.join(root, 'node_modules/expo-video');
  if (JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'))).version !== '55.0.21') throw Error('Unknown expo-video version');
  const directory = path.join(pkg, 'android/src/main/java/expo/modules/video');
  const dataFile = path.join(directory, 'utils/DataSourceUtils.kt');
  const dataOutput = composeDataSource(fs.readFileSync(dataFile, 'utf8'), e2e);
  const dataSource = hash(dataOutput);
  const file = path.join(directory, 'VideoModule.kt');
  const text = fs.readFileSync(file, 'utf8'), output = compose(text);
  const receiptFile = path.join(root, '.reelm-native.json');
  const prior = fs.existsSync(receiptFile) ? JSON.parse(fs.readFileSync(receiptFile)) : null;
  const retired = retiredSources(directory, prior);
  const inputs = {};
  const writes = [];
  const pin = process.env.REELM_RELEASE_CERT_SHA256 ?? '';
  if(process.env.REELM_BUILD_SIGNING==='Private'&&!/^[a-f0-9]{64}$/.test(pin))throw Error('Missing private release certificate pin');
  if(pin&&!/^[a-f0-9]{64}$/.test(pin))throw Error('Invalid release certificate pin');
  const packageName=process.env.REELM_BUILD_PILOT==='1'?'org.reelm.drama.pilot':'org.reelm.drama';
  const buildConfig=Buffer.from(`package expo.modules.video\ninternal object ReelmBuildConfig { const val CERTIFICATE_SHA256 = "${pin}"; const val PACKAGE_NAME = "${packageName}" }\n`);
  const configDestination=path.join(directory,'ReelmBuildConfig.kt');
  if(fs.existsSync(configDestination)&&hash(fs.readFileSync(configDestination))!==hash(buildConfig)&&prior?.inputs?.['ReelmBuildConfig.kt']!==hash(fs.readFileSync(configDestination)))throw Error('Unknown injected build config');
  inputs['ReelmBuildConfig.kt']=hash(buildConfig);writes.push([configDestination,buildConfig]);
  for (const name of sourceNames(e2e)) {
    const input = fs.readFileSync(path.join(root, name === 'ReelmNativeChecks.kt' ? 'tests/android' : 'native/android', name));
    const destination = path.join(directory, name);
    if (fs.existsSync(destination) && hash(fs.readFileSync(destination)) !== hash(input) && prior?.inputs?.[name] !== hash(fs.readFileSync(destination))) throw Error(`Unknown injected source ${name}`);
    inputs[name] = hash(input);
    writes.push([destination, input]);
  }
  const check = path.join(directory, 'ReelmNativeChecks.kt');
  if (!e2e && fs.existsSync(check)) {
    if (prior?.inputs?.['ReelmNativeChecks.kt'] !== hash(fs.readFileSync(check))) throw Error('Unknown E2E check source');
  }
  for (const [destination, input] of writes) fs.writeFileSync(destination, input);
  if (!e2e && fs.existsSync(check)) fs.unlinkSync(check);
  for (const file of retired) fs.unlinkSync(file);
  fs.writeFileSync(file, output);
  fs.writeFileSync(dataFile, dataOutput);
  fs.writeFileSync(receiptFile, JSON.stringify({version: '55.0.21', base: STOCK, output: hash(output), dataSource, inputs, e2e}, null, 2) + '\n');
}
module.exports = config => withDangerousMod(withAndroidManifest(config,config=>{
  const manifest=config.modResults.manifest;
  const permissions=manifest['uses-permission']??=[];
  if(!permissions.some(p=>p.$?.['android:name']==='android.permission.REQUEST_INSTALL_PACKAGES'))permissions.push({$:{'android:name':'android.permission.REQUEST_INSTALL_PACKAGES'}});
  const app=manifest.application[0],receivers=app.receiver??=[];
  if(!receivers.some(r=>r.$?.['android:name']==='expo.modules.video.ReelmUpdateReceiver'))receivers.push({$:{'android:name':'expo.modules.video.ReelmUpdateReceiver','android:exported':'false'}});
  return config;
}), ['android', async config => {
  inject(config.modRequest.projectRoot, process.env.EXPO_PUBLIC_E2E === '1'); return config;
}]);
Object.assign(module.exports, {compose, baseline, composeDataSource, baselineDataSource, inject, sourceNames, hash, dependenciesMatch, retiredSources});
