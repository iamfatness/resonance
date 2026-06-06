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
- The desktop plugin host runs a safe read-only scan for VST2 `.dll` and VST3 `.vst3` candidates in common Windows install paths and enriches candidates with stable IDs, vendor, format, architecture guess, shell type, and load strategy.
- The helper has a VST3 loader prototype that can create a sandbox metadata handle, enumerate Resonance's initial host-side parameter contract, and unload the handle without executing third-party plugin audio code.
- `native/vst3-bridge` builds `resonance-vst3-bridge.exe` against the Steinberg VST3 SDK submodule in `third_party/vst3sdk`. It can instantiate VST3 modules for metadata/parameter enumeration, process an internal 32-bit float test block through a loaded processor, and unload them through the helper protocol.
- Scanned VST2/VST3 candidates can be staged in Deck A/B plugin chains, but they are marked blocked for execution until the native host can safely load third-party binaries.
- Plugin entries carry editable session parameters: enabled state, wet/dry, input gain, output gain, and preset name.
- The Deck Effects window can save, recall, and delete local named parameter presets per plugin. These presets are stored on the client's machine under browser local storage.
- The desktop engine now probes scanned VST3 candidates through the native bridge process. Each candidate reports bridge status, plugin-path validation, parameter-load availability, bridge PCM test-processing availability, and exposed parameter metadata when the bridge returns it.
- Deck Effects renders exposed plugin parameters as sliders and stores their values in local presets.
- The EQ panel includes an active deck plugin rack with chain order controls, duplicate, remove, reset-parameter, and preset-name editing. The catalog can be filtered by all, active, built-in, VST2, VST3, Waves vendor, or blocked candidates.
- In the desktop app, each deck opens its own Effects window. VST2/VST3 scanning happens on the client's Windows machine through the local Electron audio engine, not on Cloudflare or GitHub.
- The desktop panel reports scan status, candidate count, supported formats, a short candidate summary, and the VST3 loader prototype status.
- VST3 plugins can be instantiated for parameter discovery and internal bridge PCM block testing, but live Deck A/B VST2/VST3 audio processing is not connected yet; the current executable deck processor is the built-in NativeDSP test lane.

Waves is treated as a vendor/shell classification, not a separate plugin format. A Waves candidate can still be VST2 or VST3 depending on the discovered shell/bundle.

The scanner enumerates files and directories, then the native bridge is asked to load eligible VST3 candidates. The current native bridge validates the command protocol and plugin paths, instantiates VST3 modules, initializes component/controller pairs, enumerates real plugin parameters, runs an internal tone buffer through the loaded processor when available, and unloads the instance. It still does not route Deck A/B PCM through a third-party binary.

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

`loadPlugin` returns `loaded` for a valid VST3 module when component/controller initialization succeeds. It includes `parameterEnumeration: true`, the real parameter list, `bridgePcmProcessing: true` when the module exposes a 32-bit float audio processor, and `processingEnabled: false` until Deck A/B PCM processing is wired through the plugin processor.

The native VST3 bridge currently supports:

```text
--describe
stdin JSON: {"type":"describe"}
stdin JSON: {"type":"loadPlugin","id":"..."}
stdin JSON: {"type":"enumerateParameters","pluginId":"..."}
stdin JSON: {"type":"processTone","pluginId":"...","frames":512,"sampleRate":48000}
stdin JSON: {"type":"unloadPlugin","pluginId":"..."}
stdin JSON: {"type":"exit"}
```

Build it with:

```powershell
npm run native:vst3-bridge
```

Initialize the SDK submodule on a fresh checkout:

```powershell
git submodule update --init --recursive third_party/vst3sdk
```

Set a test-plugin path before bridge validation:

```powershell
$env:RESONANCE_TEST_VST3_PLUGIN='C:\Program Files\Common Files\VST3\SomePlugin.vst3'
```

The VST3 SDK is distributed by Steinberg through the official `steinbergmedia/vst3sdk` repository and VST developer portal. As of Steinberg's VST 3.8 announcement, the SDK is available under the MIT license, while the VST name/logo remain Steinberg trademarks.

NativeDSP parameters are applied today through the router's plugin lane: input gain drives the saturation input, output gain trims the processed signal, and wet/dry blends processed and dry deck audio. VST3 candidates can expose real parameter controls after bridge loading and can run an internal bridge test buffer, but live deck execution stays blocked until Deck A/B PCM processing is connected.

## Why Waves Requires Desktop Hosting

Waves plugins are native audio plugins. They cannot be loaded by the web app or by a normal browser iframe. Resonance needs the desktop audio engine to own the PCM stream, then run a native plugin host before rendering audio to the selected output.

```text
Resonance virtual playback device
  -> Deck A/B PCM router
  -> Per-deck pan and EQ, if not bypassed
  -> Per-deck built-in NativeDSP plugin lane
  -> Future per-deck VST2/VST3 plugin chain
  -> Master summing bus
  -> WASAPI render output
```

## Native Host Milestones

1. Validate continuous virtual-device capture streams against the installed Resonance driver.
2. Define the PCM block exchange between the router and the VST3 bridge using the verified processor lifecycle.
3. Connect Deck A/B PCM buffers to one loaded VST3 processor instance.
4. Replace or augment the built-in NativeDSP lane with one real VST3 processing instance through the sandboxed helper.
5. Add plugin parameter state, bypass, ordering, and preset persistence.
6. Validate Waves VST3 shells specifically after the generic VST3 path works.

The safest first implementation is a separate native helper process for plugin hosting. If a third-party plugin crashes, Resonance can restart that helper without taking down the Electron UI.

## Scan Paths

The desktop engine scans these common Windows locations when they exist:

```text
C:\Program Files\Common Files\VST3
C:\Program Files (x86)\Common Files\VST3
C:\Program Files\Common Files\VST2
C:\Program Files (x86)\Common Files\VST2
C:\Program Files\VstPlugins
C:\Program Files (x86)\VstPlugins
C:\Program Files\Steinberg\VstPlugins
C:\Program Files (x86)\Steinberg\VstPlugins
C:\Program Files\Waves
C:\Program Files (x86)\Waves
C:\ProgramData\Waves Audio
```

Additional scan roots can be supplied for local testing with `RESONANCE_PLUGIN_SCAN_PATHS`, using the normal Windows path delimiter.
