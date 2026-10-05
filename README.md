<p align="center"><img src="assets/icon.png" width="88" alt="Reelm Drama logo"></p>

# Reelm Drama

A standalone Android drama player with a dark, lime-accented interface, vertical episode navigation and local watch history.

**[Download Reelm Drama 0.2.2](https://github.com/azeez-d3v/reelmdrama/releases/download/v0.2.2/ReelmDrama-arm64-v8a.apk)** · [All releases](https://github.com/azeez-d3v/reelmdrama/releases)

Android 7.0 / API 24 or newer; **arm64-v8a**. Package `org.reelm.drama`, version **0.2.2 / code 5**. Complete Android's normal installation and Play Protect flow.

## Features

- **Home · Library · Settings**. Home combines browsing, inline search and runtime platform filters; empty source platforms remain visible.
- Portrait player: tap to pause/resume, vertical episode swipe, seek, timeline loading, immersive controls and configurable press-and-hold speed.
- Saved, Recents, exact episode/time resume and local likes.
- Subtitle-only text-size settings with a live preview; app text retains system accessibility scaling.
- Filled library Export/Import buttons and manual, verified GitHub APK updates.

**Offline episode downloads are removed.** Playback requires internet; bounded online episode/CDN caches remain. Upgrade cleanup targets only recognized former download files and their exact key, preserving unknown data, library and updater storage.

The source is DramaDünyam's normal public catalogue/resolver. Requests originate on the phone; video travels directly from the source/CDN to native playback, without a Reelm video relay. Source availability can change; a catalogue listing is not a playable-stream guarantee.

The catalogue is English-localized. Original audio with English subtitles is supported; only advertised English subtitle tracks are selected. Localization does not guarantee English dialogue or captions on every title.

Library/preferences are on this device only. There is no app account, cloud sync, D1, payment or premium entitlement. Transfer documents contain library metadata, not media, credentials or keys.

## App updates

Settings → App updates → Check reads public GitHub Releases without a client token. Older/equal numeric release versions are not offered; unknown labels are unverified. The checker no longer offers 0.2.0 to a phone already running 0.2.1. A fresh successful current check clears that obsolete downgrade failure, not unrelated failures. Optional native status failures do not discard a successful feed check.

A newer candidate requires exactly one asset named `ReelmDrama-arm64-v8a.apk` and a published SHA256 digest. Native code independently verifies bytes, package, private signer and **strictly increasing versionCode** before Android asks for installation confirmation. A version label alone never authorizes installation.

Already on a private-signed release? Install this update in place; do not uninstall or repeat the signing migration.

### Old development-signed installations

Private release signing started with 0.2.0. Android does not install a differently signed APK over the old app.

1. Use the Legacy migration APK in the [0.2.0 release](https://github.com/azeez-d3v/reelmdrama/releases/tag/v0.2.0) to add library transfer to the older installation. Do not uninstall first.
2. Export in Settings → Library transfer. Retain the document and confirm **Library export verified**.
3. Uninstall the Legacy app, install the current private APK, and import that document.

Uninstall removes app-private data and old encrypted media/keys; media is not exported. Offline downloads are not supported in the current app. Keep the export until Saved, Recents, resume points and preferences are checked.

## Development

This is the curated standalone source export. Canonical development remains in the parent Reelm project's `drama-mobile/`. Read `AGENTS.md` before building or creating files; reuse matching dependencies and one bounded staging directory.

```powershell
# Node 24; install only when dependencies do not match the lockfile.
npm ci --no-audit --no-fund
npm run typecheck
npm test
```

`npm test` includes `tests/*.test.mjs` and `ui/*.test.mjs`. Sanitized public source fixtures are in `tests/fixtures/`, without viewing cookies, signed streams or personal library records. See Actions for checks of this exact exported commit.

Android builds use PowerShell 7, an existing Java 21 JDK and Android SDK 36 via `JAVA_HOME` and `ANDROID_HOME`. This native app does not run in Expo Go.

```powershell
# Authorized publishers must already possess the existing private signer.
New-Item -ItemType Directory -Path dist -Force | Out-Null
pwsh -File scripts/Build-Android.ps1 -Mode Release `
  -Output (Join-Path (Get-Location) 'dist/ReelmDrama-arm64-v8a.apk')
```

No production key, recovery passphrase or DPAPI signing material is published. Private builds fail closed without the existing signer; they never silently switch to development signing. Keep the signer and its encrypted recovery backup outside this repository.

## Release verification

0.2.2 APK SHA256: `665041e8e9f3bf91ac12f9084b6ce230249a4060681ceb77be93ae3e46c5f758`.

Private signer certificate SHA256: `2372f2597582f24c23d620adc3102522e59ec10e25bde39ed68a5817b0e8b7b7`.

Canonical checks passed **338/338**, TypeScript and the fresh reused-dependency release build. This APK is not debuggable; diagnostics and obsolete offline APIs are absent. Physical-phone updater and representative NetShort Episode 20 playback checks are release gates; these do not certify every platform, title or audio language, nor an Android updater-confirmation installation. See the release notes for the completed checks.

Bundled Geist font licences are included in `assets/`.
