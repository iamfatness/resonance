# Resonance EQ Chrome Extension

This is the first Chrome extension prototype for applying Resonance EQ to the current browser tab.

## How It Works

```text
Current Chrome tab
  -> chrome.tabCapture MediaStream
  -> offscreen Web Audio graph
  -> Resonance EQ filters
  -> default browser audio output
```

Chrome suppresses normal tab audio after capture starts, so the offscreen document routes the captured stream back to `AudioContext.destination` after applying EQ.

## Load Locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `extension/` folder.
5. Open a YouTube tab.
6. Click the Resonance EQ extension and press **Start**.

## Current Capabilities

- Capture active tab audio.
- Route captured audio through an 8-band Web Audio EQ.
- Mood presets: Focus, Lift, Warmth, Drive, Night.
- Manual EQ mode with sliders and numeric band inputs.
- Instrument boost controls.
- Output gain control.

## Notes

- Capture must be started from a user action.
- This processes the active captured tab, not system-wide audio.
- Chrome may show a tab-capture indicator while Resonance EQ is active.
- This prototype targets Chrome 116+ Manifest V3 offscreen documents.
- Captured audio stays local in Chrome and is not uploaded.
- EQ settings are stored in Chrome extension storage.

## Package

From the repository root:

```powershell
npm run package:extension
```

The zip and metadata manifest are written to `public/downloads/` using the version from `manifest.json`.
