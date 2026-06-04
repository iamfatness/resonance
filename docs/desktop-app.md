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

Create a local Windows package:

```powershell
npm run desktop:package
```

The package is created at:

```text
release/Resonance-local/Resonance.exe
```

## Current Scope

- Desktop shell opens the app view by default.
- Node integration is disabled.
- A preload bridge exposes minimal desktop metadata at `window.resonanceDesktop`.
- A preload bridge exposes `window.resonanceDesktop.engine` for engine state, settings, devices, and meters.
- External links open in the system browser.
- The desktop app can enumerate Windows audio endpoints, select a native output, run the persistent WASAPI router, and route local WAV, pushed PCM, or bounded loopback/capture windows into Deck A/B.
- The UI can stage plugin chain settings and bypass the app EQ.
- The engine persists selected devices, EQ bypass, and plugin-chain settings under the user's app data folder.
- The desktop panel shows readiness diagnostics for native metering, SysVAD source, WDK toolsets, virtual device status, and plugin host status.
- The left sidebar switches between functional Now Playing, Library, Playlist, History, Liked Videos, and Radio panels.

## Next Desktop Milestones

1. Promote bounded loopback/virtual-device capture into continuous Deck A/B capture streams.
2. Host VST3 plugins, including Waves plugins, in the desktop audio engine.
3. Detect virtual audio driver installation status.
4. Surface install/test status in the UI.
