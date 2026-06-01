# Resonance Desktop App

The desktop app is an Electron shell around the existing Resonance React UI.

## Why Electron First

Electron lets Resonance ship a native desktop window while keeping the current UI, playlist workflow, YouTube decks, direct audio EQ controls, and future extension/driver settings in one codebase.

The virtual audio driver and user-mode engine should remain separate from the UI:

```text
Resonance Desktop UI
  -> user-mode Resonance audio engine
  -> Resonance virtual playback device
```

## Development

Install dependencies:

```powershell
npm install
```

Run the desktop app against Vite:

```powershell
npm run desktop:dev
```

Build the web UI and open it in Electron:

```powershell
npm run desktop:run
```

## Current Scope

- Desktop shell opens the app view by default.
- Node integration is disabled.
- A preload bridge exposes minimal desktop metadata at `window.resonanceDesktop`.
- A preload bridge exposes `window.resonanceDesktop.engine` for engine state, settings, devices, and meters.
- External links open in the system browser.
- The desktop app can enumerate Windows audio endpoints and show mock engine meters.

## Next Desktop Milestones

1. Add a native WASAPI helper for reliable endpoint enumeration and format discovery.
2. Capture from a loopback or virtual playback endpoint.
3. Render processed PCM to the selected output endpoint.
4. Detect virtual audio driver installation status.
5. Surface install/test status in the UI.
