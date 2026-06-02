# Plugin Hosting

Resonance can stage plugin-chain settings in the desktop UI now, but third-party plugins such as Waves require a native desktop audio host.

## Current Behavior

- The app has a plugin rack model in the UI.
- The desktop engine receives per-deck `pluginChain` settings over IPC.
- The app EQ can be bypassed.
- Direct browser audio uses a flat EQ curve while bypass is enabled.
- The desktop audio router exposes mock Deck A/B routes and simulated bus meters.
- VST3/Waves plugins are not executed yet.

## Why Waves Requires Desktop Hosting

Waves plugins are native audio plugins. They cannot be loaded by the web app or by a normal browser iframe. Resonance needs the desktop audio engine to own the PCM stream, then run a native plugin host before rendering audio to the selected output.

```text
Resonance virtual playback device
  -> Deck A/B PCM router
  -> Per-deck pan and EQ, if not bypassed
  -> Per-deck VST3/Waves plugin chain
  -> Master summing bus
  -> WASAPI render output
```

## Native Host Milestones

1. Replace the mock desktop router backend with native per-deck PCM routing.
2. Capture real PCM from the virtual playback device.
3. Render processed PCM to the selected Windows output.
4. Add VST3 plugin discovery for common install paths.
5. Load one plugin instance in-process or through a sandboxed helper.
6. Add plugin parameter state, bypass, ordering, and preset persistence.
7. Validate Waves plugins specifically after the generic VST3 path works.

The safest first implementation is a separate native helper process for plugin hosting. If a third-party plugin crashes, Resonance can restart that helper without taking down the Electron UI.
