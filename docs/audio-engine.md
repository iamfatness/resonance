# Resonance Audio Engine

The desktop audio engine is a user-mode process started by Electron.

## Current Backend

The current engine is a process boundary, control protocol, Windows endpoint enumerator, deck router contract, live metering backend, and persistent native WAV playback bridge. When the native router helper is built, Resonance starts a long-running WASAPI router process and can play local WAV files from Deck A and Deck B with per-deck gain, pan, and EQ. Browser YouTube audio still cannot be routed through this native chain until a desktop capture or virtual-device path is connected.

```text
Electron main process
  -> child process: engine/audio-engine.cjs
  -> IPC commands: start, stop, settings, device selection, deck playback
  -> native child process: native/audio-router --server
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
- `--run-once` initializes the default render client and reports real WASAPI buffer size, device period, and route health without streaming audio yet.
- `--render-silence --duration-ms 250` starts the render client, writes silent buffers, and reports frames written, passes, underruns, and elapsed time.
- `--render-tone --duration-ms 250` generates two quiet deck test tones, applies per-deck gain, pan, and first-pass native EQ band gain, mixes them into the WASAPI render buffer, and reports per-deck/master peaks.
- `--render-wav --deck-a C:\path\a.wav --deck-b C:\path\b.wav --deck-a-start-ms 12000 --deck-b-start-ms 0 --duration-ms 1000` decodes one or two PCM/float WAV files, applies per-deck gain, pan, and first-pass native EQ, then mixes them through the same WASAPI render path. Either deck may be omitted for solo playback.
- `--server` starts a persistent WASAPI render process. The engine sends newline-delimited JSON commands on stdin (`load`, `settings`, `play`, `pause`, `stop`, `seek`, `exit`) and receives newline-delimited JSON snapshots on stdout with source state, routes, peaks, render frames, and underrun counts.

The tone and WAV render paths now use native `DeckState`, `DeckStats`, and `RenderStats` structures plus reusable helpers for source generation, EQ gain, pan, mixing, and peak tracking. This is the same path that virtual-device capture and plugin processing should feed later.

The Electron desktop shell exposes this path through Deck A and Deck B WAV pickers in the desktop engine panel. Each deck can load a WAV, play, pause, stop, and seek. The engine now keeps one native router process open while decks play, forwards per-deck settings changes to that process, and uses native snapshots for meters and deck positions.

```text
Deck A playback -> app EQ/plugin chain -> master output
Deck B playback -> app EQ/plugin chain -> master output
```

The native backend should replace the mock meter source without changing the renderer API. Its job is to capture or receive per-deck PCM, apply the configured processing chain, then render the summed output to the selected Windows output device.

## Next Milestones

1. Add selectable WASAPI output endpoint support to the persistent router.
2. Replace PowerShell endpoint enumeration with a native WASAPI helper.
3. Add a native router backend that can accept Deck A/B PCM independently from non-WAV sources.
4. Capture from a loopback/virtual playback endpoint.
5. Render processed PCM to the selected output endpoint.
6. Move the Web Audio EQ model into a shared DSP config shape.
7. Add native VST3 plugin hosting for staged plugin chains.
