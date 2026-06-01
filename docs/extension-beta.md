# Resonance EQ Extension Beta

The Chrome extension beta captures the active Chrome tab and routes it through the Resonance EQ engine.

## Download

Beta package:

```text
https://resonance.iamfatness.us/downloads/resonance-eq-0.1.0.zip
```

## Install for Beta Testing

1. Download the zip.
2. Extract the zip to a normal folder.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the extracted folder that contains `manifest.json`.
7. Open a YouTube tab.
8. Click **Resonance EQ** in Chrome extensions and press **Start**.

## What Beta Testers Should Check

- Audio still plays after pressing **Start**.
- Mood presets change the tone.
- Manual EQ bands change the tone.
- Instrument boosts are audible.
- Output gain can reduce clipping.
- Pressing **Stop** returns the tab to normal playback.

## Current Limits

- The extension processes the currently captured tab, not system-wide audio.
- Two YouTube videos inside one tab are already mixed by Chrome before capture.
- Chrome may show a capture indicator while the extension is active.
- This is an unpacked beta package, not a Chrome Web Store listing yet.

## Chrome Web Store Beta Path

For a hosted beta, upload `resonance-eq-0.1.0.zip` in the Chrome Web Store Developer Dashboard and publish it as either:

- **Trusted testers** for private tester emails.
- **Unlisted** for anyone with the link.

Chrome Web Store publishing requires access to the owner's Developer Dashboard account.
