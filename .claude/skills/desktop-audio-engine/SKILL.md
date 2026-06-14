---
name: desktop-audio-engine
description: >-
  Work on Resonance's desktop audio stack — the Electron-hosted Node audio
  engine, the WASAPI native router, the VST3 bridge / plugin host, and the
  optional SysVAD virtual-audio driver. Use this whenever a task touches deck
  audio routing, per-deck EQ/pan/effects, plugin scanning or hosting (VST2/VST3,
  Waves), the JSON-line protocols between Node and the native helpers, PCM block
  processing, desktop capture (loopback / endpoint / pushed PCM), the native C++
  builds, or the driver signing/packaging workflow. Reach for it on prompts like
  "add a deck effect", "route PCM through the VST3 bridge", "scan for plugins",
  "wire a new engine IPC command", "build the audio router", "package the
  driver", "why isn't YouTube audio going through EQ", or "add a desktop audio
  feature" — even when the user only names the symptom and not the layer.
---

# Resonance — Desktop Audio Engine

## The big picture

Resonance is a two-deck DJ app. The web build (React/Vite → Cloudflare Pages) is
the discovery/playback surface; **real audio processing only happens in the
Electron desktop app**, because browsers isolate YouTube iframe audio (it can
never be routed through Web Audio EQ). The desktop app owns its audio:
app-controlled sources (local WAV, pushed PCM, captured loopback/endpoint) flow
through a user-mode engine for per-deck EQ, pan, DJ effects, and optional plugins.

Everything below the UI is a chain of processes talking **newline-delimited JSON
over stdio pipes** (no shared memory yet; PCM travels as base64 or via temp
files). Keep that mental model — it's the spine of the whole system:

```
Electron renderer (React UI)
  │  contextBridge: window.resonanceDesktop  (preload.cjs; nodeIntegration: false)
  ▼  ipcRenderer.invoke
Electron main (electron/main.cjs)
  │  forks the engine, maps ~20 IPC channels → sendEngineCommand(type, payload)
  ▼  child_process message passing
Audio engine process (engine/audio-engine.cjs)
  ├─ DesktopAudioRouter (engine/audio-router.cjs)
  │     └─ spawns resonance-audio-router.exe --server   → JSON-line snapshots on stdout
  ├─ PluginHostClient (engine/plugin-host.cjs → plugin-host-worker.cjs)
  │     └─ JSON-line: describe / resolveChain / loadPlugin / enumerateParameters / unloadPlugin / exit
  └─ NativeVst3BridgeClient (engine/plugin-host.cjs → resonance-vst3-bridge.exe)
        └─ JSON-line: describe / loadPlugin / enumerateParameters / processTone / processPcm / unloadPlugin / exit
```

The native binaries live in `native/{audio-router,vst3-bridge,wasapi-meter}`
(C++/CMake/MSVC, Windows-only). The VST3 bridge links the Steinberg SDK submodule
at `third_party/vst3sdk`.

## The most important rule: scan, but stay blocked

Third-party plugins are **scanned read-only and stay blocked from the audio path
until the native bridge can safely host them.** This is a safety convention, not
an incidental state — never weaken it casually.

- `scanPluginCandidates()` in `engine/plugin-host.cjs` enumerates VST2 `.dll` /
  VST3 `.vst3` files in known Windows install paths and returns every candidate
  with `executable: false, loadable: false, loaderStatus: "scan-only"`. It runs
  no third-party code.
- When planning a deck chain, only **built-in profiles** (e.g.
  `resonance-native-drive`) or candidates explicitly marked `executable: true`
  become real `nativeSettings`. Everything else is collected into
  `blockedPluginIds` and dropped from the router command.
- The VST3 bridge may *probe* a plugin (instantiate it, enumerate real
  parameters, run a tone/PCM test block) — but deck playback PCM only flows
  through a plugin after it passes a parameter-forwarding probe, and the built-in
  **NativeDSP** lane is always the fallback if the bridge can't load, errors, or
  returns silence for non-silent input. If the bridge crashes, decks keep
  playing.

So the safe default is: scanned ✅, probed maybe, **blocked from audio until
proven loadable**, with NativeDSP as the guaranteed fallback. The full
enforcement points are in `references/vst3-protocol.md`.

## Where things live

| Concern | File(s) |
|---|---|
| Renderer IPC surface | `electron/preload.cjs` (`window.resonanceDesktop`) |
| Main process / IPC routing | `electron/main.cjs` |
| Engine orchestration, devices, settings, diagnostics | `engine/audio-engine.cjs` |
| Native router lifecycle + latency profiles + route state | `engine/audio-router.cjs` (`DesktopAudioRouter`) |
| Plugin scan + chain planning + bridge clients | `engine/plugin-host.cjs` (`PluginHostClient`, `NativeVst3BridgeClient`) |
| Safe chain-planning helper (no binaries) | `engine/plugin-host-worker.cjs` |
| Native WASAPI mixer | `native/audio-router/main.cpp` → `resonance-audio-router.exe` |
| VST3 host bridge | `native/vst3-bridge/main.cpp` → `resonance-vst3-bridge.exe` |
| Device metering | `native/wasapi-meter/main.cpp` → `resonance-wasapi-meter.exe` |
| Engine/web React UI | `src/` |
| Docs (read these!) | `docs/{audio-engine,desktop-app,plugin-hosting,virtual-audio-device,known-limitations,release-checklist}.md` |

