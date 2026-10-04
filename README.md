<img src="assets/icon.png" width="80" alt="Reelm Drama logo">

# Reelm Drama

A portrait-first Android app for discovering short dramas and watching episodes in an immersive, swipeable native player. Built with React Native and Expo, with Reelm's dark-and-lime identity.

## Download

**[Download Reelm Drama v0.1.0 APK](https://github.com/azeez-d3v/reelmdrama/releases/download/v0.1.0/ReelmDrama-v0.1.0-arm64-v8a.apk)**

[All releases](https://github.com/azeez-d3v/reelmdrama/releases) · [SHA-256 checksum](https://github.com/azeez-d3v/reelmdrama/releases/download/v0.1.0/SHA256SUMS.txt)

- Android **7.0 / API 24 or newer**; **64-bit ARM (arm64-v8a)** devices.
- Download the APK, open it on your phone and follow Android's normal installation prompts. If prompted, grant installation access to the browser or file manager you are using.
- This initial APK is a **development-signed build** distributed through GitHub, not a Google Play release. Rebuilding locally can produce a different signing identity.

APK SHA-256:

```text
f3c7db22807082f957118e676f6d4659d0b43a65d9ca6b9ac71e8606bf34ca76
```

## Features

- Home, Discover and Saved views with catalogue search, pagination, series details and episode selection.
- Browse the source's live platform directory. The latest check returned **43 platforms**; counts and availability can change.
- Full-screen portrait playback, vertical episode paging, seek and next/previous controls, with safe-area-aware system bars.
- Tap to reveal controls; hold during playback for **1.5× speed with pitch preservation**, then release to restore normal speed.
- English subtitles when supplied by the source: centered, larger white text, black outline and no caption background. Original-language audio is also supported.
- Bounded episode preparation cache, conditional next-episode prefetch and native video caching. Temporary caching does not provide offline downloads.
- Saved titles, likes and watch progress stored **on the device**.
- Animated Reelm launch screen, reduced-motion handling, loading states and recoverable platform-list errors.

There is no app login, payment system, subscription entitlement, advertising integration or cross-device account sync. English catalogue metadata does not guarantee English dialogue or subtitles on every episode. A platform listing does not guarantee every title will play.

## Architecture

```text
Android app → DramaDünyam catalogue / detail / episode resolver
            → validated HLS playlist in private app cache
Native player → HTTPS CDN video segments directly
Android app → optional advertised English subtitle file
```

The app depends on **DramaDünyam's catalogue and resolver**; it does not run an independent resolver for every original platform. No Reelm server or Cloudflare Worker proxies video segments. Upstream failures, missing episodes, decoder compatibility and signed-URL expiry can affect playback.

The source client validates identities, episode ordinals, response sizes and media hosts. It bounds concurrency, supports cancellation and caches metadata briefly. Viewing cookies stay in operation memory and are not supplied as custom CDN playback headers.

## Develop

Requirements: **Node.js 24+**, npm, and an Android device/emulator. Native builds additionally require Java **17 or 21**, Android SDK **36**, Build Tools **36.0.0**, and configured `JAVA_HOME` and `ANDROID_HOME` (or `ANDROID_SDK_ROOT`).

```sh
git clone https://github.com/azeez-d3v/reelmdrama.git
cd reelmdrama
npm ci
npm run typecheck
npm test
```

`npm test` includes logic and UI contract tests. The initial public export passed **174 tests** and TypeScript checks. Sanitized fixtures in `tests/fixtures/` make tests independent of the original Reelm workspace and live network access.

```sh
npm start
# Separate terminal, with Android SDK configured:
npx expo run:android
```

Diagnostics default to off. `.env.example` contains only the public diagnostics switch; a normal build needs no credentials. The original local diagnostics broker and device-instrumentation helpers are not distributed here.

## Build an APK

On Windows, configure the prerequisites above, then run:

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
& .\scripts\Build-Android.ps1
```

The script stages source in a fresh directory under `.build/android`, uses locked dependencies, generates Android with Expo and forces a fresh release JavaScript bundle. Output:

```text
dist/ReelmDrama.apk
```

Custom output:

```powershell
& .\scripts\Build-Android.ps1 -Output 'C:\builds\ReelmDrama.apk'
```

The script forces diagnostics and automation off. Generated directories, caches, APKs, local environment files and signing material are ignored by Git. Production/store signing is a separate step; the generated release configuration currently uses development signing.

## Project map

| Path | Purpose |
| --- | --- |
| `App.tsx` | Catalogue, navigation and episode orchestration |
| `services/source.ts` | Validated catalogue, detail, HLS and subtitle requests |
| `player.tsx` | Native player lifecycle and pitch-preserving speed boost |
| `episode-cache.ts` | Bounded prepared-episode cache and prefetch |
| `platform-directory.ts` | Platform loading, retry and stale-request protection |
| `ui/` | Screens, controls, motion, splash and subtitles |
| `plugins/` | Expo Android splash/network configuration |
| `tests/` | Logic tests and self-contained fixtures |
| `scripts/Build-Android.ps1` | Standalone Windows APK build |

## Verification and issues

The downloadable APK is byte-identical to the subtitle-refinement build installed and visually checked on a Redmi Note 11 running Android 13. English multiline subtitles were checked on episode 20 of two titles, with controls visible and hidden. Platform browsing was separately checked with 43 directory names and an actual ShortMax selection. These are bounded checks, not a whole-catalogue playback guarantee.

[Report an issue](https://github.com/azeez-d3v/reelmdrama/issues) with the APK version, Android version, platform/title, episode number and visible error. Do not include credentials, cookies or signed stream URLs.

Geist and Geist Mono font licenses are included in `assets/Geist-OFL.txt` and `assets/GeistMono-OFL.txt`. Video content and source services are not included in this repository.
