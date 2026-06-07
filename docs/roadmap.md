# Resonance Roadmap

This file is the project backlog until GitHub issue creation is available from the connector. Each top-level checklist item is sized to become one GitHub issue. Keep implementation PRs linked back to the relevant item.

The current post-roadmap evaluation and next execution plan lives in `docs/project-evaluation-and-next-plan.md`.

## Tracking Rules

- One issue per top-level roadmap item.
- Each issue should keep the same title, goal, acceptance criteria, and dependencies from this file.
- Close an item only after code, docs, and verification are complete.
- Prefer shipping in this order: core DJ deck path, built-in effects, desktop packaging, beta readiness, then advanced plugin hosting polish.

## Phase 1: Desktop Audio Foundation

### [ ] Desktop: DJ-style app-owned playback and effects routing

Goal: Make the desktop app useful as a DJ app without requiring a kernel driver by prioritizing embedded YouTube workflow plus audio that Resonance owns directly.

Deliverables:
- Treat local WAV/direct PCM/captured PCM as first-class Deck A/B sources.
- Keep per-deck EQ, pan, gain, and DJ effects active before the master output.
- Add DJ-facing controls such as crossfader, deck filter, cue-style deck selection, and readable meters.
- Add deck performance controls such as hot cues and quick jump behavior.
- Use WASAPI loopback/capture as the practical bridge for external playback when clean per-deck app-owned audio is unavailable.
- Keep YouTube iframe playback in the web deck path for discovery/playlist workflows, but do not depend on iframe audio for native EQ/VST routing.
- Make the desktop UI clearly distinguish app-owned processable sources from browser-isolated YouTube iframe playback.

Acceptance criteria:
- Deck A and Deck B can run processable app-owned sources through per-deck EQ/pan/VST3 routing without a virtual driver.
- Users can see whether a deck source is processable by the desktop engine.
- Built-in DJ effects remain functional when the virtual driver is absent.
- Driver diagnostics are available but do not block the main desktop workflow.

Progress:

- Local WAV, pushed PCM, bounded capture, and continuous capture already flow through the persistent native router.
- Per-deck EQ, pan, DJ filter overlay, NativeDSP fallback, built-in DJ effect presets, and first staged bridge-capable VST3 routing are active on the persistent router path.
- The main deck surface now has a DJ mixer strip with crossfader, cue-style deck selection, simple level meters, and deck filter status.
- Each YouTube deck now has three hot cues that can be set from current playback and jumped during a session.
- The product direction has pivoted away from requiring the virtual driver for the core desktop app. The driver is now an optional later system-wide routing feature.
- YouTube deck cards now show browser-isolated/mix-only status, desktop deck cards show compact native source/VST3 status, and desktop bus cards show native-processable source plus VST3 active/fallback/degraded status.

Depends on:
- Persistent native audio router.
- Current VST3 bridge/plugin-chain path.

### [ ] Desktop: optional virtual audio driver and system-wide routing

Goal: Make the Resonance virtual audio path reliable enough for beta users on Windows with Secure Boot enabled.

Deliverables:
- Validate SysVAD/Resonance virtual endpoint install on the target Windows setup.
- Confirm continuous Deck A/B capture from the virtual endpoint.
- Document driver build, install, rollback, and test requirements. `docs/virtual-audio-device.md` now includes Secure Boot-compatible signing guidance, a capture test checklist, and rollback steps.
- Add app-side diagnostics for missing driver, wrong input, and capture failures.
- Add a read-only driver/capture readiness command for beta validation: `npm run driver:capture-readiness`.

Acceptance criteria:
- Secure Boot compatible install path is documented.
- Resonance virtual endpoint is auto-detected and selected when available.
- Continuous capture into Deck A and Deck B works for a sustained test session.
- Failure states are visible in the desktop panel.

Progress:

