# Resonance Audio Engine

The desktop audio engine is a user-mode process started by Electron.

## Current Prototype

The current engine is a process boundary and control protocol, not real WASAPI processing yet.

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

Enumerate audio devices from the command line:

```powershell
npm run audio:devices
```

## Why This Boundary Exists

Real audio routing should not run inside the renderer UI. Keeping the engine in a separate process lets Resonance restart audio processing, report failures, and later swap the mock backend for a native WASAPI backend without restructuring the app.

## Next Milestones

1. Replace PowerShell endpoint enumeration with a native WASAPI helper.
2. Capture from a loopback/virtual playback endpoint.
3. Render processed PCM to the selected output endpoint.
4. Move the Web Audio EQ model into a shared DSP config shape.
5. Add limiter and metering events back to the renderer.
