<p align="center"><img src="assets/icon.png" width="88" alt="Reelm Drama logo"></p>

# Reelm Drama

A standalone Android drama player with a dark, lime-accented interface, vertical episode navigation and local watch history.

**[Download Reelm Drama 0.2.0](https://github.com/azeez-d3v/reelmdrama/releases/download/v0.2.0/ReelmDrama-arm64-v8a.apk)** · [All releases](https://github.com/azeez-d3v/reelmdrama/releases)

Android 7.0 / API 24 or newer; **arm64-v8a**. Package `org.reelm.drama`, version **0.2.0 / code 3**. Complete Android's normal installation and Play Protect flow.

## Features

- Home, Discover, search and runtime platform filters from the source catalogue; empty platforms remain visible.
- Portrait episode player: tap to pause/resume, vertical swipe, seek, unobtrusive timeline loading, immersive controls and configurable press-and-hold speed.
- Saved, Recents, exact episode/time resume, local likes, text-size and playback settings.
- Individual/series download selection, progress, pause, storage management and app-private encrypted offline media using Android Keystore.
- Metadata-only library export/import and manual, verified GitHub APK update checks.

The source is DramaDünyam's normal public catalogue/resolver. Metadata requests originate on the phone; video travels directly from the source/CDN to native playback, without a Reelm video relay. Source availability can change; a catalogue listing is not a playable-stream guarantee.

The catalogue is English-localized. Original audio with English subtitles is supported; only advertised English subtitle tracks are selected. Localization is not a guarantee of English dialogue or captions on every title.

Library/preferences are on this device only. There is no app account, cloud sync, D1, payment or premium entitlement in this app. Transfer documents contain library metadata, not encrypted media, credentials or keys.

## Upgrading from the old development-signed app

Version 0.2.0 starts private release signing. Android cannot install it over an older differently signed app.

1. Use the **Legacy migration APK** linked in the 0.2.0 release notes to add library transfer to the older installation; do not uninstall first.
2. In Settings → Library transfer, export and retain the document. Confirm the app reports **Library export verified** before proceeding.
3. Uninstall the Legacy app, install the private 0.2.0 APK, then import that document through Settings → Library transfer.

**Uninstall deletes the old encrypted downloads and their Keystore key. Redownload those episodes afterward.** Keep the exported document until Saved, Recents, resume points and preferences are verified in the new app. Complete OS prompts normally; do not disable device protection.

Already on the private release? Keep this installation; do not repeat that migration. Future updates must match the installed package/private signer and have a higher native versionCode.

## App updates

Settings → App updates → Check reads public GitHub Releases without a client token. A published candidate requires exactly one asset named `ReelmDrama-arm64-v8a.apk` and a SHA256 digest. Native code verifies bytes, package, signer and increasing versionCode before handing installation to Android. Version labels alone cannot authorize an update. Version 0.2.0 correctly reports current on an installed private 0.2.0 app.

## Development

This repository is the standalone source export. The canonical development app remains in the parent Reelm project's `drama-mobile/`; do not develop in archived staging copies. Read `AGENTS.md` before building or creating files.

```powershell
# Node 24; install only when the lockfile does not match existing dependencies.
npm ci --no-audit --no-fund
npm run typecheck
npm test
```

`npm test` includes both `tests/*.test.mjs` and `ui/*.test.mjs`. Public catalogue fixtures live in `tests/fixtures/`; they contain no viewing cookies, signed streams or personal library records. The canonical 0.2.0 checks passed 348/348 plus TypeScript before export; see Actions for checks of this exact exported commit.

Android builds use PowerShell 7, an existing JDK and Android SDK 36 via `JAVA_HOME` and `ANDROID_HOME`. The native module requires an Android development build, not Expo Go.

```powershell
# An authorized release publisher must already have the existing private signer.
New-Item -ItemType Directory -Path dist -Force | Out-Null
pwsh -File scripts/Build-Android.ps1 -Mode Release `
  -Output (Join-Path (Get-Location) 'dist/ReelmDrama-arm64-v8a.apk')
```

The public repository intentionally contains no production signing key, recovery password or DPAPI material. Private builds fail closed without the existing signer; they never silently switch to development signing. Preserve that signer and its independently encrypted recovery backup outside the repository. A local developer build uses a separate development identity/key; it is not a compatible production update.

## Release verification

0.2.0 SHA256: `9c3f0127c1cd3e89dc8a247cabb46b639fda59f2f998ac0d222d7bd9048159a3`.

Private signer certificate SHA256: `2372f2597582f24c23d620adc3102522e59ec10e25bde39ed68a5817b0e8b7b7`.

The release APK has diagnostics disabled and is not debuggable. A representative online NetShort Episode 20 test on the physical Android phone measured 8.852 seconds continuous playback, 11.696 seconds media advancement, 282 rendered frames and maximum timeline drift 0.812 seconds; hold 1.5× restored 1×. This does not certify every platform, title, language, speed or offline format on this APK. Earlier all-format offline evidence applies to its separately recorded APK, not automatically to this release.

Bundled Geist font licences are included in `assets/`.