- Readiness documentation and the local diagnostic command are in place.
- The desktop readiness panel now reports the built driver package, Secure Boot signing path, test-signing state, virtual endpoint presence, and next actions for blocked/manual checks.
- On the current Windows machine, `npm run driver:capture-readiness -- -Json` reports Secure Boot enabled, test signing disabled, the local driver package built, native router helper built, and no installed Resonance endpoint.
- Added read-only driver signing workflow commands: `npm run driver:package-signing` creates a submission folder/zip under `release/driver-signing/`, and `npm run driver:verify-signing` checks required INF/CAT/SYS files, Authenticode status, SignTool kernel-policy status, and SHA256 hashes.
- Target-machine install and the 20-minute sustained Deck A/B capture pass remain open.

Depends on:
- Current native router capture path.
- Local WDK/SysVAD build environment.

### [ ] Native audio: add latency, buffer, and routing controls

Goal: Give desktop users predictable control over audio latency and output routing.

Deliverables:
- Surface native buffer size, sample rate, underrun count, and selected output in the UI.
- Add safe latency profiles: low, balanced, stable.
- Preserve selected input/output and latency profile across sessions.
- Add underrun/degraded status when the router cannot keep up.

Acceptance criteria:
- Users can switch output devices without losing loaded deck state.
- Latency profile changes are sent to the native router.
- Underruns and capture queue pressure are visible.
- Settings persist and restore on desktop app restart.

Progress:

- Desktop latency controls are now exposed in the engine panel with low, balanced, stable, and custom buffer modes.
- Latency settings persist in app state and flow through the existing desktop engine settings IPC path.
- Native snapshots surface requested/actual buffer state and restart-required status.

Depends on:
- Persistent native audio router.
- Device enumeration.

### [ ] Native audio: finish non-WAV source and continuous stream hardening

Goal: Make Deck A/B input robust for PCM, loopback, and future decoded media streams.

Deliverables:
- Support normalized PCM stream metadata in engine state.
- Harden start/stop capture transitions.
- Add queue limits and user-visible overflow/underrun state.
- Add tests or smoke scripts for pushed PCM and continuous capture state.

Acceptance criteria:
- Decks recover cleanly after capture stop/start cycles.
- Engine state differentiates WAV, PCM, loopback, and virtual-device sources.
- No stale playing/capture state remains after stop.

Depends on:
- Persistent native router.
- Desktop app-owned PCM/capture routing.

## Phase 2: Plugin Host

### [ ] Plugin host: implement sandboxed VST3 loader prototype

Goal: Load one real VST3 plugin instance behind the existing helper boundary without destabilizing the Electron UI.

Deliverables:
- Native helper design for VST3 discovery, instantiate, process, unload. The current helper protocol now covers sandbox metadata load, parameter enumeration, and unload.
- One known test VST3 plugin loaded in a sandbox/helper process.
- Crash/timeout handling that marks the plugin degraded instead of crashing Resonance.
- Parameter enumeration for the loaded test plugin.

Acceptance criteria:
- One VST3 plugin can be loaded and unloaded through the helper.
- Failure is contained to the helper process.
- The UI shows load status and blocked/degraded state.
- Third-party plugin loading remains disabled unless explicitly routed through the sandbox path.

Progress:

- Helper commands are in place for `loadPlugin`, `enumerateParameters`, and `unloadPlugin`.
- The prototype can load VST3 bundle metadata in the sandbox process and expose the initial host-side parameter contract.
- Native VST3 bridge scaffold is in `native/vst3-bridge`, builds with `npm run native:vst3-bridge`, and reports SDK/test-plugin readiness to the desktop panel.
- Native VST3 bridge builds against the Steinberg SDK submodule, loads real VST3 modules, enumerates real parameters, processes an internal 32-bit float test block, and processes external interleaved PCM16 blocks through a loaded processor.
- Persistent Deck A/B playback now routes each deck's live PCM blocks through the first staged bridge-capable VST3 plugin for that deck, using a warm per-deck bridge process and NativeDSP fallback on load, process, or silent-output failures.

Depends on:
- Persistent `PluginHostClient`.
- Current plugin scan metadata and chain plan.

### [ ] Plugin host: connect VST3 processing to Deck A/B PCM

Goal: Route Deck A/B PCM through one sandboxed VST3 plugin chain.

