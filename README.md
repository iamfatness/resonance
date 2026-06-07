# Resonance

Resonance is a DJ-style music player prototype for mixing embedded YouTube decks with mood-driven EQ guidance and desktop-native deck processing experiments.

## Current Features

- Two YouTube playback decks.
- Independent Deck A / Deck B volume controls.
- DJ mixer strip with cue-style deck selection, crossfader, level meters, and per-deck filter controls.
- Three hot cues per deck for setting and jumping to YouTube playback positions.
- Deck mode indicators that separate YouTube Mix Mode from Native Processing Mode.
- Active deck loading from pasted YouTube URLs or video IDs.
- Queue loading into the selected deck.
- Mood presets that adjust deck mix levels and instrument boost guidance.
- Direct audio file / URL EQ path for real browser-side audio filtering.
- DJ-style per-deck effects controls with advanced plugin hosting kept secondary.
- Desktop deck cards expose native WAV loading, native play/pause/stop, and Deck A/B capture controls.
- Chrome extension prototype for real current-tab EQ using `chrome.tabCapture`.
- Cloudflare Worker deployment for `resonance.iamfatness.us`.

## Important Audio Limitation

Browsers isolate YouTube iframe audio, so the web app cannot directly route YouTube playback through Web Audio EQ filters. Resonance now labels this as **YouTube Mix Mode**: playback, search, playlists, volume, crossfader, and hot cues are live, while EQ/filter/effects are armed for direct, native, or captured sources. Real EQ processing is available for direct audio sources.

The desktop direction is a DJ app first: Deck A and Deck B stay central, embedded YouTube remains the discovery/playback surface, and app-owned audio sources route through the user-mode Resonance engine for per-deck EQ, pan, DJ effects, and optional advanced plugins. A Windows virtual audio endpoint remains an optional future path for system-wide routing rather than a requirement for the main desktop app.

## Chrome Extension Prototype

The first browser-native EQ path lives in:

```text
extension/
```

Load it locally from `chrome://extensions` with **Developer mode** and **Load unpacked**. The extension captures the active Chrome tab, routes audio through Web Audio filters, and plays the processed signal back to the default output.

Package the beta extension zip:

```powershell
npm run package:extension
```

The generated beta package is served from:

```text
https://resonance.iamfatness.us/downloads/resonance-eq-0.1.0.zip
```

Tester instructions live in:

```text
docs/extension-beta.md
```

## Development

```powershell
npm install
npm run dev
```

Local app:

```text
http://127.0.0.1:5173
```

YouTube keyword search uses the official YouTube Data API through the local Vite middleware or deployed Cloudflare Worker. Set a local API key before `npm run dev` if you want search results locally:

```powershell
$env:YOUTUBE_API_KEY='your-youtube-data-api-key'
npm run dev
```

Set the production Worker secret before deploying:

```powershell
npx wrangler secret put YOUTUBE_API_KEY --config wrangler.worker.jsonc
```

Playlist imports use public YouTube playlist data from the same API route. Resonance does not require Google login for this path; duplicate playlist videos are skipped before the queue is created.

The main YouTube field accepts video links, search text, or public playlist links. Playlist links import up to 25 public videos, load the first video into the selected deck, and place the rest in the Up next queue.

The web app saves deck URLs, imported playlists, liked videos, queue, repeat mode, deck count, mood preset, volumes, and EQ settings in local browser storage so refreshes restore the working session.

The Up next queue supports clearing, loading a queued item, play-next placement, move up/down, and removing queued videos. Search results can be loaded into the selected deck, played next, or added to the queue.

Search results and imported playlists are enriched with YouTube video metadata, including real durations and live/upcoming status when the YouTube Data API returns it.

Desktop deck processing includes per-deck pan, DJ filter, per-deck EQ curves, per-deck EQ bypass, DJ effect-chain state, and optional advanced plugin-chain state. These settings are sent to the Electron audio engine and persisted. Local WAV decks, pushed PCM, bounded capture buffers, and continuous Deck A/B capture streams can now flow through the native persistent router without requiring a virtual driver. When Windows reports a Resonance virtual capture endpoint, the desktop engine can select it as a capture input, but the main product path is app-owned audio first. Active staged DJ effects feed a built-in NativeDSP lane, and the first staged bridge-capable VST3 plugin per deck can receive live Deck A/B PCM through the native bridge with NativeDSP fallback when loading, processing, or silence checks fail.

Desktop VST3/Waves scan results are merged into the app plugin catalog when the Electron engine reports them. The desktop engine now probes eligible VST3 candidates through the native bridge process and reports per-plugin bridge status, path validation, parameter-load availability, bridge PCM block-processing availability, parameter-forwarding availability, and exposed parameter metadata when available. The native bridge builds against the Steinberg VST3 SDK submodule, can instantiate VST3 modules for parameter enumeration, can process an internal 32-bit float test block, and can process external interleaved PCM16 blocks through a loaded VST3 processor. The persistent native router now sends each deck's live PCM blocks to the first staged bridge-capable VST3 plugin for that deck, forwards normalized parameter values only when that plugin passes the parameter-forwarding probe, and falls back to the built-in NativeDSP lane if loading, processing, or silent output checks fail.

