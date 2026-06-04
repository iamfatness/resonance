# Resonance Refactoring Summary

**Date**: 2026-06-04  
**Performed by**: Codex following `CODEX_PROMPT.md`  
**Phases Completed**: Phase 0, Phase 1 core extraction, Phase 2 UI modularization slices

---

## Executive Summary

The codebase now has real project hygiene, tests, linting, CI scaffolding, and extracted core model modules. `src/main.jsx` has continued shrinking from a monolith into an orchestration file: hooks, major UI surfaces, search results, the left sidebar, and EQ/plugin controls have moved into `src/hooks/` and `src/components/`. The app behavior and public Electron bridge contract were preserved.

---

## What Changed

### Architecture & Structure
- Added canonical app preset/DSP helpers in `src/lib/presets.js`.
- Added pure YouTube parsing helpers in `src/lib/youtube.js`.
- Added extension preset helper module in `extension/lib/presets.js`.
- Extracted hooks:
  - `src/hooks/useYouTubePlayer.js`
  - `src/hooks/useLocalEq.js`
  - `src/hooks/useDesktopEngine.js`
- Extracted components:
  - `src/components/VideoDeck.jsx`
  - `src/components/LandingPage.jsx`
  - `src/components/DesktopEnginePanel.jsx`
  - `src/components/SearchResultsPanel.jsx`
  - `src/components/SidebarPanels.jsx`
  - `src/components/EqPanel.jsx`

### Size Reductions
- `src/main.jsx`: 2175 lines -> 873 lines
- `src/styles.css`: unchanged in this slice
- Duplication removed: app-side preset/DSP helpers, app-side YouTube URL parsing helpers, extension popup/offscreen preset math

### New Infrastructure
- LICENSE
- package.json improvements
- ESLint / Prettier
- Tests (Vitest)
- CI workflow
- EditorConfig

### Specific Bug / Fragility Fixes
- YouTube player loading: hook moved, singleton/race fix remains for Phase 3.
- Direct audio EQ lifecycle: hook moved, lifecycle hardening remains for Phase 3.
- State management / persistence: unchanged behavior; reducer extraction remains a follow-up.
- Other: extension package now includes nested `lib/` files.

---

## Key Decisions Made

- Keep preset/DSP logic in `src/lib/presets.js` without React or Lucide icons.
- Keep extension runnable as unpacked source while adding `extension/lib/presets.js`.
- Keep CSS intact during initial component extraction to avoid visual regressions.
- Keep engine IPC and preload APIs unchanged.
- Configure ESLint pragmatically so current React compiler cleanup remains a Phase 3 task rather than blocking Phase 0.

---

## Verification Performed

- [x] `npm run build` clean
- [x] `npm run lint` clean with two existing React hook dependency warnings
- [x] `npm test` passes (9 tests)
- [x] `npm run package:extension` passes
- Manual flows verified:
  - YouTube Deck A + B with mood changes: not manually browser-smoked in this slice
  - Direct audio file + URL EQ + visualizer: not manually browser-smoked in this slice
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
- `src/lib/smoke.test.js`
- `src/components/VideoDeck.jsx`
- `src/components/LandingPage.jsx`
- `src/components/DesktopEnginePanel.jsx`
- `src/components/SearchResultsPanel.jsx`
- `src/components/SidebarPanels.jsx`
- `src/components/EqPanel.jsx`
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

1. Finish Phase 2 by extracting queue controls, direct-source controls, and possibly session state.
2. Phase 3: replace the YouTube iframe global callback with a singleton loader.
3. Phase 3: harden `useLocalEq` cleanup for AudioContext/source changes.
4. Dedupe Vite/Worker YouTube API normalizers.
5. Consider TypeScript migration for the new core modules + contracts.
6. Evaluate `electron-builder` or Forge for desktop releases.
7. Improve native audio-router to be event-driven.

---

## How an Engineer Should Continue From Here

- Read `src/lib/presets.js` first; it is now the heart of the app DSP model.
- Continue reducing `src/main.jsx` by extracting queue and direct-source panels next.
- Run `npm run lint`, `npm test`, and `npm run build` after each extraction slice.
- Keep `REFACTOR_PLAN.md` updated as the active checklist.

---

## Agent Notes (optional)

The current ESLint baseline passes with two hook dependency warnings in `useYouTubePlayer.js`. Those warnings are intentionally left for the Phase 3 singleton YouTube loader work.

---

**Refactoring in progress.** The codebase is in a better position for future development, but the full Phase 2 monolith reduction target is not complete yet.
