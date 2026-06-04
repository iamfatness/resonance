# Resonance Refactoring Plan

**Status**: Phase 3 runtime hardening in progress / direct audio cleanup complete
**Owner**: Codex following `CODEX_PROMPT.md`  
**Last Updated**: 2026-06-04  
**Related**: `CODEX_PROMPT.md`, `REFACTOR_SUMMARY.md`

This is the living checklist for the refactor. It must be kept current as work proceeds.

**Current checkpoint**: Phase 0, Phase 1 core extraction, five Phase 2 modularization slices, Phase 3 YouTube iframe loader hardening, and Phase 3 direct audio EQ lifecycle cleanup are complete. Hooks plus `VideoDeck`, `LandingPage`, `DirectSourcePanel`, `DesktopEnginePanel`, `SearchResultsPanel`, `SidebarPanels`, `EqPanel`, and `QueuePanel` are extracted. `src/main.jsx` is down from 2175 lines to 747 lines, meeting the primary Phase 2 size target. The YouTube iframe API now loads through a singleton platform module, and direct audio EQ now owns visualizer, graph, context, and object URL cleanup explicitly.

---

## 1. Goals & Non-Goals

### Primary Goals
- Dramatically improve maintainability by breaking down `src/main.jsx` and organizing the giant stylesheet without changing the UI.
- Eliminate duplication of presets, DSP math, curve helpers, and core data shapes.
- Make YouTube iframe loading and direct audio EQ lifecycle robust.
- Establish one documented source of truth for `MoodPreset`, `DeckProcessing`, `EngineSettings`, bands, curves, and boost helpers.
- Add pragmatic quality infrastructure: MIT license, package metadata, pinned dependency ranges, ESLint, Prettier, Vitest, and CI.
- Preserve all current functionality and current look and feel.
- Preserve the Electron preload surface and engine IPC contract.

### Success Metrics
- [x] `src/main.jsx` is reduced well below 800 lines, or a clear partial extraction path is documented if the effort is stopped early.
- [ ] `src/lib/presets.js` is the canonical preset/DSP module.
- [ ] `npm run lint` exists and passes.
- [ ] `npm test` exists and passes with at least 6 meaningful tests.
- [ ] `.github/workflows/ci.yml` runs install, lint, test, and build.
- [ ] `npm run build` passes after every significant phase.
- [ ] Main flows remain intact: YouTube A/B decks, search, playlist import, queue, likes/history, mood/EQ, direct audio EQ, extension package, and desktop panel.
- [ ] README and relevant docs reflect the new module structure.
- [ ] `REFACTOR_SUMMARY.md` is completed using the required template.

### Non-Goals
- No TypeScript migration in this pass.
- No C++ rewrite.
- No breaking preload or engine IPC changes.
- No heavy state-management dependency.
- No full plugin host or driver feature work.
- No UI redesign.

---

## 2. Exploration Findings

### Exploration Completed
- [x] Pulled latest `origin/main` to retrieve the three mandatory refactor files.
- [x] Read `CODEX_PROMPT.md`, `REFACTOR_PLAN.md`, `REFACTOR_SUMMARY.md` in order.
- [x] Listed repository structure.
- [x] Read `README.md`, `package.json`, `src/main.jsx` core sections, `src/worker.js`, `vite.config.js`, `engine/audio-engine.cjs`, `electron/preload.cjs`, `extension/offscreen.js`, `extension/popup.js`, `scripts/package-extension.ps1`, `docs/audio-engine.md`, and `docs/desktop-app.md`.
- [x] Searched for preset/DSP duplication, YouTube iframe initialization, desktop settings construction, storage keys, and engine contracts.
- [x] Ran baseline `npm run build`; it passes.
- [x] Read resolved dependency versions from `package-lock.json`.

### Current Structure
- `src/main.jsx`: 2175 lines. Contains constants, storage helpers, YouTube parsers/API client calls, DSP/preset logic, hooks, UI components, `PlayerApp`, and `App`.
- `src/styles.css`: 2666 lines. Single global stylesheet.
- `extension/offscreen.js`: 134 lines. Duplicates band/preset/instrument math and applies Web Audio EQ.
- `extension/popup.js`: 154 lines. Duplicates mood presets and extension settings UI logic.
- `engine/audio-engine.cjs`: 1090 lines. Owns desktop settings/defaults and engine IPC state.
- `package.json`: scripts only plus `"main"`, with all app dependencies set to `"latest"`.

