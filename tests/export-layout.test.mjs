import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('standalone build uses one local stage and validates signing before staging', () => {
  const build = read('scripts/Build-Android.ps1');
  assert.match(build, /\$repo=.*Split-Path \$PSScriptRoot -Parent/, 'repo is the script parent');
  assert.match(build, /\$app=\$repo(?:\r?\n|;)/, 'standalone app is its repository root');
  assert.match(build, /\$build=Join-Path \$repo ['"]\.local[\\/]drama2['"]/, 'one bounded stage');
  assert.doesNotMatch(build, /C:[\\/]Users[\\/]|Guid|\.build[\\/]android/);
  assert.match(build, /\$env:JAVA_HOME/);
  assert.match(build, /\$env:ANDROID_HOME/);
  assert.match(build, /\$env:ANDROID_SDK_ROOT/);
  assert(build.indexOf('Get-ReelmSigningMaterial') >= 0 && build.indexOf('Get-ReelmSigningMaterial') < build.indexOf('New-Item'), 'existing signer is checked before staging');
  assert(build.replaceAll('\\', '/').includes('tests/fixtures/native-observer'), 'observer is a local source fixture');
});

test('standalone checks use local probe inputs and confine signing to its dedicated child', () => {
  const runner = read('scripts/Run-AndroidChecks.mjs');
  assert.match(runner, /const root = path\.resolve\((?:import\.meta\.dirname|path\.dirname\(fileURLToPath\(import\.meta\.url\)\)), ['"](?:\.\.|\.\.\/)['"]\)/);
  assert(runner.includes('tests/android/OwnActivityProbe.java'));
  assert.doesNotMatch(runner, /drama-mobile\/tests\/android|dirname, ['"]\.\.\/\.\./);
  assert.match(runner, /delete process\.env\[passwordEnv\]/);
  assert.match(runner, /passwordEnv \? \{\.\.\.process\.env, \[passwordEnv\]: signingPassword\} : process\.env/);
  const start = runner.indexOf('const buildScript =');
  assert(start >= 0);
  assert.doesNotMatch(runner.slice(start, runner.indexOf('fs.writeFileSync(path.join(build', start)), /apksigner.*sign --ks/);
});

test('standalone fixtures have no historical workspace paths and pin the authored observer', () => {
  const source = fs.readFileSync(new URL('./source.test.mjs', import.meta.url), 'utf8');
  const native = fs.readFileSync(new URL('./native-build.test.mjs', import.meta.url), 'utf8');
  assert(source.includes("new URL('./fixtures/public-contracts.json',import.meta.url)"));
  assert.doesNotMatch(source + native, /dramadunyam-app-integration-2026-10-04/);
  assert.equal((native.match(/tests\/fixtures\/native-observer\/DataSourceUtils\.MODIFIED\.kt/g) ?? []).length, 3);
  const observer = fs.readFileSync(new URL('./fixtures/native-observer/prepare-native-observer.mjs', import.meta.url), 'utf8');
  assert(observer.includes('../../../.local/drama2/node_modules/'));
  const state = JSON.parse(fs.readFileSync(new URL('./fixtures/native-observer/native-network-instrumentation.json', import.meta.url)));
  assert.equal(state.baselineSha256, '8ffd704064677f8862f093b43a14c20584c6235b9602384979a0e5498cb943ee');
  assert.equal(state.modifiedSha256, '6b13ffee57e97c915933d0c5b3df38d30660276650bb90657cf18a2366fcfba7');
  const bytes = fs.readFileSync(new URL('./fixtures/native-observer/DataSourceUtils.MODIFIED.kt', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), state.modifiedSha256);
  const contracts = fs.readFileSync(new URL('./fixtures/public-contracts.json', import.meta.url));
  assert.equal(createHash('sha256').update(contracts).digest('hex'), '0f2c94f720e5200a99d99e44bae4326bfcd4472b6c4b7b77496bba2efb6dbbe5');
  assert.equal(JSON.parse(contracts).requests.length, 6);
});

test('standalone CI runs the complete Node24 suite and preserves Windows-only signing checks', () => {
  assert.equal(read('.env.example').trim(), 'EXPO_PUBLIC_E2E=0');
  assert.match(read('tests/runtime.test.mjs'), /read\('\.env\.example'\)/);
  assert.doesNotMatch(read('tests/runtime.test.mjs'), /read\('\.env'\)/);
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /runs-on: ubuntu-latest/);
  assert.match(ci, /node-version: ['"]?24['"]?(?:\r?\n)/);
  assert.match(ci, /npm ci --include=dev --no-audit --no-fund/);
  assert.match(ci, /npm run typecheck/);
  assert.match(ci, /npm test/);
  assert.equal(JSON.parse(read('package.json')).scripts.test, 'node --test tests/*.test.mjs ui/*.test.mjs');
  assert.match(read('tests/signing.test.mjs'), /skip: process\.platform !== 'win32'/);
});
