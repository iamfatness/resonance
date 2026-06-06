# Resonance Roadmap

This file is the project backlog until GitHub issue creation is available from the connector. Each top-level checklist item is sized to become one GitHub issue. Keep implementation PRs linked back to the relevant item.

## Tracking Rules

- One issue per top-level roadmap item.
- Each issue should keep the same title, goal, acceptance criteria, and dependencies from this file.
- Close an item only after code, docs, and verification are complete.
- Prefer shipping in this order: core audio path, plugin host, desktop packaging, beta readiness, then polish.

## Phase 1: Desktop Audio Foundation

### [ ] Desktop: productionize virtual audio driver and capture routing

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
- Virtual audio capture validation.

## Phase 2: Plugin Host

### [ ] Plugin host: implement sandboxed VST3 loader prototype

Goal: Load one real VST3 plugin instance behind the existing helper boundary without destabilizing the Electron UI.

Deliverables:
- Native helper design for VST3 discovery, instantiate, process, unload.
- One known test VST3 plugin loaded in a sandbox/helper process.
- Crash/timeout handling that marks the plugin degraded instead of crashing Resonance.
- Parameter enumeration for the loaded test plugin.

Acceptance criteria:
- One VST3 plugin can be loaded and unloaded through the helper.
- Failure is contained to the helper process.
- The UI shows load status and blocked/degraded state.
- Third-party plugin loading remains disabled unless explicitly routed through the sandbox path.

Depends on:
- Persistent `PluginHostClient`.
- Current plugin scan metadata and chain plan.

### [ ] Plugin host: connect VST3 processing to Deck A/B PCM

Goal: Route Deck A/B PCM through one sandboxed VST3 plugin chain.

Deliverables:
- Define PCM block exchange between native router and plugin helper.
- Add process callback timing/latency budget.
- Route Deck A and Deck B through independent plugin instances.
- Keep NativeDSP fallback available when VST3 processing is disabled or fails.

Acceptance criteria:
- Deck A and Deck B can run separate plugin chains.
- Bypass, enabled state, wet/dry, and gain parameters affect processing.
- If plugin processing fails, audio falls back or stops gracefully with a visible error.

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
- Filter/sort plugin catalog by built-in, VST3, Waves, blocked, active.
- Add move up/down controls for chain order.
- Add remove, duplicate, reset parameters, and rename preset controls.
- Persist per-plugin preset names and parameters.

Acceptance criteria:
- Users can stage multiple plugins and reorder them per deck.
- Built-in NativeDSP and scanned third-party candidates are visually distinct.
- Blocked third-party plugins can store settings but clearly do not execute.

Depends on:
- Current plugin parameter state.
- Scanned plugin catalog.

## Phase 3: Desktop App Packaging

### [ ] Desktop: package Resonance for beta users

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

Depends on:
- YouTube API Worker route.
- Extension beta docs.
- Plugin host sandbox.

## Current Priority Order

1. Desktop: productionize virtual audio driver and capture routing.
2. Plugin host: implement sandboxed VST3 loader prototype.
3. Plugin UI: plugin browser, chain order, and presets.
4. Desktop: package Resonance for beta users.
5. Web app: harden YouTube search, playlist import, and queue workflows.
6. Mobile: finish iOS playlist-first mode.
7. Extension: beta packaging and tester release flow.
8. Cloudflare/docs/QA/security hardening.