## Common workflows

### Add or change an engine feature (the usual task)

Engine features thread renderer → main → engine, mirroring how each existing
command is wired. Add the piece at every hop:

1. **Expose it on the bridge** in `electron/preload.cjs` (`engine.<method>` or a
   new `window.resonanceDesktop.*`). The preload is the *entire* IPC surface —
   `nodeIntegration` is off, so nothing reaches the engine except through here.
2. **Route it in `electron/main.cjs`** — add an `ipcMain.handle(channel, ...)`
   that calls `sendEngineCommand(type, payload)`.
3. **Handle it in `engine/audio-engine.cjs`** — process the command, update state,
   and reply with a `STATE`/`METERS` message correlated by `requestId`. Persist
   anything durable to `engine-settings.json` if it belongs there.
4. **Push it to the router** if it affects audio — go through
   `DesktopAudioRouter` so latency-profile and restart logic stay centralized.
   Changing latency restarts the persistent server; don't bypass it.
5. **Test it** — add a `vitest` case in the matching `engine/*.test.js`. Prefer
   exercising the exported pure helpers (`normalizeDeckSource`,
   `buildDeckSourceState`, `buildDeckPluginPlan`, etc.) over spawning processes.
6. **Run** `npm test`, `npm run lint`, and `npm run format:check`.

### Work with the VST3 bridge / plugin host

Read `references/vst3-protocol.md` first — it has the full request/response tables
for both `plugin-host-worker.cjs` (safe, no binaries) and the native
`resonance-vst3-bridge.exe` (metadata + PCM), plus the base64-vs-file PCM
transport (`RESONANCE_VST3_PCM_TRANSPORT=file`). Preserve the scan-but-blocked
discipline: a new plugin source is `executable: false` until there's a real,
tested path to host it, and NativeDSP must remain the fallback.

### Build native binaries

These are Windows/CMake/MSVC. Initialize the SDK submodule before building the
VST3 bridge:

```bash
git submodule update --init --recursive third_party/vst3sdk
```

```powershell
npm run native:audio-router   # → native/audio-router/build/Release/resonance-audio-router.exe
npm run native:vst3-bridge    # → resonance-vst3-bridge.exe (needs the vst3sdk submodule)
npm run native:wasapi-meter   # → resonance-wasapi-meter.exe
```

### Driver (SysVAD virtual audio) work

The kernel driver is an **optional, future** system-wide routing path — the main
product is app-owned user-mode routing, so don't treat the driver as required.
It needs the WDK, and installs only on a test machine with Secure Boot **off** and
test-signing **on**; production needs a Microsoft-signed package. The full script
sequence and signing flow are in `references/native-and-drivers.md`. Always start
with the non-destructive `npm run driver:preflight`.

### Deploy the web app

```powershell
npm run deploy          # Pages: build + wrangler pages deploy dist (wrangler.jsonc)
npm run deploy:worker   # Worker API: wrangler deploy --config wrangler.worker.jsonc (needs YOUTUBE_API_KEY secret)
```

## Verify your change

```bash
npm test                 # vitest: engine/*.test.js + others
npm run lint             # eslint
npm run format:check     # prettier
npm run smoke:browser    # build + Playwright headless smoke of the web UI
npm run desktop:dev      # launch Electron dev (PowerShell script — not plain `npm run dev`)
```

The full pre-release sequence (native builds, driver packaging, desktop installer,
deploy, live smoke) is in `docs/release-checklist.md` and summarized in
`references/native-and-drivers.md`.

## Gotchas that trip people up

- **YouTube iframe audio can't be EQ'd.** Only app-owned sources (local files,
  pushed PCM, captured loopback/endpoint) go through the engine. This is a browser
  limitation, surfaced in the UI as "YouTube Mix Mode". Don't try to route iframe
  audio through Web Audio.
- **Forgetting the submodule** → `npm run native:vst3-bridge` fails to find
  `pluginterfaces/...`. Init `third_party/vst3sdk` first.
- **Plugins look "found" but never process audio** — that's the scan-but-blocked
  design working. They stay `executable: false` until a tested host path exists.
- **Electron dev is `npm run desktop:dev`**, a PowerShell launcher — not `npm run
  dev` (that's the web build only).
- **Changing latency restarts the router.** Route through `DesktopAudioRouter` so
  this stays correct; a setting change tears down and respawns the native server.
- **The preload bridge is the whole IPC surface.** If a renderer call can't reach
  the engine, you probably didn't expose it in `preload.cjs` and route it in
  `main.cjs`.
- **Secrets stay out of git.** `YOUTUBE_API_KEY` lives in a local file or a
  Wrangler secret, never committed.
- **Driver install fails on Secure Boot machines** — expected. Test-signed
  packages need Secure Boot off + test-signing on; production needs Microsoft
  signing.

## Reference files

- `references/vst3-protocol.md` — full JSON-line message tables (worker + native
  bridge), PCM transport options, and the exact scan-but-blocked enforcement
  points.
- `references/native-and-drivers.md` — every native/driver/packaging PowerShell
  script, when to run each, the SysVAD signing flow, the Cloudflare deploy paths,
  and the release checklist.