Deliverables:
- Define PCM block exchange between native router and plugin helper.
- Reuse the verified bridge `processPcm` lifecycle for external PCM buffers.
- Add process callback timing/latency budget.
- Route Deck A and Deck B through independent plugin instances.
- Keep NativeDSP fallback available when VST3 processing is disabled or fails.

Acceptance criteria:
- Deck A and Deck B can run separate plugin chains.
- Bypass, enabled state, wet/dry, and gain parameters affect processing.
- If plugin processing fails, audio falls back or stops gracefully with a visible error.

Progress:

- The native router now sends each deck's live PCM blocks to the first staged bridge-capable VST3 plugin for that deck.
- Each deck keeps its own VST3 bridge process/plugin instance warm while the selected plugin path remains unchanged.
- Router snapshots expose `vst3Status`, `vst3BlocksProcessed`, and `vst3Failures`.
- NativeDSP fallback remains active if a VST3 plugin cannot load, cannot process, or returns silence for non-silent input.
- Normalized exposed VST3 parameter values are forwarded into each `processPcm` block.
- Rich VST3 parameter display/unit conversion and lower-latency binary/shared-memory IPC remain open.

Depends on:
- VST3 loader prototype.
- Native router PCM block contract.

### [ ] Plugin host: Waves shell discovery and validation

Goal: Identify what is needed to support Waves plugins safely after generic VST3 works.

Deliverables:
- Expand Waves shell metadata beyond file detection.
- Detect Waves shell architecture/version.
- Document Waves-specific loading constraints.
- Validate one Waves plugin on the target Windows machine.

Acceptance criteria:
- Waves candidates show enough metadata to debug load failures.
- Waves loading remains blocked until generic VST3 processing is reliable.
- Documentation clearly explains the current limitation.

Depends on:
- VST3 loader prototype.
- User machine with Waves installed.

### [ ] Plugin UI: plugin browser, chain order, and presets

Goal: Turn the current plugin list into a usable deck plugin rack.

Deliverables:
- Filter/sort plugin catalog by built-in, VST2, VST3, Waves vendor, blocked, active.
- Add move up/down controls for chain order.
- Add remove, duplicate, reset parameters, and rename preset controls.
- Persist per-plugin preset names and parameters.

Acceptance criteria:
- Users can stage multiple plugins and reorder them per deck.
- Built-in NativeDSP and scanned third-party candidates are visually distinct.
- Blocked third-party plugins can store settings but clearly do not execute.

Progress:

- The EQ panel now has an active plugin rack for the selected deck with move up/down, duplicate, reset parameters, remove, bypass, and preset-name editing.
- The plugin catalog can be filtered by all, active, built-in, VST2, VST3, Waves vendor, and blocked candidates, then sorted by status, name, or vendor.
- Chain entries use per-instance IDs while retaining the original plugin ID for NativeDSP fallback and future VST3 routing.

Depends on:
- Current plugin parameter state.
- Scanned plugin catalog.

## Phase 3: Desktop App Packaging

### [x] Desktop: package Resonance for beta users

Goal: Provide a repeatable Windows desktop build that includes the Electron app and native helpers.

Deliverables:
- Package Electron app with native audio router and WASAPI meter helpers.
- Include plugin-host helper files.
- Produce a local installer or zip package.
- Document install/run/uninstall steps.

Acceptance criteria:
- A beta tester can run Resonance without using `npm`.
- Native helper binaries are available at runtime.
- Version and build date are visible in docs or app diagnostics.

Progress:

- `npm run desktop:package` now builds and copies both native helper binaries: WASAPI meter and Deck A/B audio router.
- The local package writes `release/Resonance-local/resonance-package.json` with version, build time, and included components.
- `npm run desktop:installer` now builds an NSIS Windows installer at `release/installer/Resonance-Setup-0.2.0-x64.exe`.
- The installer includes the Electron shell, built web app, audio engine, native router helper, WASAPI meter helper, and VST3 bridge helper. The virtual audio driver is intentionally not bundled yet.

Depends on:
- Native helper build scripts.
- Desktop engine startup path.

