---
name: typed-native-boundary
description: >-
  Design and extend the boundary between a UI/renderer and a native real-time
  engine the way CoreVideo Pro and Resonance do it: a typed,
  transport-neutral command/snapshot protocol, a mock-first engine with a native
  adapter and graceful fallback, immutable read-model snapshots, tests at every
  layer, and an inspect-but-stay-blocked rule for untrusted native inputs. Use
  this when architecting a feature that spans a renderer and a native or
  out-of-process engine — choosing how the UI talks to native code, defining an
  IPC/JSON-line protocol, splitting mock vs real engine implementations, deciding
  where state mutates, surfacing engine health/warnings, or wiring third-party
  native components safely. Reach for it on prompts like "how should the renderer
  talk to the native core", "design the protocol for X", or "make this feature
  shell-agnostic". For the file-by-file slice, defer to the repo-specific skills
  native-core-capability (CoreVideo Pro) and desktop-audio-engine (Resonance).
---

# Typed renderer ↔ native engine boundary

## Why this pattern exists

Both CoreVideo Pro and Resonance are desktop apps where a web-tech renderer
(React/Vite) drives a **native real-time engine** (GPU compositing / media core,
or a WASAPI audio router + VST3 host). The renderer is deliberately *not* the
engine — it must stay a thin operator surface so the native core, shell (Electron
/ Tauri / custom), and transport can all be replaced without rewriting the UI.

The shared discipline below is what makes that possible. When you design a new
native-backed feature, apply these principles first, then drop into the
repo-specific skill for the exact files. The point of writing it down once is that
the *shape* is identical across both apps even though the domains differ.

## The seven principles

### 1. The renderer is dumb; the engine owns real-time work
Capture, compositing, encoding, DSP, device I/O — all of it lives behind the
boundary. The renderer issues intent and renders a read model. If you find
yourself importing `electron`, OBS, `getUserMedia`/`MediaRecorder`, or audio
device APIs into renderer code, stop — that work belongs on the engine side.

### 2. A typed, transport-neutral protocol
Communication is a small set of **commands** (renderer → engine) and a
**snapshot** read model (engine → renderer), expressed as plain
JSON-serializable types — no platform handles, no class instances on the wire.
Both apps move these as newline-delimited JSON over stdio/IPC. Commands are
discriminated unions keyed on `type`; the snapshot is a flat, immutable view of
engine state. Keeping payloads transport-neutral is what lets the same renderer
talk to a mock today and a C++/Rust process tomorrow.
- *CoreVideo Pro:* `MediaCoreCommand` / `MediaCoreStateSnapshot`, mirrored into the
  renderer as `NativeMediaCoreCommand` (zero backend imports).
- *Resonance:* the `describe` / `resolveChain` / `loadPlugin` / `processPcm` /
  `unloadPlugin` JSON-line messages between the engine and the native helpers.

### 3. Mock-first, with a native adapter and graceful fallback
Ship an **in-memory simulation** of the engine so the UI dev loop and the tests
never need the native binary. Provide a **native adapter** that forwards the same
commands to the real bridge, and have it fall back to the simulation (with a
visible warning) when the bridge is absent. The bridge itself is *injected*, not
imported — a global the shell installs (`window.coreVideoNative`,
`window.resonanceDesktop`) — so dev/test runs with no native shell at all.
- *CoreVideo Pro:* `InMemoryMediaCoreSyncEngine` (mock) and
  `NativeHostMediaCoreSyncEngine` (forwards to `bridge.syncMediaCore`, else
  simulates). `createMockEngineBundle()` vs `createNativeZoomEngineBundle()`.
- *Resonance:* the built-in **NativeDSP** lane is the guaranteed fallback whenever
  the VST3 bridge can't load, errors, or returns silence.

### 4. State mutates in the backend; the renderer reads immutable snapshots
There is exactly one place state changes: the engine's state machine
(`MediaCoreRuntime`, the router/engine process). The renderer consumes `*Snapshot`
read models and never mutates engine state in place. This keeps the mock and the
real backend interchangeable and makes the UI a pure function of the snapshot.

### 5. Health and warnings are data, not exceptions
Represent status as small discriminated unions
(`"idle" | "live" | "warning" | "failed"`, `hostMode`, etc.) plus a free-form
`warnings: string[]`. When a command is incomplete or a probe fails, **push a
clear warning and keep going** rather than throwing — the operator UI surfaces
warnings, and a live show or a playing deck must not crash on bad input.

### 6. Inspect, but stay blocked until proven safe
For untrusted or not-yet-ready native inputs, the safe state is: discover/probe
freely, but **do not let them into the live path until there's a tested, bounded
way to host them — and always keep a guaranteed fallback.**
- *Resonance:* third-party plugins are scanned read-only (`executable: false`),
  may be probed for metadata/parameters, but only reach deck audio after passing a
  parameter-forwarding probe, with NativeDSP as the fallback.
- *CoreVideo Pro:* capabilities are declared and validated
  (`NativeMediaCoreCapability`, `requiredMvpMediaCoreCapabilities`) before a profile
  is treated as supported; the mock simulates until the real sender lands.

This is a safety convention, not an incidental state — weakening it is how you
ship a crash or run untrusted code in the hot path.

### 7. Test the whole pyramid, and keep the README honest
Every layer that changes gets a paired test: the protocol/backend state machine,
the command builder, the sync/adapter, and the UI readout. Prefer exercising pure
helpers over spawning processes. And treat the README/docs as a **living
capability inventory** — in both repos, a feature isn't "done" until it's listed
alongside the tests that cover it. That inventory is how the next person (or the
next agent) learns what the boundary already supports.

## Applying it to a new feature

1. **Name the capability and its read model.** What command(s) does the renderer
   send, and what snapshot fields does the engine return? Keep both JSON-plain.
2. **Implement it in the backend/mock first** and test the state transition.
3. **Mirror the types into the renderer** (no backend imports) and build the
   command from app state, guarded by a condition. Test present-when-on /
   absent-when-off.
4. **Teach the in-memory engine to simulate it** so dev and tests match the real
   backend; leave the native adapter forwarding unchanged.
5. **Surface the snapshot in the UI** with pending/empty fallbacks.
6. **Decide the safety posture** for any untrusted/native input (principle 6) and
   the fallback behavior (principle 3/5).
7. **Document it** in the README/docs inventory.

Then follow the repo-specific skill for the exact file map:
- CoreVideo Pro → `native-core-capability`
- Resonance → `desktop-audio-engine`
