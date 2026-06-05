# Plugin Hosting

Resonance can stage plugin-chain settings in the desktop UI now, and the native router has a built-in NativeDSP lane for validating per-deck plugin processing. Third-party plugins such as Waves still require a native desktop plugin host.

## Current Behavior

- The app has a plugin rack model in the UI.
- The desktop engine receives per-deck `pluginChain` settings over IPC.
- The app EQ can be bypassed.
- Direct browser audio uses a flat EQ curve while bypass is enabled.
- The desktop audio router can play local Deck A/B WAV sources, pushed PCM, bounded capture buffers, and continuous Deck A/B capture streams through the persistent native WASAPI router.
- Active staged deck plugins are converted into bounded native settings (`pluginCount`, `pluginGainDb`, `pluginDrive`) and applied independently to Deck A/B PCM through the built-in NativeDSP processor.
- The desktop plugin host runs a safe read-only scan for VST3 and Waves candidates in common Windows install paths.
- The desktop panel reports scan status, candidate count, supported formats, and a short candidate summary.
- VST3/Waves plugins are not executed yet; the current executable processor is the built-in NativeDSP test lane.

The scanner only enumerates files and directories. It does not load plugin DLLs, instantiate VST3 bundles, execute Waves shells, or inspect plugin parameters.

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
2. Expand VST3/Waves discovery metadata beyond scan-only candidates.
3. Replace or augment the built-in NativeDSP lane with one real VST3 instance in-process or through a sandboxed helper.
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
