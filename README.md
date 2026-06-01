# Resonance

Resonance is a web-based music player prototype for mixing two YouTube videos and applying mood-driven EQ guidance.

## Current Features

- Two YouTube playback decks.
- Independent Deck A / Deck B volume controls.
- Active deck loading from pasted YouTube URLs or video IDs.
- Queue loading into the selected deck.
- Mood presets that adjust deck mix levels and instrument boost guidance.
- Direct audio file / URL EQ path for real browser-side audio filtering.
- Cloudflare Worker deployment for `resonance.iamfatness.us`.

## Important Audio Limitation

Browsers isolate YouTube iframe audio, so the web app cannot directly route YouTube playback through Web Audio EQ filters. Mood presets affect YouTube decks through volume mixing and EQ guidance. Real EQ processing is available for direct audio sources.

The long-term direction is a standalone desktop app with a Windows virtual audio endpoint and a user-mode Resonance engine.

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
