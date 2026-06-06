# Resonance Audio Engine

The desktop audio engine is a user-mode process started by Electron.

## Current Backend

The current engine is a process boundary, control protocol, native Windows endpoint enumerator, deck router contract, live metering backend, persistent native WAV playback bridge, and PCM/capture input path. When the native router helper is built, Resonance starts a long-running WASAPI router process and can play local WAV files, pushed PCM blocks, bounded capture windows, or continuous capture streams from Deck A and Deck B with per-deck gain, pan, EQ, and selected output routing. Browser YouTube audio still cannot be captured directly from an iframe, but the native router can now ingest continuous WASAPI loopback/capture streams from endpoints, including the Resonance virtual device when Windows exposes it.

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
- staged plugin-chain settings, built-in NativeDSP deck processing, and scan-only VST2/VST3 candidate discovery
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

`engine/audio-router.cjs` is the stable router boundary for Deck A and Deck B. It still provides mock meters when native helpers are missing, but when `native/audio-router` is built it manages the persistent router process and forwards deck playback, output selection, gain, pan, and EQ settings.

`native/audio-router` is the native WASAPI router backend. Its current commands are intentionally narrow:

- `--describe` reports the helper name, version, command list, and capability flags.
- `--probe` initializes COM, probes default Windows audio endpoints, and reports the default render mix format.
- `--run-once` initializes the default render client and reports real WASAPI buffer size, device period, and route health without streaming audio yet.
- `--render-silence --duration-ms 250` starts the render client, writes silent buffers, and reports frames written, passes, underruns, and elapsed time.
- `--render-tone --duration-ms 250` generates two quiet deck test tones, applies per-deck gain, pan, and first-pass native EQ band gain, mixes them into the WASAPI render buffer, and reports per-deck/master peaks.
- `--render-wav --deck-a C:\path\a.wav --deck-b C:\path\b.wav --deck-a-start-ms 12000 --deck-b-start-ms 0 --duration-ms 1000` decodes one or two PCM/float WAV files, applies per-deck gain, pan, and first-pass native EQ, then mixes them through the same WASAPI render path. Either deck may be omitted for solo playback.
- `--list-devices` returns active WASAPI render and capture endpoints with MMDevice IDs that can be opened by the native router.
- `--server --output-id <wasapi-device-id>` starts a persistent WASAPI render process on a selected output endpoint. The engine sends newline-delimited JSON commands on stdin (`load`, `pcm`, `captureLoopback`, `startCapture`, `stopCapture`, `settings`, `play`, `pause`, `stop`, `seek`, `exit`) and receives newline-delimited JSON snapshots on stdout with source state, source type, capture streaming state, routes, peaks, render frames, PCM queue/capture counts, device ID/name, and underrun counts.

The tone and one-shot WAV render paths use the legacy low/mid/high EQ compatibility path. Persistent `--server` playback uses the deck's full 8-band biquad EQ chain for the 31 Hz, 62 Hz, 125 Hz, 250 Hz, 500 Hz, 1 kHz, 2 kHz, and 4 kHz UI bands before pan and mix.

The Electron desktop shell exposes this path through Deck A and Deck B WAV pickers in the desktop engine panel. Each deck can load a WAV, play, pause, stop, seek, accept pushed PCM blocks, capture a bounded WASAPI loopback/capture window, or run a continuous capture stream into the deck PCM buffer. When a Windows input endpoint with Resonance in its name is detected, the engine selects it as the default capture source. The Output dropdown uses native WASAPI endpoint IDs, restarts the persistent router when the selected output changes, reloads loaded decks, and preserves play state where possible. The engine keeps one native router process open while decks play, forwards per-deck settings changes to that process, and uses native snapshots for meters, capture status, and deck positions.

`engine/plugin-host.cjs` is the desktop plugin-host boundary for the next phase. Today it performs VST2/VST3 candidate discovery, reports supported formats, candidate counts, and a short candidate list to the Electron UI, and exposes a refresh command over IPC. Waves candidates are classified by vendor while preserving their actual VST format. Eligible VST3 candidates are also probed through `native/vst3-bridge`, which builds against the Steinberg VST3 SDK submodule and reports plugin path validation, bridge load status, parameter-load availability, bridge PCM test-processing availability, and exposed parameter metadata when the bridge returns it. It also converts active staged deck plugin chains into bounded native settings for the built-in NativeDSP test processor. `engine/plugin-host-worker.cjs` is the sandbox helper process contract: it can describe capabilities and resolve Deck A/B chain plans. The desktop engine now manages the helper as a persistent child process while the engine is running and refreshes chain plans through that process when deck processing settings change.

The renderer merges scanned desktop candidates into the plugin catalog so users can stage discovered VST2/VST3 candidates on Deck A or Deck B. VST3 candidates can expose real parameter controls when the native bridge reports `status: loaded`, and the bridge can call `processTone` to run an internal 32-bit float test block through that processor. They remain `blocked-third-party` for live deck audio unless the native bridge reports `processingEnabled: true`, which is intentionally held false until Deck A/B PCM is wired into the VST3 process path.

Each staged plugin also persists parameter state in `deckProcessing.pluginChain`: enabled, wet/dry, input gain, output gain, preset name, and exposed plugin control values. NativeDSP entries use those values in the current router plugin lane; blocked VST2/VST3 entries store them for the future host without executing.

```text
Deck A playback -> deck EQ or EQ bypass -> NativeDSP plugin lane -> master output
Deck B playback -> deck EQ or EQ bypass -> NativeDSP plugin lane -> master output
```

The native backend should replace the mock meter source without changing the renderer API. Its job is to capture or receive per-deck PCM, apply the configured processing chain, then render the summed output to the selected Windows output device.

## Next Milestones

1. Validate the installed Resonance virtual driver against continuous Deck A/B capture on a Secure Boot machine.
2. Keep extending the shared DSP config shape in `src/lib/presets.js` and the extension mirror in `extension/lib/presets.js`.
3. Define the PCM block exchange from the persistent router into the VST3 bridge using the verified `processTone` lifecycle.