### [ ] Desktop: add beta diagnostics bundle

Goal: Make beta bug reports actionable.

Deliverables:
- Add a diagnostics export containing engine state, device scan, router snapshot, plugin scan, and recent errors.
- Avoid exporting secrets or YouTube API keys.
- Add a UI button or documented command to generate the bundle.

Acceptance criteria:
- A tester can generate one file for support.
- The bundle includes enough detail to debug audio device, plugin, and capture issues.
- Secrets are excluded.

Progress:

- The desktop panel now exposes **Export Diagnostics**.
- The engine writes redacted JSON bundles to `%APPDATA%\Resonance\diagnostics` with app version, platform, engine state, device/router/plugin state, readiness checks, and selected settings.

Depends on:
- Engine state shape.
- Desktop panel diagnostics.

## Phase 4: Web App and Mobile

### [ ] Web app: harden YouTube search, playlist import, and queue workflows

Goal: Make the web app feel complete for regular playlist use.

Deliverables:
- Improve empty/loading/error states for search and playlist import.
- Add queue save/restore validation.
- Add playlist duplicate handling.
- Add clearer public-data vs user-data guidance.

Acceptance criteria:
- Search, paste URL, playlist import, queue add/remove/reorder, and load-next flows are covered by smoke tests.
- API errors are user-readable.
- Queue state survives refresh.

Progress:

- Playlist imports now remove duplicate video IDs before loading the first video and queueing the rest.
- Import messaging clarifies that public playlist videos are imported and reports skipped duplicates.
- Browser smoke now starts from clean storage, covers search queue de-duplication, mocked playlist import, queue population, and mobile playlist rendering.

Depends on:
- Current YouTube Data API Worker route.
- Browser smoke infrastructure.

### [ ] Mobile: finish iOS playlist-first mode

Goal: Make iOS users successful despite one-video playback restrictions.

Deliverables:
- Keep one-deck mode default on iOS.
- Hide or disable two-deck-only controls on iOS.
- Prioritize playlist, queue, liked videos, and history flows.
- Add iOS-specific copy where platform limits matter.

Acceptance criteria:
- iOS layout has no dead two-deck controls.
- Playlist playback and queue management remain usable on small screens.
- Smoke/manual test notes cover iOS limitations.

Progress:

- Browser smoke now validates the mobile playlist strip and deck-count controls at a phone-sized viewport.
- iOS remains single-deck by default with the two-deck control disabled and an iOS-specific limitation notice.

Depends on:
- Current iOS deck-count restriction.
- Playlist/queue workflows.

## Phase 5: Browser Extension

### [ ] Extension: beta packaging and tester release flow

Goal: Make the Chrome extension testable by non-developers.

Deliverables:
- Package extension zip consistently.
- Document Developer Mode install, update, and removal.
- Add versioned download link on hosted docs.
- Add known limitations for tab capture and YouTube mixing.

Acceptance criteria:
- A tester can install the extension from documented steps.
- Extension version matches package output.
- Known limitations are explicit.

Progress:

- `npm run package:extension` now reads `extension/manifest.json` for the versioned zip name and writes a package metadata JSON file.
- Beta docs cover Developer Mode install/update/remove expectations, current limitations, and local-only tab audio processing.

Depends on:
- Existing extension package script.
- Hosted download route.

### [ ] Extension: prepare Chrome Web Store submission

Goal: Decide whether the extension can be distributed outside Developer Mode.

Deliverables:
- Review permissions and privacy disclosure.
- Prepare store listing assets and description.
- Document what tab audio is captured and processed.
- Identify policy blockers before submission.

Acceptance criteria:
- Submission checklist is complete.
- Privacy and permission explanations are ready.
- Any policy blockers are tracked separately.

Progress:

- Extension beta docs now include the requested permissions, tab-capture privacy behavior, and Chrome Web Store trusted-tester submission checklist.
- Store distribution remains gated until beta users validate tab-capture behavior and listing screenshots are prepared.

Depends on:
- Stable extension behavior.
- Beta feedback.

## Phase 6: Cloudflare, Docs, and Release

