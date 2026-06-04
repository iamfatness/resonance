# Resonance Refactoring Summary

**Date**: 2026-06-04  
**Performed by**: Codex following `CODEX_PROMPT.md`  
**Phases Completed**: Phase 0, Phase 1 core extraction, Phase 2 UI modularization slices, Phase 3 YouTube loader hardening, Phase 3 direct audio EQ cleanup, browser smoke automation

---

## Executive Summary

The codebase now has real project hygiene, tests, linting, CI scaffolding, and extracted core model modules. `src/main.jsx` has continued shrinking from a monolith into an orchestration file: hooks, major UI surfaces, direct-source controls, search results, the left sidebar, EQ/plugin controls, and queue controls have moved into `src/hooks/` and `src/components/`. The app behavior and public Electron bridge contract were preserved.
The YouTube iframe API now loads through a singleton platform module instead of each deck hook overwriting the global ready callback.
Direct audio EQ now has explicit cleanup ownership for its visualizer frame, Web Audio graph, audio context, and local object URLs.
Browser smoke automation now starts a production preview and checks that the app shell and direct audio input render in Chromium.

---

## What Changed

### Architecture & Structure
- Added canonical app preset/DSP helpers in `src/lib/presets.js`.
- Added pure YouTube parsing helpers in `src/lib/youtube.js`.
- Added singleton YouTube iframe API loader in `src/platform/youtubeIframeApi.js`.
- Added extension preset helper module in `extension/lib/presets.js`.
- Extracted hooks:
  - `src/hooks/useYouTubePlayer.js`
  - `src/hooks/useLocalEq.js`
  - `src/hooks/useDesktopEngine.js`
- Extracted components:
  - `src/components/VideoDeck.jsx`
  - `src/components/LandingPage.jsx`
  - `src/components/DirectSourcePanel.jsx`
  - `src/components/DesktopEnginePanel.jsx`
  - `src/components/SearchResultsPanel.jsx`
  - `src/components/SidebarPanels.jsx`
  - `src/components/EqPanel.jsx`
  - `src/components/QueuePanel.jsx`

### Size Reductions
- `src/main.jsx`: 2175 lines -> 747 lines
- `src/styles.css`: unchanged in this slice
- Duplication removed: app-side preset/DSP helpers, app-side YouTube URL parsing helpers, extension popup/offscreen preset math

### New Infrastructure
- LICENSE
- package.json improvements
- ESLint / Prettier
- Tests (Vitest)
- Browser smoke script (Playwright)
- CI workflow
- EditorConfig

### Specific Bug / Fragility Fixes
- YouTube player loading: singleton loader now prevents Deck A/B from racing on `window.onYouTubeIframeAPIReady`.
- Direct audio EQ lifecycle: visualizer, graph, context, and local object URL cleanup are now explicit.
- State management / persistence: unchanged behavior; reducer extraction remains a follow-up.
- Other: extension package now includes nested `lib/` files.

---

## Key Decisions Made

- Keep preset/DSP logic in `src/lib/presets.js` without React or Lucide icons.
- Keep extension runnable as unpacked source while adding `extension/lib/presets.js`.
- Keep CSS intact during initial component extraction to avoid visual regressions.
- Keep engine IPC and preload APIs unchanged.
- Configure ESLint pragmatically while still keeping the current source lint-clean.

---

## Verification Performed

- [x] `npm run build` clean
- [x] `npm run lint` clean
- [x] `npm test` passes (11 tests)
- [x] `npm run smoke:browser` passes
- [x] `npm run package:extension` passes
- Manual flows verified:
  - YouTube Deck A + B with mood changes: not manually browser-smoked in this slice
  - Direct audio file + URL EQ + visualizer: browser-probed with a generated WAV file and no page errors
  - Queue, search, likes, history, side panels: not manually browser-smoked in this slice
  - Extension capture + EQ: package verified; browser load not manually smoked in this slice
  - Desktop engine panel: build verified; desktop app not manually smoked in this slice
- State persistence across refresh: not manually browser-smoked in this slice
- Extension packaging still works and unpacked extension package includes `lib/presets.js`
- No new console errors: not manually browser-smoked in this slice

---

## Files Changed (High-Level Summary)

**New files**:
- `src/lib/presets.js`
- `src/lib/presets.test.js`
- `src/lib/youtube.js`
- `src/lib/youtube.test.js`
- `src/platform/youtubeIframeApi.js`
- `src/platform/youtubeIframeApi.test.js`
- `scripts/browser-smoke.mjs`
- `src/lib/smoke.test.js`
- `src/components/VideoDeck.jsx`
- `src/components/LandingPage.jsx`
- `src/components/DirectSourcePanel.jsx`
- `src/components/DesktopEnginePanel.jsx`
- `src/components/SearchResultsPanel.jsx`
- `src/components/SidebarPanels.jsx`
- `src/components/EqPanel.jsx`
- `src/components/QueuePanel.jsx`
- `src/hooks/useYouTubePlayer.js`
- `src/hooks/useLocalEq.js`
- `src/hooks/useDesktopEngine.js`
- `extension/lib/presets.js`
- `.github/workflows/ci.yml`
- `.editorconfig`
- `.prettierrc`
- `eslint.config.js`
- `LICENSE`

**Modified files**:
- `src/main.jsx`
- `package.json`
- `package-lock.json`
- `scripts/package-extension.ps1`
- `extension/offscreen.js`, `extension/popup.js`, `extension/background.js`
- `extension/offscreen.html`, `extension/popup.html`
- `engine/audio-engine.cjs`
- `README.md`
- `docs/audio-engine.md`
- `docs/desktop-app.md`
- `docs/extension-beta.md`
- `REFACTOR_PLAN.md`

---

## Remaining Technical Debt & Recommended Follow-ups

1. Consider extracting session state/storage helpers if future feature work keeps growing `PlayerApp`.
2. Dedupe Vite/Worker YouTube API normalizers.
3. Consider TypeScript migration for the new core modules + contracts.
4. Evaluate `electron-builder` or Forge for desktop releases.
5. Improve native audio-router to be event-driven.

---

## How an Engineer Should Continue From Here

- Read `src/lib/presets.js` first; it is now the heart of the app DSP model.
- Continue Phase 3 by evaluating storage/session cleanup.
- Run `npm run lint`, `npm test`, and `npm run build` after each extraction slice.
- Keep `REFACTOR_PLAN.md` updated as the active checklist.

---

## Agent Notes (optional)

The current ESLint baseline passes cleanly. A temporary browser probe was used after the previous blank-page regression and confirmed the app renders locally after the singleton loader change.

---

**Refactoring in progress.** The codebase is in a better position for future development, and the Phase 2 monolith reduction target is complete.
