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

The local package includes the Electron shell, built web bundle, audio engine, plugin host helper, WASAPI meter helper, and native Deck A/B audio router helper. A package manifest is written to:

```text
release/Resonance-local/resonance-package.json
```

Create an installable Windows beta build:

```powershell
npm run desktop:installer
```

The installer is created at:

```text
release/installer/Resonance-Setup-0.2.0-x64.exe
```

The installer uses NSIS through `electron-builder`, creates Start Menu and desktop shortcuts, and installs the Electron desktop app plus the native WASAPI meter, Deck A/B audio router, and VST3 bridge helper. The virtual audio driver is not bundled into this installer yet; keep driver installation separate until the driver signing and update path are stable.

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
- The plugin host helper process reports its protocol and resolves staged Deck A/B plugin-chain plans without loading third-party binaries yet.
- The engine persists selected devices, EQ bypass, and plugin-chain settings under the user's app data folder.
- The desktop panel shows readiness diagnostics for native metering, SysVAD source, WDK toolsets, virtual device status, and plugin host status.
- The desktop panel can export a beta diagnostics bundle with engine state, device scan, router snapshot, plugin scan, diagnostics checks, and recent export status.
- The left sidebar switches between functional Now Playing, Library, Playlist, History, Liked Videos, and Radio panels.

## Beta Diagnostics

Click **Export Diagnostics** in the desktop engine panel to write a redacted JSON bundle under:

```text
%APPDATA%\Resonance\diagnostics
```

The bundle includes app version, platform, engine state, device scan, router state, plugin host state, diagnostics checks, playback deck state, and selected settings. Keys that look like secrets, tokens, authorization values, or API keys are redacted before writing.

## Driver/Capture Readiness

Run the desktop capture readiness check before a driver beta test:

```powershell
npm run driver:capture-readiness
```

The command is read-only. It summarizes the built driver package, Secure Boot/signing path, active Resonance endpoints, capture endpoint detection, native router helper availability, and the remaining sustained Deck A/B capture test.

For the manual capture pass, build the native router, open the desktop app, select the Resonance capture endpoint for both decks, and run continuous Deck A/B capture for at least 20 minutes while watching the desktop panel meters, capture status, and underrun/failure diagnostics.

## Latency Controls

The desktop engine panel includes native router latency controls:

- `Low` targets a 30 ms native buffer.
- `Balanced` targets an 80 ms native buffer and is the default.
- `Stable` targets a 160 ms native buffer for slower systems.
- `Custom` enables a 20-500 ms buffer field.

Latency settings are saved with the app state and sent to the native router through the existing engine settings IPC path. If the persistent native router is already running, a profile change is sent live and the router snapshot can report `restart required` when a restart is needed for the new buffer duration to take full effect.

## Next Desktop Milestones

1. Validate the signed/installable virtual audio driver as the default capture source on the target Windows machine using `npm run driver:capture-readiness` plus the sustained Deck A/B capture checklist.
2. Replace the built-in NativeDSP lane with a sandboxed VST3 host, then validate Waves plugins on that path.
3. Surface install/test status in the UI.
