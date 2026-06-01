# Resonance Audio Engine

The desktop audio engine is a user-mode process started by Electron.

## Current Backend

The current engine is a process boundary, control protocol, Windows endpoint enumerator, and live metering backend. When the native helper is built, Resonance reads default-output WASAPI loopback levels for real peak/RMS meters; otherwise it falls back to generated development meters. Real processed PCM routing is not wired yet.

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
- active EQ settings
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

## Why This Boundary Exists

Real audio routing should not run inside the renderer UI. Keeping the engine in a separate process lets Resonance restart audio processing, report failures, and later swap the mock backend for a native WASAPI backend without restructuring the app.

## Next Milestones

1. Replace PowerShell endpoint enumeration with a native WASAPI helper.
2. Select specific WASAPI loopback/output endpoints instead of only the system default meter.
3. Capture from a loopback/virtual playback endpoint.
4. Render processed PCM to the selected output endpoint.
5. Move the Web Audio EQ model into a shared DSP config shape.