### [ ] Cloudflare: production deployment and configuration hardening

Goal: Keep `resonance.iamfatness.us` reliable as the public landing/docs/app host.

Deliverables:
- Verify Worker deploy script and route.
- Document required secrets and deployment commands.
- Add deploy smoke check to release workflow.
- Track current Worker version after deploys.

Acceptance criteria:
- Deployment can be repeated from a clean checkout.
- Missing secrets produce clear errors.
- Hosted app smoke check passes after deploy.

Progress:

- Added `npm run smoke:deploy` for live hosted smoke checks against `https://resonance.iamfatness.us/app`.
- Added `docs/release-checklist.md` with local verification, Cloudflare deploy, beta artifact, and manual beta checks.
- Current repeated deploys have passed through `npm run deploy:worker` and live route checks.
- Current Cloudflare Worker version after the hot cue deploy: `7e5a492c-02a1-4880-88a6-38a84603b8cb`.

Depends on:
- Current Worker deploy script.

### [ ] Documentation: complete user and developer docs

Goal: Make the project understandable without reading the whole chat history.

Deliverables:
- Keep README as the entry point.
- Maintain docs for desktop app, audio engine, plugin hosting, extension beta, and virtual audio driver.
- Add screenshots or diagrams where useful.
- Add a “known limitations” section.

Acceptance criteria:
- A developer can build web, desktop, native helper, and extension from docs.
- A beta tester can install/use the relevant build from docs.
- Roadmap links remain current.

Progress:

- Added `docs/known-limitations.md` covering YouTube, mobile, desktop driver, plugin host, and Chrome extension constraints.
- README and the public landing page now link to release and limitation documentation.

Depends on:
- Current docs.
- Desktop packaging decisions.

### [ ] QA: automated regression and beta feedback loop

Goal: Prevent repeated regressions and make beta feedback trackable.

Deliverables:
- Expand browser smoke coverage for search, queue, EQ/plugin panel, and mobile layout.
- Add native helper command checks to CI where possible.
- Add manual beta test checklist.
- Create GitHub issue template for bug reports.

Acceptance criteria:
- Core app flows are covered by automated smoke tests.
- Native helper build/run checks are documented or automated.
- Beta feedback maps to GitHub issues.

Progress:

- Added a beta bug report issue template under `.github/ISSUE_TEMPLATE`.
- Browser smoke covers search, queue de-duplication, playlist import de-duplication, upload layout, and mobile playlist rendering.
- Native helper and package commands are listed in the release checklist.

Depends on:
- Current Vitest and Playwright smoke setup.

### [ ] Security and compliance: YouTube, audio capture, and plugin safety

Goal: Make the app safe and explainable before broad beta.

Deliverables:
- Document YouTube API key handling and quota expectations.
- Document browser extension tab-capture privacy behavior.
- Keep third-party plugin loading sandboxed and disabled until safe.
- Avoid collecting user Google account data unless a full OAuth/privacy plan exists.

Acceptance criteria:
- No secrets are committed.
- Privacy-sensitive behavior is documented.
- Plugin host failure modes do not crash the app.
- Google/YouTube auth decisions are tracked before implementation.

Progress:

- Known limitations and extension beta docs document YouTube API key handling, public playlist import, Chrome tab-capture privacy, and plugin sandbox boundaries.
- Diagnostics export redacts secret-like fields before writing support bundles.
- Google account login remains intentionally out of scope until an OAuth/privacy plan exists.

Depends on:
- YouTube API Worker route.
- Extension beta docs.
- Plugin host sandbox.

## Current Priority Order

1. Desktop: DAW-style app-owned playback and plugin routing.
2. Plugin host: implement sandboxed VST3 loader prototype.
3. Plugin UI: plugin browser, chain order, and presets.
4. Desktop: optional virtual audio driver and system-wide routing.
5. Web app: harden YouTube search, playlist import, and queue workflows.
6. Mobile: finish iOS playlist-first mode.
7. Extension: beta packaging and tester release flow.
8. Cloudflare/docs/QA/security hardening.