### Duplication Hotspots
- [ ] `moodPresets`, `instrumentBandWeights`, `bandFreqs`, `flatCurve`, gain clamp, and instrument boost math are duplicated across app and extension.
- [ ] `defaultDeckProcessing` and engine settings shape are mirrored between app and engine.
- [ ] YouTube API item normalization and metadata enrichment are duplicated between `vite.config.js` and `src/worker.js`.
- [ ] YouTube URL parsing helpers live inside `src/main.jsx` and are not tested.

### Fragile Areas
- `useYouTubePlayer` injects the YouTube iframe API script inside each hook and rewrites `window.onYouTubeIframeAPIReady`. Deck A and Deck B can race on first load.
- `useLocalEq` creates an `AudioContext`, filters, analyser, and visualizer loop but does not clearly own shutdown on unmount/source changes.
- `PlayerApp` owns 20+ state variables and has one broad persistence `useEffect`.
- Native router render/capture code works, but should only receive comments/documentation in this refactor unless a build issue appears.

### Dependency Versions From Lockfile
- `@vitejs/plugin-react`: `6.0.2`
- `lucide-react`: `1.17.0`
- `react`: `19.2.6`
- `react-dom`: `19.2.6`
- `vite`: `8.0.14`
- `electron`: `39.8.10`
- `wrangler`: `4.95.0`

### Contracts To Protect
- Preload surface: `window.resonanceDesktop.engine` methods must remain available and non-breaking.
- Desktop settings payload shape:
  - `preset`
  - `eqMode`
  - `curve`
  - `appEqBypassed`
  - `deckProcessing`
  - `deckVolumes`
  - `outputGain`
- Per-deck processing shape: `{ pan, eqBypassed, curve: number[8], pluginChain: [] }`.
- Browser localStorage key: `resonance.appState.v1`.
- Desktop engine settings path: `%APPDATA%/Resonance/engine-settings.json`.
- Extension must remain usable as an unpacked folder and packageable through `npm run package:extension`.

### Current Mood Flow
- UI `applyMoodPreset(name)` updates `activePreset`, `instrumentBoosts`, `deckVolumes`, and `eqMode`.
- `baseCurve` comes from manual curve or preset curve.
- `applyInstrumentBoosts(baseCurve, instrumentBoosts)` produces `effectiveCurve`.
- `processedCurve` is `flatCurve` when app EQ is bypassed.
- `desktopEngineSettings` sends the curve and deck processing to Electron.
- YouTube iframe audio only receives volume changes; real Web Audio EQ applies to direct audio, extension tab capture, and native desktop WAV/PCM/capture paths.

---

## 3. Target Architecture

### Target Directories
- `src/lib/presets.js`: pure preset, band, curve, boost, and deck-processing helpers.
- `src/lib/youtube.js`: pure YouTube URL, timestamp, playlist, and video helper functions.
- `src/lib/queue.js`: queue operations if extracted during testing.
- `src/lib/storage.js`: app storage helpers if extracted during state cleanup.
- `src/platform/youtubeIframeApi.js`: singleton YouTube iframe API loader.
- `src/hooks/useYouTubePlayer.js`
- `src/hooks/useLocalEq.js`
- `src/hooks/useDesktopEngine.js`
- `src/components/VideoDeck.jsx`
- `src/components/DirectSourcePanel.jsx`
- `src/components/DesktopEnginePanel.jsx`
- `src/components/LandingPage.jsx`
- `src/components/SearchResultsPanel.jsx`
- `src/components/SidebarPanels.jsx`
- `src/components/EqPanel.jsx`
- `src/components/QueuePanel.jsx`
- Additional components only after the current extraction passes build/tests.
- Optional `shared/contracts.js` if JSDoc in `src/lib/presets.js` is not enough.

