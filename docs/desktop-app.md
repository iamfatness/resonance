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
- The React desktop panel UI lives in `src/components/DesktopEnginePanel.jsx`, while the Electron bridge hook lives in `src/hooks/useDesktopEngine.js`.
- External links open in the system browser.
- The desktop app can enumerate Windows audio endpoints, select a native output, run the persistent WASAPI router, and route local WAV, pushed PCM, bounded loopback/capture windows, or continuous capture streams into Deck A/B.
- When Windows reports an available Resonance virtual capture endpoint, the engine selects it as the default input for Deck A/B capture.
- The UI can stage plugin chain settings and bypass the app EQ.
- Active staged deck plugins drive a built-in NativeDSP lane in the native router, with Deck A and Deck B processed independently before the master bus.
- The engine persists selected devices, EQ bypass, and plugin-chain settings under the user's app data folder.
- The desktop panel shows readiness diagnostics for native metering, SysVAD source, WDK toolsets, virtual device status, and plugin host status.
- The left sidebar switches between functional Now Playing, Library, Playlist, History, Liked Videos, and Radio panels.

## Next Desktop Milestones

1. Validate the signed/installable virtual audio driver as the default capture source on the target Windows machine.
2. Replace the built-in NativeDSP lane with a sandboxed VST3 host, then validate Waves plugins on that path.
3. Surface install/test status in the UI.