Staged plugins persist editable enabled, wet/dry, input gain, output gain, preset-name parameters, exposed plugin control values, and local named presets. NativeDSP plugins apply those values through the current router lane; blocked VST3/Waves candidates keep the same session state without running native code.

The desktop engine has a native two-bus routing prototype for Deck A and Deck B when the audio router helper is built. In the desktop app, each deck card shows whether the native side has a processable source and whether VST3 is active, pending, degraded, or using fallback processing. The deck cards now also expose the native source lane directly: choose WAV, play/pause, stop, or start/stop capture for Deck A or Deck B without opening advanced settings. The collapsed Desktop Audio Engine settings section still exposes the full per-deck bus cards with input/left/right meters from native snapshots for local WAV, pushed PCM, bounded capture, and continuous capture sources, with mock meters still available as a fallback.

The routing logic lives behind `engine/audio-router.cjs`, which manages the native persistent router process. The renderer reads router state from the existing desktop engine IPC API, so virtual-device capture and plugin-host sources can keep using the same app UI contract.

Build:

```powershell
npm run build
```

Quality checks:

```powershell
npm run lint
npm test
npm run smoke:browser
npm run smoke:deploy
npm run format:check
```

Deploy:

```powershell
npm run deploy:worker
```

Release checklist and known limitations:

```text
docs/release-checklist.md
docs/known-limitations.md
docs/project-evaluation-and-next-plan.md
```

## Project Structure

- `src/lib/presets.js` is the canonical source for mood presets, EQ bands, curve math, instrument boosts, and deck-processing defaults.
- `src/lib/youtube.js` contains pure YouTube URL, playlist, timestamp, and watch URL helpers.
- `src/lib/youtubeApi.js` contains shared YouTube Data API response normalization for the local Vite middleware and Cloudflare Worker.
- `src/lib/storage.js` owns browser app-state persistence under `resonance.appState.v1`.
- `src/hooks/` contains platform hooks for YouTube iframe playback, direct browser EQ, and the desktop engine bridge.
- `src/platform/youtubeIframeApi.js` owns the singleton YouTube iframe API script loader used by both decks.
- `src/components/` contains extracted UI surfaces such as the landing page, YouTube deck, direct audio source panel, search results, sidebar panels, queue panel, EQ/plugin panel, and desktop engine panel.
- `extension/lib/presets.js` mirrors the preset math used by the Chrome extension popup and offscreen processor.
- `engine/` owns the Electron child-process audio engine and keeps its settings payload aligned with the preset/deck-processing contract.

## Desktop App

Run the Electron desktop shell:

```powershell
npm run desktop:dev
```

Build and run the desktop shell from `dist`:

```powershell
npm run desktop:run
```

Build native desktop helpers:

```powershell
npm run native:wasapi-meter
npm run native:audio-router
npm run native:vst3-bridge
```

Create a local Windows desktop package:

```powershell
npm run desktop:package
```

The packaged app is written to:

```text
release/Resonance-local/Resonance.exe
```

Create an installable Windows beta build:

```powershell
npm run desktop:installer
```

The installer is written to:

```text
release/installer/Resonance-Setup-0.2.0-x64.exe
```

Desktop notes live in:

```text
docs/desktop-app.md
```

Audio engine notes live in:

```text
docs/audio-engine.md
```

Plugin hosting notes live in:

```text
docs/plugin-hosting.md
```

Project roadmap and open work live in:

```text
docs/roadmap.md
```

Current desktop backend status:

- Windows audio endpoint enumeration.
- Engine start/stop controls.
- Desktop-only input/output meter display.
- Native WASAPI loopback metering when the helper is built.
- Mock DSP/meter fallback when the native helper is missing.
- Plugin chain settings and app EQ bypass controls.

Build the native WASAPI meter helper:

```powershell
npm run native:wasapi-meter
```

## Driver Work

Build the local SysVAD sample once the WDK Visual Studio driver toolsets are installed:

```powershell
npm run driver:build
```

Check driver/capture readiness without installing or removing anything:

```powershell
npm run driver:capture-readiness
```

Prepare and verify a driver signing submission package without installing anything:

```powershell
npm run driver:package-signing
npm run driver:verify-signing
```

The signing package is written under `release/driver-signing/` with a zip and JSON manifest.

Secure Boot beta machines require a Microsoft-signed driver package if the optional virtual audio endpoint is used. The local test-signed SysVAD install path is only for VMs or dedicated test machines with Secure Boot disabled. Full install, capture test, and rollback steps live in:

```text
docs/virtual-audio-device.md
```
