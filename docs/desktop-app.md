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
- External links open in the system browser.

## Next Desktop Milestones

1. Add a desktop settings page for audio device selection.
2. Add a user-mode audio engine process.
3. Add IPC between Electron and the audio engine.
4. Detect virtual audio driver installation status.
5. Surface install/test status in the UI.
