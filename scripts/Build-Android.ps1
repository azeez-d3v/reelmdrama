param([string]$Output)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$buildRoot=Join-Path $root '.build\android'
# Each invocation gets a fresh source tree: deleted files cannot linger.
$build=Join-Path $buildRoot ([Guid]::NewGuid().ToString('N'))
if(-not $Output){$Output=Join-Path $root 'dist\ReelmDrama.apk'}
elseif(-not [IO.Path]::IsPathRooted($Output)){$Output=Join-Path $root $Output}
$Output=[IO.Path]::GetFullPath($Output)
if(-not $env:JAVA_HOME -or -not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe'))){throw 'Configure JAVA_HOME for Java 17 or 21 before building.'}
$sdk=if($env:ANDROID_HOME){$env:ANDROID_HOME}else{$env:ANDROID_SDK_ROOT}
if(-not $sdk -or -not (Test-Path -LiteralPath $sdk)){throw 'Configure ANDROID_HOME or ANDROID_SDK_ROOT for Android SDK 36.'}
$prior=@{E2E=$env:EXPO_PUBLIC_E2E;Automation=$env:EXPO_PUBLIC_AUTOMATION;Node=$env:NODE_ENV;Path=$env:Path;Android=$env:ANDROID_HOME}
$env:Path="$env:JAVA_HOME\bin;$sdk\platform-tools;$env:Path"
$env:ANDROID_HOME=$sdk
$env:EXPO_PUBLIC_E2E='0'
$env:EXPO_PUBLIC_AUTOMATION='0'
$env:NODE_ENV='production'
try{
 Push-Location $root
 try{
  & npm.cmd run typecheck;if($LASTEXITCODE){throw 'Typecheck failed'}
  & npm.cmd test;if($LASTEXITCODE){throw 'Fixtures failed'}
 }finally{Pop-Location}
 New-Item -ItemType Directory -Path $build -Force | Out-Null
 Get-ChildItem -LiteralPath $root -Force | Where-Object {$_.Name -notin @('.git','.build','dist','node_modules','android','ios','.expo','.github','.local') -and -not $_.Name.StartsWith('.env')} | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination $build -Recurse -Force}
 Push-Location $build
 try{
  & npm.cmd ci --include=dev --no-audit --no-fund;if($LASTEXITCODE){throw 'Pinned dependency install failed'}
  & .\node_modules\.bin\tsc.cmd --noEmit;if($LASTEXITCODE){throw 'Staged typecheck failed'}
  "EXPO_PUBLIC_E2E=0`nEXPO_PUBLIC_AUTOMATION=0" | Set-Content -LiteralPath .env
  & .\node_modules\.bin\expo.cmd prebuild --platform android --no-install;if($LASTEXITCODE){throw 'Android generation failed'}
  $gradle=Get-Content -Raw -LiteralPath '.\android\app\build.gradle'
  if($gradle -notmatch '(?m)^\s*extraPackagerArgs\s*='){$gradle=$gradle.Replace('react {',"react {`n    extraPackagerArgs = ['--reset-cache']");Set-Content -LiteralPath '.\android\app\build.gradle' -Value $gradle}
  & .\android\gradlew.bat -p android :app:createBundleReleaseJsAndAssets --rerun-tasks --console=plain --max-workers=4 '-PreactNativeArchitectures=arm64-v8a';if($LASTEXITCODE){throw 'Fresh JavaScript bundle failed'}
  & .\android\gradlew.bat -p android :app:assembleRelease --console=plain --max-workers=4 '-PreactNativeArchitectures=arm64-v8a';if($LASTEXITCODE){throw 'APK build failed'}
  New-Item -ItemType Directory -Path (Split-Path $Output -Parent) -Force | Out-Null
  Copy-Item -LiteralPath '.\android\app\build\outputs\apk\release\app-release.apk' -Destination $Output -Force
  Get-FileHash -LiteralPath $Output -Algorithm SHA256
 }finally{Pop-Location}
}finally{
 $env:EXPO_PUBLIC_E2E=$prior.E2E;$env:EXPO_PUBLIC_AUTOMATION=$prior.Automation;$env:NODE_ENV=$prior.Node;$env:Path=$prior.Path;$env:ANDROID_HOME=$prior.Android
}