### Key Decisions
- [x] Use `src/lib/` rather than `src/core/` for pure browser/app modules.
- [x] Keep Lucide/React icons out of `src/lib/presets.js`; icon mapping remains UI-only.
- [x] Extract hooks/components before attempting a reducer.
- [x] Keep `src/styles.css` intact initially to avoid visual regressions; add sections or split later.
- [x] Touch native C++ only for comments unless a defect is discovered.
- [ ] Validate the safest extension sharing approach before converting extension scripts to modules.
- [ ] Decide later whether YouTube Worker/Vite normalizers should be shared now or documented as a follow-up.

---

## 4. Detailed Phased Plan

### Phase 0: Hygiene, Licensing, Tooling & CI

**Goal**: Add project foundations without changing runtime behavior.

**Status**: Complete

- [x] Add root `LICENSE` with MIT text.
- [x] Enrich `package.json`:
  - [x] `name: "resonance"`
  - [x] `version: "0.2.0"`
  - [x] `description`
  - [x] `license: "MIT"`
  - [x] `repository`
  - [x] `bugs`
  - [x] `homepage`
  - [x] `author`
  - [x] `keywords`
  - [x] `engines.node: ">=20"`
- [x] Replace dependency `"latest"` values with lockfile-compatible ranges:
  - [x] `@vitejs/plugin-react: ^6.0.2`
  - [x] `lucide-react: ^1.17.0`
  - [x] `react: ^19.2.6`
  - [x] `react-dom: ^19.2.6`
  - [x] `vite: ^8.0.14`
- [x] Add ESLint and Prettier:
  - [x] install dev dependencies
  - [x] create ESLint config for browser, React, Node/CommonJS scripts
  - [x] create Prettier config
  - [x] add `lint`, `lint:fix`, `format`, `format:check`
- [x] Add Vitest:
  - [x] install dev dependency
  - [x] add `test` script
  - [x] add one placeholder/pure helper test only if needed before Phase 1
- [x] Add `.editorconfig`.
- [x] Add `.github/workflows/ci.yml`:
  - [x] Node 20 and 22 matrix
  - [x] `npm ci`
  - [x] `npm run lint`
  - [x] `npm test`
  - [x] `npm run build`
- [x] Verification:
  - [x] `npm install` or lockfile refresh as needed
  - [x] `npm run lint`
  - [x] `npm test`
  - [x] `npm run build`

**Phase 0 notes**:
- `npm run lint` exits with code 0 and currently reports 29 warnings from the existing monolith. These are intentionally left for Phase 1-3 cleanup rather than changing runtime behavior during hygiene work.
- `npm run package:extension` also passes and remains a required check for extension-affecting phases.

### Phase 1: Extract Canonical Core Models

**Goal**: One source of truth for presets, curves, bands, and deck-processing shape.

**Status**: Core app + extension extraction complete; YouTube proxy normalizer dedupe deferred.

- [x] Create `src/lib/presets.js`.
  - [x] Export `bands`, `bandFreqs`, `flatCurve`.
  - [x] Export React-free `moodPresets` with existing `curve`, `instruments`, `mix`, `intent`.
  - [x] Export `instrumentBandWeights`.
  - [x] Export `clampGain`, `applyInstrumentBoosts`, `getPreset`, `getEffectiveCurve`.
  - [x] Export `normalizeCurve`, `getDefaultDeckProcessing`, `normalizeDeckProcessing`.
  - [x] Add JSDoc for `MoodPreset`, `DeckProcessing`, and `EngineSettings`.
- [x] Keep UI icon mapping in `src/main.jsx` as `moodPresetIcons` initially.
- [x] Create `src/lib/youtube.js`.
  - [x] Move `parseYoutubeId`.
  - [x] Move `parseYoutubeTimestamp`.
  - [x] Move `parseYoutubePlaylistId`.
  - [x] Move `youtubeUrlForVideo`.
  - [x] Move `isYoutubeLoadInput`.
- [x] Update `src/main.jsx` imports and remove duplicate local definitions.
- [x] Add tests:
  - [x] `src/lib/presets.test.js`
  - [x] `src/lib/youtube.test.js`
  - [x] boost math clamps and matches existing behavior
  - [x] effective curve manual vs preset behavior
  - [x] deck processing defaults invalid saved values
  - [x] YouTube ID parser covers raw ID, watch URL, youtu.be, shorts, embed
  - [x] playlist parser covers `list=...`
  - [x] timestamp parser covers seconds and `1h2m3s`
