# Resonance

Resonance is a web-based music player prototype for mixing two YouTube videos and applying mood-driven EQ guidance.

## Current Features

- Two YouTube playback decks.
- Independent Deck A / Deck B volume controls.
- Active deck loading from pasted YouTube URLs or video IDs.
- Queue loading into the selected deck.
- Mood presets that adjust deck mix levels and instrument boost guidance.
- Direct audio file / URL EQ path for real browser-side audio filtering.
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

Desktop notes live in:

```text
docs/desktop-app.md
```

Audio engine notes live in:

```text
docs/audio-engine.md
```

Current desktop backend status:

- Windows audio endpoint enumeration.
- Engine start/stop controls.
- Desktop-only input/output meter display.
- Mock DSP/metering until the WASAPI PCM backend is wired.

## Driver Work

Build the local SysVAD sample once the WDK Visual Studio driver toolsets are installed:

```powershell
npm run driver:build
```
