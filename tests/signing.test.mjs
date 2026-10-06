import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const quote = value => `'${value.replaceAll("'", "''")}'`;
function powershell(body) {
  assert.ok(fs.existsSync(path.join(root, 'scripts/Signing.ps1')), 'signing helper exists');
  return spawnSync('pwsh', ['-NoProfile', '-Command', `$ErrorActionPreference='Stop';. ${quote(path.join(root, 'scripts/Signing.ps1'))};${body}`], {encoding: 'utf8', windowsHide: true});
}
test('private signer fails closed before a build without existing material', {skip: process.platform !== 'win32'}, () => {
  const result = powershell(`$folder=Join-Path ([IO.Path]::GetTempPath()) ('reelm-signing-missing-'+[Guid]::NewGuid());try{Get-ReelmSigningMaterial -SigningRoot $folder;throw 'accepted missing material'}catch{if($_.Exception.Message -notmatch 'Missing signing material'){throw};'MISSING_MATERIAL_REJECTED'}`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /MISSING_MATERIAL_REJECTED/);
});
test('portable recovery authenticates key/password bytes and rejects wrong password or tampering', {skip: process.platform !== 'win32'}, () => {
  const result = powershell(`
    $password=ConvertTo-SecureString 'fixture-only recovery passphrase' -AsPlainText -Force;
    $wrong=ConvertTo-SecureString 'different fixture passphrase' -AsPlainText -Force;
    $bytes=[Text.Encoding]::UTF8.GetBytes('{"key":"fixture-key","password":"fixture-secret"}');
    $backup=Protect-ReelmRecoveryPayload $bytes $password;
    $roundtrip=Unprotect-ReelmRecoveryPayload $backup $password;
    if([Convert]::ToBase64String($roundtrip) -ne [Convert]::ToBase64String($bytes)){throw 'roundtrip'};
    foreach($bad in @('wrong','tampered')){
      try{if($bad -eq 'wrong'){Unprotect-ReelmRecoveryPayload $backup $wrong|Out-Null}else{$copy=$backup|ConvertFrom-Json;$cipher=[Convert]::FromBase64String($copy.ciphertext);$cipher[0]=$cipher[0] -bxor 1;$copy.ciphertext=[Convert]::ToBase64String($cipher);Unprotect-ReelmRecoveryPayload ($copy|ConvertTo-Json -Compress) $password|Out-Null};throw 'accepted corrupt recovery'}catch{if($_.Exception.Message -eq 'accepted corrupt recovery'){throw}}
    };'RECOVERY_AUTHENTICATED'`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RECOVERY_AUTHENTICATED/);
});
test('signing path rejects broad ACLs and keeps child password out of parent environment', {skip: process.platform !== 'win32'}, () => {
  const result = powershell(`
    $folder=Join-Path ([IO.Path]::GetTempPath()) ('reelm-signing-acl-'+[Guid]::NewGuid());New-Item $folder -ItemType Directory|Out-Null;
    try{
      try{Assert-ReelmPrivateAcl $folder;throw 'accepted broad ACL'}catch{if($_.Exception.Message -notmatch 'Signing ACL'){throw}};
      Set-ReelmPrivateAcl $folder;Assert-ReelmPrivateAcl $folder;
      $secret=ConvertTo-SecureString 'fixture-child-password' -AsPlainText -Force;
      $previous=[Environment]::GetEnvironmentVariable('REELM_SIGNING_PASSWORD');
      $child=Invoke-ReelmSecretTool -FilePath (Get-Command pwsh).Source -ArgumentList @('-NoProfile','-Command','if($env:REELM_SIGNING_PASSWORD -ne "fixture-child-password"){exit 8};"CHILD_SECRET_OK"') -Password $secret;
      if($child.ExitCode -ne 0 -or $child.Stdout -notmatch 'CHILD_SECRET_OK'){throw 'child secret'};
      if([Environment]::GetEnvironmentVariable('REELM_SIGNING_PASSWORD') -ne $previous){throw 'parent environment leaked'};
      'ACL_AND_CHILD_ENV_VERIFIED'
    }finally{Remove-Item -LiteralPath $folder -Force}`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ACL_AND_CHILD_ENV_VERIFIED/);
});
test('pilot identity and synchronized versions come from validated public build overrides', () => {
  assert.ok(fs.existsSync(path.join(root, 'app.config.cjs')), 'dynamic app config exists');
  const result = spawnSync(process.execPath, ['-e', `const assert=require('node:assert/strict');const configure=require('./app.config.cjs');const base=require('./app.json').expo;let c=configure({config:base});assert.equal(c.version,'0.2.3');assert.equal(c.android.versionCode,6);process.env.REELM_BUILD_PILOT='1';process.env.REELM_BUILD_VERSION_NAME='0.2.1';process.env.REELM_BUILD_VERSION_CODE='4';c=configure({config:base});assert.equal(c.android.package,'org.reelm.drama.pilot');assert.equal(c.scheme,'reelm-drama-pilot');assert.equal(c.version,'0.2.1');assert.equal(c.android.versionCode,4);process.env.REELM_BUILD_VERSION_CODE='4junk';assert.throws(()=>configure({config:base}));console.log('PILOT_CONFIG_VERIFIED')`], {cwd:root,encoding:'utf8',windowsHide:true,env:{...process.env,REELM_BUILD_PILOT:'0',REELM_BUILD_VERSION_NAME:'',REELM_BUILD_VERSION_CODE:''}});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PILOT_CONFIG_VERIFIED/);
});
test('Release missing key validation never reaches staging or bundling', {skip: process.platform !== 'win32'}, () => {
  const script = fs.readFileSync(path.join(root, 'scripts/Build-Android.ps1'), 'utf8');
  assert.match(script, /\[switch\]\$ValidateOnly/, 'validation-only entry point exists');
  const fixture = path.join(root, '.local/drama2/app-updates/missing-signing-fixture');
  assert.equal(fs.existsSync(fixture), false);
  const result = spawnSync('pwsh', ['-NoProfile', '-File', path.join(root, 'scripts/Build-Android.ps1'), '-Mode', 'Release', '-ValidateOnly'], {encoding:'utf8',windowsHide:true,env:{...process.env,LOCALAPPDATA:fixture}});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing signing material/);
  assert.equal(fs.existsSync(fixture), false);
});
test('altered public pin, key bytes and DPAPI metadata fail closed without creating another key', {skip: process.platform !== 'win32'}, () => {
  const result = powershell(`
    $fixtureRoot=Join-Path ([IO.Path]::GetTempPath()) ('reelm-signing-integrity-'+[Guid]::NewGuid());$folder=Join-Path $fixtureRoot 'Signing';New-Item $folder -ItemType Directory -Force|Out-Null;
    $key=Join-Path $folder 'reelm-release.p12';$secret=Join-Path $folder 'password.dpapi';$pin=Join-Path $folder 'certificate.sha256';
    try{
      Set-ReelmPrivateAcl $fixtureRoot;Set-ReelmPrivateAcl $folder;
      [IO.File]::WriteAllBytes($key,[byte[]](1,2,3));[IO.File]::WriteAllText($pin,('1'*64));
      $credentials=@{version=1;alias='reelm-release';password='fixture-password';certificateSha256=('2'*64);keystoreSha256=(Get-FileHash $key).Hash.ToLowerInvariant()};
      $payload=[Text.Encoding]::UTF8.GetBytes(($credentials|ConvertTo-Json -Compress));[IO.File]::WriteAllBytes($secret,[Security.Cryptography.ProtectedData]::Protect($payload,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser));
      foreach($file in @($key,$secret,$pin)){Set-ReelmPrivateAcl $file};
      try{Get-ReelmSigningMaterial $folder|Out-Null;throw 'accepted altered pin'}catch{if($_.Exception.Message -notmatch 'Altered signing material'){throw}};
      [IO.File]::WriteAllText($pin,('2'*64));[IO.File]::WriteAllBytes($key,[byte[]](4,5,6));
      try{Get-ReelmSigningMaterial $folder|Out-Null;throw 'accepted altered key'}catch{if($_.Exception.Message -notmatch 'Altered signing material'){throw}};
      [IO.File]::WriteAllText($pin,'invalid');
      try{Get-ReelmSigningMaterial $folder|Out-Null;throw 'accepted invalid pin'}catch{if($_.Exception.Message -notmatch 'Invalid private signing pin'){throw}};
      'ALTERED_SIGNING_MATERIAL_REJECTED'
    }finally{foreach($file in @($key,$secret,$pin)){if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force}};Remove-Item -LiteralPath $folder -Force;Remove-Item -LiteralPath $fixtureRoot -Force}`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ALTERED_SIGNING_MATERIAL_REJECTED/);
});
test('signing rejects a real junction ancestor', {skip: process.platform !== 'win32'}, () => {
  const result = powershell(`
    $fixture=Join-Path ([IO.Path]::GetTempPath()) ('reelm-signing-junction-'+[Guid]::NewGuid());$target=Join-Path $fixture 'target';$junction=Join-Path $fixture 'junction';
    New-Item $target -ItemType Directory -Force|Out-Null;
    try{
      New-Item -Path $junction -ItemType Junction -Target $target|Out-Null;
      try{Assert-ReelmNoReparse (Join-Path $junction 'Signing');throw 'accepted junction'}catch{if($_.Exception.Message -notmatch 'Signing reparse path rejected'){throw}};
      'REPARSE_ANCESTOR_REJECTED'
    }finally{if(Test-Path -LiteralPath $junction){Remove-Item -LiteralPath $junction -Force};Remove-Item -LiteralPath $target -Force;Remove-Item -LiteralPath $fixture -Force}`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /REPARSE_ANCESTOR_REJECTED/);
});
test('Android runner confines fixture password to the signing child and removes it from generic children', () => {
  const source=fs.readFileSync(path.join(root,'scripts/Run-AndroidChecks.mjs'),'utf8');
  const credentials=source.slice(source.indexOf("const passwordEnv = options['password-env'];"),source.indexOf('const hash ='));
  const execute=source.slice(source.indexOf('function execute('),source.indexOf('const adb ='));
  const result=spawnSync(process.execPath,['--input-type=module','-e',`
    import assert from 'node:assert/strict';import {spawn,spawnSync} from 'node:child_process';
    const options={'password-env':'REELM_FIXTURE_SIGNER_PASSWORD'},receipts=[];
    ${credentials}
    ${execute}
    assert.equal(process.env.REELM_FIXTURE_SIGNER_PASSWORD,undefined,'runner environment contains the password');
    assert.equal(signingPassword,'fixture-runner-secret','password was not captured for the signing child');
    const absent='if(process.env.REELM_FIXTURE_SIGNER_PASSWORD!==undefined)process.exit(9);console.log("GENERIC_CHILD_CLEAN")';
    assert.match(execute(process.execPath,['-e',absent]),/GENERIC_CHILD_CLEAN/);
    assert.match(execute(process.execPath,['-e','if(!process.env.REELM_FIXTURE_SIGNER_PASSWORD)process.exit(8);console.log("SIGNING_CHILD_SECRET_PRESENT")'],120000,false,{...process.env,[passwordEnv]:signingPassword}),/SIGNING_CHILD_SECRET_PRESENT/);
    assert.equal(process.env.REELM_FIXTURE_SIGNER_PASSWORD,undefined);
    const sync=spawnSync(process.execPath,['-e',absent],{encoding:'utf8'});assert.equal(sync.status,0,sync.stderr);
    await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['-e',absent]);child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('live child inherited secret')))});
    assert.equal(JSON.stringify(receipts).includes('fixture-runner-secret'),false,'receipt contains password');
    console.log('RUNNER_SECRET_CONFINED')
  `],{encoding:'utf8',windowsHide:true,env:{...process.env,REELM_FIXTURE_SIGNER_PASSWORD:'fixture-runner-secret'}});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/RUNNER_SECRET_CONFINED/);
  const buildStart=source.indexOf('const buildScript =');
  const buildScript=source.slice(buildStart,source.indexOf('fs.writeFileSync(path.join(build',buildStart));
  assert.doesNotMatch(buildScript,/apksigner.*sign --ks/,'compile child still performs signing');
  assert.match(source,/execute\(path\.join\(java, 'bin\/java\.exe'\)/,'dedicated direct signing child exists');
  assert.match(source,/passwordEnv \? \{\.\.\.process\.env, \[passwordEnv\]: signingPassword\} : process\.env/,'only the signing call restores captured password');
});
