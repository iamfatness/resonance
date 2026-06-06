# Project Evaluation and Next Plan

Generated after the Phase 1-6 roadmap push on June 6, 2026.

## Current Evaluation

Resonance is now a functional web app, Electron desktop prototype, Chrome extension beta, and documented Windows audio-driver/plugin-host prototype. The unblocked parts of the roadmap have been advanced, verified, committed, pushed, and deployed.

## Completed or Substantially Advanced

- Web app: two-deck YouTube playback, one-deck iOS mode, search, public playlist import, queue management, direct audio EQ, mood presets, instrument boosts, and persistent browser state.
- Browser smoke: upload/direct audio path, search result layout, queue de-duplication, playlist import de-duplication, mobile playlist rendering, and live deploy smoke.
- Desktop app: Electron shell, native helper IPC, persistent native Deck A/B router, latency controls, per-deck pan/EQ/plugin settings, beta diagnostics export, and local package script.
- Native audio: local WAV, pushed PCM, bounded capture, continuous capture state, latency profiles, source normalization, queue/underrun status, and helper tests.
- Plugin host: persistent helper process, NativeDSP fallback lane, scanned VST3/Waves candidates, sandbox metadata-load lifecycle, parameter enumeration contract, and plugin rack UI.
- Chrome extension: tab-capture EQ beta package, versioned download artifact, metadata manifest, tester docs, permissions/privacy notes, and Web Store beta checklist.
- Docs/release: release checklist, known limitations, beta issue template, driver readiness docs, extension docs, plugin hosting docs, roadmap progress, and Cloudflare deploy smoke command.

## Blocked or Not Yet Complete

- Secure Boot virtual audio driver install: local test-signed SysVAD cannot be installed on this Secure Boot machine. A Microsoft attestation/production-signed package is required.
- Sustained virtual-device capture validation: requires the signed Resonance endpoint installed on a target machine, then a 20-minute Deck A/B capture pass.
- Real VST3 execution: the helper has a metadata lifecycle, but it does not instantiate or execute plugin binaries yet. A native VST3 SDK bridge is required.
- Waves validation: blocked until generic VST3 execution is reliable and a Waves-installed target machine is available.
- Chrome Web Store release: blocked until beta tab-capture behavior, listing screenshots, and owner dashboard access are ready.
- Google account features: intentionally out of scope until there is an OAuth/privacy plan. Current playlist import uses public YouTube data only.

## New Plan

### Track A: Signed Driver Beta

1. Prepare driver signing package for Microsoft attestation or production signing.
2. Install the signed driver on a Secure Boot beta machine.
3. Run `npm run driver:capture-readiness`.
4. Run the 20-minute sustained Deck A/B virtual-device capture test.
5. File issues for any endpoint naming, routing, underrun, or rollback failures.

### Track B: Real Plugin Host

1. Add a native VST3 SDK bridge helper for one known test VST3 plugin. The scaffold now lives in `native/vst3-bridge` and builds with `npm run native:vst3-bridge`.
2. Install/configure the Steinberg VST3 SDK with `RESONANCE_VST3_SDK_DIR`, set `RESONANCE_TEST_VST3_PLUGIN`, then extend `loadPlugin` from metadata-loaded to real instantiate/unload while keeping crashes isolated.
3. Define PCM block exchange between `native/audio-router` and the plugin helper.
4. Route Deck A and Deck B through independent plugin instances.
5. Add fallback/degraded behavior if processing misses timing budget or the helper crashes.
6. Validate Waves shell behavior only after generic VST3 is stable.

### Track C: Beta Packaging

1. Build and verify the NSIS installer with `npm run desktop:installer`; the artifact is `release/installer/Resonance-Setup-0.2.0-x64.exe`.
2. Include package manifest, helper versions, and diagnostics export instructions in release notes.
3. Add a beta smoke checklist for desktop install, extension install, playlist import, and diagnostics export.
4. Decide whether GitHub Releases or Cloudflare downloads will host desktop beta packages.
5. Add code signing before broad Windows distribution to reduce SmartScreen friction.

### Track D: Product Hardening

1. Add richer user-visible errors for YouTube quota/auth/API failures.
2. Add more smoke assertions for EQ/plugin rack controls and direct audio analyzer behavior.
3. Add mobile manual test notes for iOS Safari and Chrome on iOS.
4. Add release notes per beta version.
5. Convert the roadmap items into GitHub issues when issue creation permissions are available.

### Track E: Compliance and Distribution

1. Finalize Chrome Web Store privacy text and screenshots.
2. Keep Google login/account access out until a written OAuth/privacy plan exists.
3. Document audio capture behavior for desktop driver, extension tab capture, and diagnostics bundles.
4. Review plugin sandbox risks before enabling any third-party binary execution.

## Recommended Next Item

Start Track B with the native VST3 SDK bridge design and a single known free/test VST3 plugin. That is the highest-impact unblocked engineering path toward the original goal: per-video plugins, Waves support later, and bypassable app EQ.
