# VST3 / plugin-host JSON-line protocols

Two processes speak a newline-delimited JSON protocol. Every request carries a
`type` and a `requestId`; every response echoes `type` + `requestId` and adds a
`status`. The Node side correlates responses by `requestId` and applies a timeout
per call.

## A. `engine/plugin-host-worker.cjs` — the safe helper (no third-party binaries)

This process plans chains and tracks metadata only. It never executes
third-party plugin code. `capabilities` advertises
`{ sandboxProcess: true, thirdPartyPluginLoading: false, vst3LoaderPrototype: true }`.

| `type` | Request payload | Response fields |
|---|---|---|
| `describe` | — | `protocolVersion`, `status`, `capabilities`, `runtimePlugins`, `supportedFormats` |
| `resolveChain` | `deckProcessing: {...}` | `plan.decks.{A,B}: { hostMode, eqBypassed, activePluginIds, nativeSettings }` |
| `loadPlugin` | `candidate: {...}` | `status`, `plugin: { id, parameters, ... }` |
| `enumerateParameters` | `pluginId` | `pluginId`, `parameters: []` |
| `unloadPlugin` | `pluginId` | `status`, `pluginId` |
| `exit` | — | `status: "ok"` then exits |

`resolveChain` returns each deck's `hostMode` (`passthrough` / `native-dsp-fallback`
/ `blocked-third-party`), the active plugin IDs, EQ-bypass state, and the bounded
NativeDSP fallback settings forwarded to the router.

## B. `resonance-vst3-bridge.exe` (`native/vst3-bridge/main.cpp`) — the native bridge

Same JSON-line shape, but this process actually instantiates VST3 modules (via the
`third_party/vst3sdk` submodule) for metadata, parameter enumeration, and PCM
processing. It does **no audio device I/O** — it processes blocks handed to it.

| `type` | Request payload | Response fields |
|---|---|---|
| `describe` | — | `capabilities: { metadataLifecycle, binaryInstantiation, pcmProcessing, pcmFileTransport }` |
| `loadPlugin` | `id, path, name, vendor, format` | `pluginId`, `parameterEnumeration`, `bridgePcmProcessing`, `processingEnabled` |
| `enumerateParameters` | `pluginId, id` | `parameters: [{ id, name, kind, minimum, maximum, defaultValue, automatable }]` |
| `processTone` | `pluginId, frames, sampleRate, frequency, amplitude` | `inputPeak`, `outputPeak`, `maxDelta`, `changed`, `bridgePcmProcessing` |
| `processPcm` | `pluginId, frames, channels, sampleRate, pcm16Base64` (or file transport, below) | `processedPcm16Base64` (or `outputPcm16File`), `bridgePcmProcessing` |
| `unloadPlugin` | `pluginId, id` | `status`, `pluginId` |
| `exit` | — | `status: "ok"` then exits |

Typical lifecycle: `start()` → `describe` → `loadPlugin` → `enumerateParameters`
→ `processTone`/`processPcm` → `unloadPlugin` → `stop()`. The persistent router
keeps a per-deck bridge instance warm for the selected staged VST3 plugin and
sends Deck A/B PCM blocks through `processPcm` (after a parameter-forwarding probe)
before pan/mix/output.

### PCM transport: base64 (default) vs file (opt-in)

- **Base64 JSON (default):** `processPcm` sends `pcm16Base64` and gets
  `processedPcm16Base64` back. Simple, but encodes the whole block per call.
- **File transport (opt-in, lower overhead):** set
  `RESONANCE_VST3_PCM_TRANSPORT=file` (or `RESONANCE_VST3_PCM_FILE_TRANSPORT=1`).
  The request carries `pcm16File` / `outputPcm16File` temp paths (little-endian
  PCM16); the bridge reads the input file, processes, and writes the output file.
  Treat this as a scaffold; the router cleans up the temp files after each block.

## C. Scan-but-blocked enforcement — the exact points

This is the safety spine. When changing plugin code, keep all of these intact:

1. **Scan** — `scanPluginCandidates()` (`engine/plugin-host.cjs`) walks the known
   Windows VST2/VST3/Waves/Steinberg paths and returns candidates with
   `executable: false`, `loadable: false`, `loaderStatus: "scan-only"`. Stable id:
   `desktop-plugin:${base64url(path.toLowerCase())}`. VST3 may be marked
   `sandboxLoadable: true` (metadata only); VST2 `.dll` execution stays disabled.
2. **Chain planning** — `buildDeckPluginPlan()` splits active plugins into
   `executablePluginIds` (built-in profiles like `resonance-native-drive`, or
   candidates with `executable: true`) and `blockedPluginIds` (everything else),
   and computes `hostMode` accordingly.
3. **Native settings** — `buildNativePluginSettings()` only emits bounded
   NativeDSP parameters (`pluginCount`, `pluginGainDb`, `pluginDrive`) for known
   profiles or executable plugins; blocked plugins are silently dropped from the
   router command.
4. **Router fallback** — the built-in NativeDSP lane is always available. If the
   bridge can't load, errors, or returns silence for non-silent input, the router
   falls back to NativeDSP so audio never drops.
5. **UI** — the desktop plugin rack labels blocked plugins as "Blocked" and shows
   `blockedPluginIds` separately; you can't move a deck into native-plugin mode on
   a blocked chain.

The intent: third-party binaries are inspected, never trusted blindly into the
live audio path, and the deck keeps playing no matter what the bridge does.
