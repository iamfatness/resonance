# Resonance

Resonance is a web-based music player prototype for mixing two YouTube videos and applying mood-driven EQ guidance.

## Current Features

- Two YouTube playback decks.
- Independent Deck A / Deck B volume controls.
- Active deck loading from pasted YouTube URLs or video IDs.
- Queue loading into the selected deck.
- Mood presets that adjust deck mix levels and instrument boost guidance.
- Direct audio file / URL EQ path for real browser-side audio filtering.
- Plugin rack controls with app EQ bypass.
- Chrome extension prototype for real current-tab EQ using `chrome.tabCapture`.
- Cloudflare Worker deployment for `resonance.iamfatness.us`.

## Important Audio Limitation

Browsers isolate YouTube iframe audio, so the web app cannot directly route YouTube playback through Web Audio EQ filters. Mood presets affect YouTube decks through volume mixing and EQ guidance. Real EQ processing is available for direct audio sources.

The long-term direction is a standalone desktop app with a Windows virtual audio endpoint and a user-mode Resonance engine.

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

The main YouTube field accepts video links, search text, or public playlist links. Playlist links import up to 25 public videos, load the first video into the selected deck, and place the rest in the Up next queue.

The web app saves deck URLs, imported playlists, liked videos, queue, repeat mode, deck count, mood preset, volumes, and EQ settings in local browser storage so refreshes restore the working session.

The Up next queue supports clearing, loading a queued item, play-next placement, move up/down, and removing queued videos. Search results can be loaded into the selected deck, played next, or added to the queue.

Search results and imported playlists are enriched with YouTube video metadata, including real durations and live/upcoming status when the YouTube Data API returns it.

Desktop deck processing includes per-deck pan, per-deck EQ curves, per-deck EQ bypass, and per-deck plugin-chain state. These settings are sent to the Electron audio engine and persisted, but actual VST/Waves DSP for YouTube sources still requires the desktop audio router/virtual device path to deliver PCM audio into the engine.

The desktop engine has a mock two-bus routing prototype for Deck A and Deck B. The desktop panel shows simulated per-deck input, left, and right meters that react to deck volume, pan, EQ activity, and active staged plugins before real PCM routing is connected.

The mock routing logic now lives behind `engine/audio-router.cjs`, which is the boundary for the future native backend. The renderer reads router state from the existing desktop engine IPC API, so native per-deck PCM routing can replace mock meters without changing the app UI contract.

Build:

```powershell
npm run build
```

Deploy:

```powershell
npm run deploy:worker
```

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
```

Create a local Windows desktop package:

```powershell
npm run desktop:package
```

The packaged app is written to:

```text
release/Resonance-local/Resonance.exe
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
