# Resonance Audio Engine

The desktop audio engine is a user-mode process started by Electron.

## Current Backend

The current engine is a process boundary, control protocol, Windows endpoint enumerator, deck router contract, and live metering backend. When the native helper is built, Resonance reads default-output WASAPI loopback levels for real peak/RMS meters; otherwise it falls back to generated development meters. Real processed PCM routing is not wired yet.

```text
Electron main process
  -> child process: engine/audio-engine.cjs
  -> IPC commands: start, stop, settings, device selection
  -> renderer bridge: window.resonanceDesktop.engine
```

The engine reports:

- running/idle status
- Windows audio endpoint enumeration
- selected input/output device IDs
- persisted settings file path
- desktop audio router backend and Deck A/B route state
- active EQ settings
- app EQ bypass state
- staged plugin-chain settings
- desktop readiness diagnostics
- live input/output peak meters
- clipping status

Enumerate audio devices from the command line:

```powershell
npm run audio:devices
```

Build the native WASAPI meter helper:

```powershell
npm run native:wasapi-meter
```

Build the native audio router skeleton:

```powershell
npm run native:audio-router
```

## Why This Boundary Exists

Real audio routing should not run inside the renderer UI. Keeping the engine in a separate process lets Resonance restart audio processing, report failures, and later swap the mock backend for a native WASAPI backend without restructuring the app.

## Desktop Router

`engine/audio-router.cjs` is the stable router boundary for Deck A and Deck B. Today it runs in mock mode and produces simulated per-deck bus meters that react to deck volume, pan, EQ activity, and staged plugins. It also publishes route records so the UI can show where each deck is expected to flow.

`native/audio-router` is the native helper skeleton for the future WASAPI router backend. Its first commands are intentionally narrow:

- `--describe` reports the helper name, version, command list, and capability flags.
- `--probe` initializes COM, probes default Windows audio endpoints, and reports the default render mix format.

```text
Deck A playback -> app EQ/plugin chain -> master output
Deck B playback -> app EQ/plugin chain -> master output
```

The native backend should replace the mock meter source without changing the renderer API. Its job is to capture or receive per-deck PCM, apply the configured processing chain, then render the summed output to the selected Windows output device.

## Next Milestones

1. Replace PowerShell endpoint enumeration with a native WASAPI helper.
2. Select specific WASAPI loopback/output endpoints instead of only the system default meter.
3. Add a native router backend that can accept Deck A/B PCM independently.
4. Capture from a loopback/virtual playback endpoint.
5. Render processed PCM to the selected output endpoint.
6. Move the Web Audio EQ model into a shared DSP config shape.
7. Add native VST3 plugin hosting for staged plugin chains.