- [x] Extension sharing:
  - [x] evaluate MV3 module script feasibility for popup/offscreen
  - [x] add `extension/lib/presets.js` and import it from popup/offscreen/background
  - [x] update extension packager to include nested `lib/`
- [x] Add a comment near `engine/audio-engine.cjs` `defaultSettings` pointing to canonical `src/lib/presets.js`.
- [x] Verification:
  - [x] `npm run lint`
  - [x] `npm test`
  - [x] `npm run build`
  - [x] `npm run package:extension`

**Phase 1 notes**:
- `src/lib/presets.js` is canonical for the web app and docs. `extension/lib/presets.js` mirrors the same math because the extension remains an unpacked-source prototype.
- The extension zip was inspected and includes `lib/presets.js`.
- YouTube Worker/Vite API normalizer dedupe remains a follow-up because it crosses runtime formats and is lower risk after core app helpers are tested.

### Phase 2: Modularize UI and Hooks

**Goal**: Shrink `src/main.jsx` while preserving UI/UX.

**Status**: Size target complete.

- [x] Create `src/hooks/useYouTubePlayer.js` by moving existing hook first.
- [x] Create `src/hooks/useLocalEq.js` by moving existing hook first.
- [x] Create `src/hooks/useDesktopEngine.js` by moving existing hook first.
- [x] Create `src/components/VideoDeck.jsx`.
- [x] Create `src/components/DesktopEnginePanel.jsx`.
- [x] Move `formatPlaybackTime` with `DesktopEnginePanel` or into `src/lib/time.js`.
- [x] Create `src/components/LandingPage.jsx`.
- [x] Extract search results panel after initial component extraction is stable.
- [x] Extract sidebar panel sections after search extraction is stable.
- [x] Extract EQ/plugin controls after preset module is stable.
- [x] Extract queue controls after EQ/plugin extraction is stable.
- [x] Extract direct-source controls after queue extraction is stable.
- [ ] Keep `src/styles.css` unchanged initially.
- [ ] Add CSS section comments or split only after component extraction passes.
- [ ] Consider `useSessionState` only after components/hooks are extracted.
- [ ] Verification after each significant extraction:
  - [x] `npm run lint`
  - [x] `npm test`
  - [x] `npm run build`

**Phase 2 notes**:
- `src/main.jsx` now contains app state, session operations, deck composition, and the remaining shell/transport markup rather than hook and large component definitions.
- Search results and the left sidebar panels now live in extracted components with the same props/state contract as the previous inline JSX.
- Mood presets, per-deck processing, plugin selection, instrument boosts, and manual EQ controls now live in `src/components/EqPanel.jsx`.
- Mix status, like/dislike/queue actions, user queue controls, and playlist track loading now live in `src/components/QueuePanel.jsx`.
- Direct audio file/URL input, the audio element, and the visualizer canvas now live in `src/components/DirectSourcePanel.jsx`.
- Lint passes cleanly after the Phase 3 singleton loader work.

### Phase 3: Fix Fragile Runtime Areas

**Goal**: Remove known races/leaks.

- [x] YouTube iframe loader:
  - [x] Create `src/platform/youtubeIframeApi.js`.
  - [x] Implement singleton `loadYouTubeIframeApi()`.
  - [x] Avoid per-hook `window.onYouTubeIframeAPIReady` overwrites.
  - [x] Ensure both decks wait on the same loader.
  - [x] Ensure cleanup destroys only the hook-owned player.
- [x] Direct audio EQ:
  - [x] Add a clear graph shutdown helper.
  - [x] Close `AudioContext` on unmount.
  - [x] Preserve the media-element graph across source replacement because browsers only allow one `MediaElementAudioSourceNode` per audio element.
  - [x] Cancel visualizer animation frame reliably.
  - [x] Revoke object URLs exactly once.
  - [x] Preserve filter chain and visualizer appearance.
- [ ] Persistence/state:
  - [ ] Extract storage helpers to `src/lib/storage.js` if low risk.
  - [ ] Keep private-mode storage failure resilience.
  - [ ] Optionally introduce `useSessionState` once core behavior is tested.
