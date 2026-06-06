# Plugin Hosting

Resonance can stage plugin-chain settings in the desktop UI now, and the native router has a built-in NativeDSP lane for validating per-deck plugin processing. Third-party plugins such as Waves still require a native desktop plugin host.

## Current Behavior

- The app has a plugin rack model in the UI.
- The desktop engine receives per-deck `pluginChain` settings over IPC.
- The app EQ can be bypassed.
- Direct browser audio uses a flat EQ curve while bypass is enabled.
- The desktop audio router can play local Deck A/B WAV sources, pushed PCM, bounded capture buffers, and continuous Deck A/B capture streams through the persistent native WASAPI router.
- Active staged deck plugins are converted into bounded native settings (`pluginCount`, `pluginGainDb`, `pluginDrive`) and applied independently to Deck A/B PCM through the built-in NativeDSP processor.
- `engine/plugin-host-worker.cjs` provides the sandbox helper protocol for describing host capabilities and resolving Deck A/B plugin-chain plans.
- `PluginHostClient` keeps that helper alive while the desktop engine is running, correlates JSON-line responses by request ID, and marks the helper degraded if it exits or times out.
- The desktop plugin host runs a safe read-only scan for VST3 and Waves candidates in common Windows install paths and enriches candidates with stable IDs, vendor, format, architecture guess, shell type, and load strategy.
- The helper has a VST3 loader prototype that can create a sandbox metadata handle, enumerate Resonance's initial host-side parameter contract, and unload the handle without executing third-party plugin audio code.
- `native/vst3-bridge` builds `resonance-vst3-bridge.exe`, the native bridge scaffold for future Steinberg SDK integration. It reports SDK/test-plugin readiness and returns explicit degraded states until binary instantiation is implemented.
- Scanned VST3/Waves candidates can be staged in Deck A/B plugin chains, but they are marked blocked for execution until the native host can safely load third-party binaries.
- Plugin entries carry editable session parameters: enabled state, wet/dry, input gain, output gain, and preset name.
- The EQ panel includes an active deck plugin rack with chain order controls, duplicate, remove, reset-parameter, and preset-name editing. The catalog can be filtered by all, active, built-in, VST3, Waves, or blocked candidates.
- The desktop panel reports scan status, candidate count, supported formats, a short candidate summary, and the VST3 loader prototype status.
- VST3/Waves plugins are not executed yet; the current executable processor is the built-in NativeDSP test lane.

The scanner only enumerates files and directories. The loader prototype validates the helper protocol and metadata lifecycle, but it does not load plugin DLLs, instantiate VST3 processors, execute Waves shells, or process PCM through a third-party binary.

The helper process currently supports:

```text
--describe
stdin JSON: {"type":"describe"}
stdin JSON: {"type":"resolveChain","deckProcessing":{...}}
stdin JSON: {"type":"loadPlugin","candidate":{...}}
stdin JSON: {"type":"enumerateParameters","pluginId":"..."}
stdin JSON: {"type":"unloadPlugin","pluginId":"..."}
stdin JSON: {"type":"exit"}
```

`resolveChain` returns a per-deck plan with `hostMode`, active plugin IDs, EQ bypass state, and the bounded NativeDSP fallback settings that are forwarded to the native audio router.

`loadPlugin` currently returns `metadata-loaded` for a valid VST3 bundle path and marks `processingEnabled: false`. This gives Resonance a stable sandbox lifecycle and parameter enumeration contract before the native VST3 SDK bridge is connected.

The native VST3 bridge currently supports:

```text
--describe
stdin JSON: {"type":"describe"}
stdin JSON: {"type":"loadPlugin","id":"..."}
stdin JSON: {"type":"enumerateParameters","pluginId":"..."}
stdin JSON: {"type":"unloadPlugin","pluginId":"..."}
stdin JSON: {"type":"exit"}
```

Build it with:

```powershell
npm run native:vst3-bridge
```

Set SDK/test-plugin paths before bridge validation:

```powershell
$env:RESONANCE_VST3_SDK_DIR='C:\path\to\vst3sdk'
$env:RESONANCE_TEST_VST3_PLUGIN='C:\Program Files\Common Files\VST3\SomePlugin.vst3'
```

The VST3 SDK is distributed by Steinberg through the official `steinbergmedia/vst3sdk` repository and VST developer portal. As of Steinberg's VST 3.8 announcement, the SDK is available under the MIT license, while the VST name/logo remain Steinberg trademarks.

NativeDSP parameters are applied today through the router's plugin lane: input gain drives the saturation input, output gain trims the processed signal, and wet/dry blends processed and dry deck audio. VST3/Waves candidates keep the same parameter state in `deckProcessing.pluginChain`, but execution stays blocked until a native loader exists.

## Why Waves Requires Desktop Hosting

Waves plugins are native audio plugins. They cannot be loaded by the web app or by a normal browser iframe. Resonance needs the desktop audio engine to own the PCM stream, then run a native plugin host before rendering audio to the selected output.

```text
Resonance virtual playback device
  -> Deck A/B PCM router
  -> Per-deck pan and EQ, if not bypassed
  -> Per-deck built-in NativeDSP plugin lane
  -> Future per-deck VST3/Waves plugin chain
  -> Master summing bus
  -> WASAPI render output
```

## Native Host Milestones

1. Validate continuous virtual-device capture streams against the installed Resonance driver.
2. Connect the native bridge scaffold to the Steinberg VST3 SDK so it can instantiate one test plugin.
3. Replace or augment the built-in NativeDSP lane with one real VST3 instance through the sandboxed helper.
4. Add plugin parameter state, bypass, ordering, and preset persistence.
5. Validate Waves plugins specifically after the generic VST3 path works.

The safest first implementation is a separate native helper process for plugin hosting. If a third-party plugin crashes, Resonance can restart that helper without taking down the Electron UI.

## Scan Paths

The desktop engine scans these common Windows locations when they exist:

```text
C:\Program Files\Common Files\VST3
C:\Program Files (x86)\Common Files\VST3
C:\Program Files\Waves
C:\Program Files (x86)\Waves
C:\ProgramData\Waves Audio
```

Additional scan roots can be supplied for local testing with `RESONANCE_PLUGIN_SCAN_PATHS`, using the normal Windows path delimiter.
