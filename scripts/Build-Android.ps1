#requires -Version 7.0
[CmdletBinding()]
param(
 [ValidateSet('E2E','Release')][string]$Mode='Release',
 [string]$Output,
 [ValidateSet('Legacy','Private')][string]$Signing,
 [switch]$Pilot,
 [string]$VersionName,
 [ValidateRange(1,2100000000)][int]$VersionCode,
 [switch]$ValidateOnly
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Signing.ps1')
$repo=Split-Path $PSScriptRoot -Parent
$app=$repo
$phase=Join-Path $repo 'tests\fixtures\native-observer'
$build=Join-Path $repo '.local\drama2'
if([IO.Path]::GetFullPath($build) -ne [IO.Path]::GetFullPath((Join-Path $repo '.local\drama2'))){throw 'Unexpected isolated build directory'}
Assert-ReelmNoReparse $build
$javaHome=$env:JAVA_HOME
$androidHome=if($env:ANDROID_HOME){$env:ANDROID_HOME}else{$env:ANDROID_SDK_ROOT}
if(!$Signing){$Signing=if($Mode -eq 'Release'){'Private'}else{'Legacy'}}
if($Pilot -and $Signing -ne 'Private'){throw 'Pilot requires private signing'}
if(!$VersionName){$VersionName=if($Signing -eq 'Legacy'){'0.1.1'}else{'0.2.3'}}
if(!$VersionCode){$VersionCode=if($Signing -eq 'Legacy'){2}else{6}}
if($VersionName -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid version name'}
$package=if($Pilot){'org.reelm.drama.pilot'}else{'org.reelm.drama'}
$keytool=if($javaHome){Join-Path $javaHome 'bin\keytool.exe'}else{'keytool.exe'}
# Validate the existing signer before touching staging, dependencies or bundles.
$material=if($Signing -eq 'Private'){Get-ReelmSigningMaterial -Keytool $keytool}else{Get-ReelmLegacySigningMaterial -Keystore (Join-Path $build 'android\app\debug.keystore') -Keytool $keytool}
if($ValidateOnly){
 try{[PSCustomObject]@{mode=$Mode;signing=$Signing;package=$package;scheme=$(if($Pilot){'reelm-drama-pilot'}else{'reelm-drama'});versionName=$VersionName;versionCode=$VersionCode;certificateSha256=$material.CertificateSha256}|ConvertTo-Json -Compress}finally{$material.Password.Dispose()}
 return
}
try{
if(!$javaHome -or !(Test-Path -LiteralPath (Join-Path $javaHome 'bin\java.exe'))){throw 'Configure JAVA_HOME for the existing Java 21 toolchain before building'}
if(!$androidHome -or !(Test-Path -LiteralPath $androidHome)){throw 'Configure ANDROID_HOME or ANDROID_SDK_ROOT for the existing Android SDK before building'}
$free=(Get-PSDrive -Name ([IO.Path]::GetPathRoot($build).Substring(0,1))).Free
if($free -lt 20GB){throw 'Android build disk reserve below 20 GiB'}
New-Item $build -ItemType Directory -Force | Out-Null
# Adopt only canonical source inputs. Unknown stage files remain untouched.
$manifest=Join-Path $build 'source-inputs.json'
$inputs=@()
foreach($entry in Get-ChildItem -LiteralPath $app){
 if($entry.Name -in @('node_modules','android','ios','.expo','.git','.local','.build','dist','coverage') -or $entry.Name -like '.env*'){continue}
 $files=if($entry.PSIsContainer){Get-ChildItem -LiteralPath $entry.FullName -File -Recurse}else{@($entry)}
 foreach($file in $files){
  if($file.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Source reparse point'}
  $inputs+=$file.FullName.Substring($app.Length+1)
 }
}
function Assert-StagePath([string]$relative){
 if($relative -match '^(node_modules|android|ios|\.expo|\.git|\.local|\.build|dist|coverage)([\\/]|$)' -or $relative -match '(^|[\\/])\.env($|\.)'){throw 'Protected stage input'}
 $target=[IO.Path]::GetFullPath((Join-Path $build $relative))
 if(!$target.StartsWith($build+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Stage boundary'}
 $cursor=$target
 while($cursor){
  if((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Stage reparse point'}
  $cursor=Split-Path $cursor -Parent
 }
 return $target
}
if(Test-Path -LiteralPath $manifest){
 foreach($old in (Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json)){
  $relative=if($old -is [string]){$old}else{$old.path}
  if($relative -notin $inputs){
   $target=Assert-StagePath $relative
   if(Test-Path -LiteralPath $target){
    if($old -is [string]){throw "Unhashed stale stage input; preserved: $relative. Reconcile this file explicitly before rebuilding; legacy manifests do not prove disposable bytes."}
    if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $old.sha256){throw 'Changed deleted stage input; preserved'}
    Remove-Item -LiteralPath $target -Force
   }
  }
 }
}
$records=@()
foreach($relative in $inputs){
 $target=Assert-StagePath $relative
 New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
 Copy-Item -LiteralPath (Join-Path $app $relative) -Destination $target -Force
 $records+=@{path=$relative;sha256=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash}
}
ConvertTo-Json -InputObject @($records) | Set-Content -LiteralPath $manifest
if($Output){$Output=[IO.Path]::GetFullPath($Output)}
$environmentNames=@('JAVA_HOME','ANDROID_HOME','ANDROID_SDK_ROOT','Path','EXPO_PUBLIC_E2E','NODE_ENV','REELM_BUILD_SIGNING','REELM_BUILD_PILOT','REELM_BUILD_VERSION_NAME','REELM_BUILD_VERSION_CODE','REELM_RELEASE_CERT_SHA256')
$originalEnvironment=@{};foreach($name in $environmentNames){$originalEnvironment[$name]=[Environment]::GetEnvironmentVariable($name)}
$env:JAVA_HOME=$javaHome
$env:ANDROID_HOME=$androidHome
$env:ANDROID_SDK_ROOT=$androidHome
$env:Path="$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
$env:EXPO_PUBLIC_E2E=if($Mode -eq 'E2E'){'1'}else{'0'}
$env:NODE_ENV='production'
$env:REELM_BUILD_SIGNING=$Signing
$env:REELM_BUILD_PILOT=if($Pilot){'1'}else{'0'}
$env:REELM_BUILD_VERSION_NAME=$VersionName
$env:REELM_BUILD_VERSION_CODE=[string]$VersionCode
$env:REELM_RELEASE_CERT_SHA256=if($Signing -eq 'Private'){$material.CertificateSha256}else{''}
if(!$Output){$Output=Join-Path $build ('ReelmDrama'+$(if($Pilot){'-pilot'}else{''})+$(if($Mode -eq 'E2E'){'-e2e'}else{''})+'.apk')}
Assert-ReelmNoReparse $Output
if((Get-PSDrive -Name ([IO.Path]::GetPathRoot($Output).Substring(0,1))).Free -lt 20GB){throw 'APK output disk reserve below 20 GiB'}
Push-Location $app
try{& node --test tests/*.test.mjs ui/*.test.mjs;if($LASTEXITCODE){throw 'Canonical fixtures failed'}}finally{Pop-Location}
Push-Location $build
try{
 $lock=(Get-FileHash -LiteralPath 'package-lock.json' -Algorithm SHA256).Hash
 $reuse=(Test-Path -LiteralPath 'node_modules/.package-lock.json') -and (Test-Path -LiteralPath 'node_modules/expo-video/package.json')
 if($reuse){
  & node -e "const fs=require('fs');const {dependenciesMatch}=require('./plugins/withReelmNative.cjs');const a=JSON.parse(fs.readFileSync('package-lock.json'));const b=JSON.parse(fs.readFileSync('node_modules/.package-lock.json'));if(!dependenciesMatch(a,b,k=>fs.existsSync(k+'/package.json')))process.exit(1)"
  $reuse=$LASTEXITCODE -eq 0
 }
 if(!$reuse){& npm.cmd ci --no-audit --no-fund;if($LASTEXITCODE){throw 'Pinned dependency install failed'}}
 Write-Output "DEPENDENCIES_REUSED=$reuse LOCK=$lock"
 & node scripts/prepare-reelm-native.mjs;if($LASTEXITCODE){throw 'Guarded native reset failed'}
 & .\node_modules\.bin\tsc.cmd --noEmit;if($LASTEXITCODE){throw 'Typecheck failed'}
 "EXPO_PUBLIC_E2E=$env:EXPO_PUBLIC_E2E" | Set-Content -LiteralPath .env
 if($Mode -eq 'E2E'){& node (Join-Path $phase 'prepare-native-observer.mjs');if($LASTEXITCODE){throw 'Pinned native observer failed'}}
 & .\node_modules\.bin\expo.cmd prebuild --platform android --no-install;if($LASTEXITCODE){throw 'Android generation failed'}
 # Refresh generated native identity; RN caches this by dependency files, not Expo's package override.
 $autolinking=Join-Path $build 'android/build/generated/autolinking/autolinking.json'
 if(Test-Path -LiteralPath $autolinking){
  Assert-ReelmNoReparse $autolinking
  if((Get-Item -LiteralPath $autolinking).Length -gt 2MB){throw 'Unknown autolinking input; preserved'}
  $linked=Get-Content -LiteralPath $autolinking -Raw|ConvertFrom-Json
  if($linked.root -ne $build -or $linked.project.android.packageName -notin @('org.reelm.drama','org.reelm.drama.pilot')){throw 'Unknown autolinking identity; preserved'}
  if($linked.project.android.packageName -ne $package){Remove-Item -LiteralPath $autolinking -Force}
 }
 $gradle=Get-Content -Raw -LiteralPath '.\android\app\build.gradle'
 if($gradle -notmatch '(?m)^\s*extraPackagerArgs\s*='){ $gradle=$gradle.Replace('react {',"react {`n    extraPackagerArgs = ['--reset-cache']") }
 # Gradle never receives a private password; apksigner signs in an isolated child.
 $unsigned='(?s)(\brelease\s*\{.*?\bsigningConfig\s+)(?:signingConfigs\.debug|null)'
 if([regex]::Matches($gradle,$unsigned).Count -ne 1){throw 'Unknown release signing configuration'}
 $gradle=[regex]::Replace($gradle,$unsigned,'${1}null')
 Set-Content -LiteralPath '.\android\app\build.gradle' -Value $gradle
 # Environment flags are not trusted as Gradle cache inputs: always freshly bundle.
 & .\android\gradlew.bat -p android :app:createBundleReleaseJsAndAssets --rerun-tasks --console=plain --max-workers=4 '-PreactNativeArchitectures=arm64-v8a';if($LASTEXITCODE){throw 'Fresh JS bundle failed'}
 & .\android\gradlew.bat -p android :app:assembleRelease --console=plain --max-workers=4 '-PreactNativeArchitectures=arm64-v8a';if($LASTEXITCODE){throw 'APK build failed'}
 $unsignedApk=Join-Path $build 'android\app\build\outputs\apk\release\app-release-unsigned.apk'
 $signerJar=Join-Path $androidHome 'build-tools\36.0.0\lib\apksigner.jar'
 $signed=Invoke-ReelmSecretTool -FilePath (Join-Path $javaHome 'bin\java.exe') -ArgumentList @('-jar',$signerJar,'sign','--ks',$material.Keystore,'--ks-key-alias',$material.Alias,'--ks-pass','env:REELM_SIGNING_PASSWORD','--key-pass','env:REELM_SIGNING_PASSWORD','--out',$Output,$unsignedApk) -Password $material.Password
 if($signed.ExitCode -ne 0){throw "APK signing failed ($($signed.ExitCode))"}
 $verify=& (Join-Path $javaHome 'bin\java.exe') -jar $signerJar verify --verbose --print-certs $Output 2>&1
 if($LASTEXITCODE -ne 0){throw 'Finished APK signature verification failed'}
 $actual=@([regex]::Matches(($verify -join "`n"),'Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]{64})')|ForEach-Object {$_.Groups[1].Value.ToLowerInvariant()})
 if($actual.Count -ne 1 -or $actual[0] -cne $material.CertificateSha256){throw 'Finished APK signer mismatch'}
 $badging=& (Join-Path $androidHome 'build-tools\36.0.0\aapt.exe') dump badging $Output 2>&1
 if($LASTEXITCODE -ne 0 -or ($badging -join "`n") -notmatch ("package: name='"+[regex]::Escape($package)+"' versionCode='"+$VersionCode+"' versionName='"+[regex]::Escape($VersionName)+"'")){throw 'Finished APK package/version mismatch'}
 Write-Output "APK_VERIFIED PACKAGE=$package VERSION_NAME=$VersionName VERSION_CODE=$VersionCode CERTIFICATE_SHA256=$($material.CertificateSha256) SIGNING=$Signing"
 Get-FileHash -LiteralPath $Output -Algorithm SHA256
}finally{Pop-Location}
}finally{
 if($originalEnvironment){foreach($name in $environmentNames){[Environment]::SetEnvironmentVariable($name,$originalEnvironment[$name])}}
 $material.Password.Dispose()
}