- [ ] Verification:
  - [x] Two YouTube decks load after refresh.
  - [ ] Rapid deck URL changes work.
  - [x] Direct audio file/URL EQ can be changed repeatedly.
  - [ ] State persists across refresh.

### Phase 4: Quality & Contracts

**Goal**: Make future changes safer.

- [ ] Add queue helper tests if queue helpers are extracted.
- [ ] Add desktop settings builder tests if builder is extracted.
- [ ] Add JSDoc to all exported pure helpers and hooks.
- [ ] Decide whether to add `shared/contracts.js`.
- [ ] Add comments in `native/audio-router/main.cpp` around current lock scope and polling strategy.
- [ ] Update engine/router comments to reference canonical preset/curve module without forcing ESM into CommonJS.
- [ ] Verification:
  - [ ] `npm run lint`
  - [ ] `npm test`
  - [ ] `npm run build`

### Phase 5: Documentation, Packaging, Summary

**Goal**: Leave the repo understandable and verifiable.

- [ ] Update `README.md`:
  - [ ] Project structure
  - [ ] lint/test/format commands
  - [ ] canonical preset module location
  - [ ] canonical YouTube helper location if extracted
- [ ] Update docs as needed:
  - [ ] `docs/audio-engine.md`
  - [ ] `docs/desktop-app.md`
  - [ ] `docs/plugin-hosting.md`
  - [ ] `docs/extension-beta.md` if extension module layout changes
- [ ] Review packaging scripts only for low-risk notes/fixes.
- [ ] Complete `REFACTOR_SUMMARY.md` using its exact template.
- [ ] Final verification:
  - [ ] `npm run lint`
  - [ ] `npm test`
  - [ ] `npm run build`
  - [ ] `npm run package:extension`
  - [ ] `npm run native:audio-router` if native comments changed
  - [ ] Desktop smoke where practical on Windows

---

## 5. Risks & Mitigations

- **YouTube deck race during hook refactor**: isolate singleton loader change and test both decks on reload.
- **Extension breakage from module imports**: validate MV3 constraints before converting; keep copy/sync fallback.
- **Lint rollout creates noisy churn**: start with pragmatic rules and avoid formatting the entire repo unless necessary.
- **State persistence regressions**: do not change storage shape until tests cover helpers; keep broad persistence effect initially.
- **CSS regression**: keep stylesheet intact until component extraction is proven.
- **Engine IPC regression**: do not remove or rename preload/engine methods.
- **Native regression**: comments only unless required.

---

## 6. Verification Checklist

- [x] Baseline `npm run build` passes before refactor.
- [x] `npm run lint` passes after Phase 0 and current Phase 2 slices.
- [x] `npm test` passes after Phase 0/1 and current Phase 2 slices.
- [x] `npm run build` passes after every significant phase so far.
- [x] `npm run package:extension` passes after extension-affecting changes and current Phase 2 slice.
- [ ] Manual web flows:
  - [ ] Load YouTube video into Deck A.
  - [ ] Load YouTube video into Deck B.
  - [ ] Change moods and verify volumes/EQ guidance.
  - [ ] Use search and playlist import.
  - [ ] Queue, play next, move, remove, clear queue.
  - [ ] Likes/history/sidebar panels.
  - [ ] Direct audio file/URL EQ and visualizer.
  - [ ] Refresh and confirm state restore.
- [ ] Desktop flows on Windows:
  - [ ] Engine panel state loads.
  - [ ] Device scan works.
  - [ ] Native router build or existing router still works.
  - [ ] Deck capture controls remain visible and callable.
- [ ] No new console errors observed in smoke testing.

---

## 7. How Work Should Proceed

1. Execute Phase 0 first.
2. Commit or checkpoint after Phase 0 verification.
3. Execute Phase 1 in the smallest possible extraction steps.
4. Verify after every extraction step.
5. Only start larger UI modularization after pure logic tests are in place.
6. Keep this plan updated as tasks complete or risks change.

---

## 8. Post-Refactor Recommended Next Steps

- Consider TypeScript for contracts after the JS refactor stabilizes.
- Evaluate `electron-builder` or Electron Forge for real desktop releases.
- Improve native router with event-driven WASAPI after the app model is cleaner.
- Create a real shared bundle step for extension/web preset logic.
- Add tests around desktop engine IPC simulation.
