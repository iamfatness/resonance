# Resonance Refactoring Plan (Skeleton for Codex / AI Agents)

**Status**: Skeleton / Starting Template  
**Owner**: [AI Agent following CODEX_PROMPT.md]  
**Last Updated**: [Fill on use]  
**Related**: See `CODEX_PROMPT.md` for full context, evaluation findings, and strict rules.

This document is the **living plan**. The agent must:
1. Read this file at the start of work.
2. Expand and detail each section during the **Planning Phase**.
3. Use it as a checklist (convert items to `- [ ]` tasks).
4. Update status as work progresses.
5. At the end, produce a companion `REFACTOR_SUMMARY.md`.

**Strict Rule**: Do not start large-scale edits until this plan is reviewed/approved in your thinking and a clear "Ready to Execute Phase X" message is given.

---

## 1. Goals & Non-Goals

### Primary Goals
- Dramatically improve maintainability by breaking the monolith (`src/main.jsx` + `src/styles.css`).
- Eliminate duplication of presets, DSP math, and core data shapes.
- Make the YouTube player initialization and direct-audio EQ lifecycle robust.
- Establish a single source of truth for audio processing contracts (`DeckProcessing`, presets, curves).
- Add minimal but real quality infrastructure (lint, tests, CI skeleton, LICENSE, proper package metadata).
- Keep the existing process boundaries (web → Electron main → `engine/` → native) and IPC contract 100% stable.
- Preserve every current user-facing feature and the exact current look & feel.

### Success Metrics (Measurable)
- `src/main.jsx` reduced to < 800 lines focused on orchestration (ideally ~500-600).
- One canonical `src/lib/presets.js` (or `src/core/`) module used by web app + extension.
- `npm run lint` and `npm run test` scripts exist and pass.
- At least 6-8 unit tests covering extracted logic (presets, curve application, normalizers, queue helpers).
- `.github/workflows/ci.yml` runs clean on push/PR.
- `npm run build` succeeds with no regressions.
- All major flows (YT decks, direct audio EQ + visualizer, mood changes, queue, desktop engine panel) continue to work identically.
- Updated README + relevant docs reflecting new structure.

### Non-Goals / Explicit Out of Scope (for this effort)
- Full TypeScript migration (JSDoc + small `.d.ts` for contracts is acceptable and encouraged).
- Rewriting the C++ native layer.
- Introducing heavy state management libraries unless they clearly simplify the giant `PlayerApp` (Zustand is borderline OK; anything larger is not).
- Changing the desktop packaging script architecture significantly.
- Adding plugin hosting or driver improvements.
- Cross-platform native audio (keep Windows focus for desktop features).
- Performance optimizations in the audio loop beyond documentation + small comments.

---

## 2. Current State Summary (Key Facts)

**Monoliths**
- `src/main.jsx`: 2176 lines, ~20 top-level functions, 33 `useState`, 14 `useEffect`. Contains hooks, all UI components, business logic, persistence, and desktop bridge.
- `src/styles.css`: 2282 lines, ~199 rule blocks.

**Duplication Hotspots**
- `moodPresets`, `instrumentBandWeights`, `applyInstrumentBoosts`, `effectiveCurve`, `bandFreqs`, `flatCurve`, `clampGain`.
- Locations: `src/main.jsx`, `extension/popup.js`, `extension/offscreen.js`.
- YouTube normalizers + metadata fetch in `vite.config.js` and `src/worker.js`.
- `defaultDeckProcessing` / normalization logic scattered.

**Fragile Areas (Must Fix)**
- `useYouTubePlayer` (global YT script + `onYouTubeIframeAPIReady` override inside per-deck hook).
- `useLocalEq` (AudioContext + raf visualizer lifecycle tied to `enabled` ref).
- Giant `PlayerApp` state + one massive persistence `useEffect` (lines ~1076–1190 area).
- Native render loop in `native/audio-router/main.cpp` holds mutex across full mix (acceptable for now but needs comments + future path).

**Missing Foundations**
- No `LICENSE`.
- `package.json` has only scripts + `"main"` + `"latest"` deps.
- No ESLint/Prettier.
- No tests.
- No CI.
- Core contracts (`DeckProcessing`, engine settings payload) not defined in one place.

**Good Existing Things to Protect**
- Process separation (renderer ↔ engine process ↔ native router).
- Preload bridge surface.
- localStorage + `engine-settings.json` persistence model.
- Fallbacks and diagnostics in desktop engine.
- Detailed `docs/*.md` files.

**Key Data Shapes (to canonicalize)**
- `DeckProcessing`: `{ pan: number, eqBypassed: boolean, curve: number[8], pluginChain: any[] }`
- Full engine settings (see `defaultSettings` in `engine/audio-engine.cjs:17` and mirrored in UI).
- `moodPresets` entries include `curve`, `instruments`, `mix`, `intent`, `icon`.
- `bandFreqs = [31, 62, 125, 250, 500, 1000, 2000, 4000]`

---

## 3. Target Architecture

### Proposed High-Level Directory Structure (after Phase 2)

```
resonance-repo/
├── src/
│   ├── main.jsx                 # Thin root + App + PlayerApp orchestration only
│   ├── App.jsx                  # (optional) routing between landing/app
│   ├── components/
│   │   ├── VideoDeck.jsx
│   │   ├── DesktopEnginePanel.jsx
│   │   ├── EQPanel.jsx
│   │   ├── QueueList.jsx
│   │   ├── SearchResults.jsx
│   │   ├── SidePanel.jsx
│   │   ├── MoodPresetButton.jsx
│   │   └── ...
│   ├── hooks/
│   │   ├── useYouTubePlayer.js
│   │   ├── useLocalEq.js
│   │   ├── useDesktopEngine.js
│   │   └── useSessionState.js   # (recommended reducer or well-factored state)
│   ├── lib/
│   │   ├── presets.js           # ← SINGLE SOURCE OF TRUTH (big win)
│   │   ├── youtube.js           # parsers, normalizers, url helpers
│   │   ├── storage.js
│   │   └── audio.js             # (if needed) generic DSP helpers
│   └── styles/                  # (or keep flat for now)
│       └── main.css
├── shared/                      # (optional but recommended)
│   └── contracts.js             # or .d.ts – DeckProcessing, EngineSettings, etc.
├── engine/                      # (unchanged structure, but can reference shared)
├── extension/                   # Keep simple; packager will copy needed lib files
├── docs/
├── scripts/
├── .github/workflows/
│   └── ci.yml
├── REFACTOR_PLAN.md
├── REFACTOR_SUMMARY.md
└── package.json (enriched)
```

### Module Responsibilities
- `src/lib/presets.js`: Pure. Exports bands, moodPresets (without React icons if possible, or separate metadata), `applyInstrumentBoosts`, `getEffectiveCurve`, `normalizeDeckProcessing`, `getDefaultDeckProcessing`, etc.
- UI components: Presentational + minimal local state.
- Hooks: Side effects + integration with platform (YT API, Web Audio, desktop bridge).
- `shared/contracts.js` (or JSDoc in presets): The single definition of shapes passed to the desktop engine.

### Extension Consumption Strategy
Option A (preferred for prototype): Extension packager script (`scripts/package-extension.ps1`) copies `src/lib/presets.js` into the zip as `lib/presets.js` and updates the three extension files to import from it.
Option B: Keep a tiny sync'd copy in `extension/lib/` for now + comment "synced from src/lib/presets.js".

---

## 4. Detailed Phased Plan

### Phase 0: Hygiene, Licensing, Tooling & CI (Low Risk, High Value)
**Goal**: Make the project feel like a real open-source prototype.

Tasks:
- [ ] Add `LICENSE` file (MIT).
- [ ] Enrich `package.json`: add `version` (start with "0.2.0" or keep 0.1.0), `name`, `description`, `license`, `repository`, `bugs`, `homepage`, `keywords`, `engines`.
- [ ] Replace all `"latest"` in dependencies with concrete ranges taken from current `package-lock.json` (or latest stable compatible).
- [ ] Add ESLint + Prettier:
  - Config for React 19 + modern JS/JSX.
  - Scripts: `"lint"`, `"lint:fix"`, `"format"`, `"format:check"`.
- [ ] Create `.github/workflows/ci.yml` (Node 20 + 22 matrix, `npm ci`, lint, build, test).
- [ ] Add basic `.editorconfig` and update `.gitignore` if needed.
- [ ] Run `npm run build` after every change in this phase.

**Files Touched**: `package.json`, new `LICENSE`, new `.github/workflows/ci.yml`, new eslint/prettier configs, `scripts/package-extension.ps1` (minor).

**Verification**:
- `npm run lint` passes (after fixes).
- `npm run build` succeeds.
- CI would pass if pushed.

**Owner / Status**: [ ]

### Phase 1: Extract Canonical Core Models (Highest Leverage)
**Goal**: One place for all preset / curve / deck processing logic.

Tasks:
- [ ] Create `src/lib/presets.js` (or `src/core/presets.js`).
  - Move `bandFreqs`, `bands`, `flatCurve`.
  - Move full `moodPresets` definition (decide how to handle `icon` components — probably export a separate `presetMeta` or keep icons in a UI-only map).
  - Move `instrumentBandWeights`.
  - Move + clean `applyInstrumentBoosts`, `clampGain`, `effectiveCurve` logic.
  - Export `getDefaultDeckProcessing()`, `normalizeDeckProcessing(saved)`.
  - Export helpers used by engine settings building.
- [ ] Update `src/main.jsx` to import from the new module (delete old definitions).
- [ ] Update `extension/offscreen.js` and `extension/popup.js` (either via copy in packager or direct relative after copy step).
- [ ] Update the extension packager script to include the shared file.
- [ ] (Optional but recommended) Create `shared/contracts.js` with JSDoc defining:
  - `DeckProcessing`
  - `EngineSettings`
  - `MoodPreset`
- [ ] Add unit tests in `src/lib/presets.test.js` (Vitest):
  - `applyInstrumentBoosts` correctness for several presets + boosts.
  - `normalizeDeckProcessing` round-trips and defaults.
  - `getEffectiveCurve` for manual vs preset + boosts.
- [ ] Ensure engine side (`engine/audio-engine.cjs`) at least documents that the canonical shape lives in `src/lib/presets.js`.

**Key Decision Point**: How icons are handled in the pure module.

**Files Touched**: New `src/lib/presets.js`, tests, 3–4 call sites, packager script.

**Verification**:
- Mood presets still work exactly the same in web + extension.
- `npm test` (new script) passes.
- `npm run build` passes.

**Owner / Status**: [ ]

### Phase 2: Break the Monolith – UI Modularization
**Goal**: `src/main.jsx` becomes small and readable.

Tasks:
- [ ] Create `src/components/` and move/extract:
  - `VideoDeck.jsx`
  - `DesktopEnginePanel.jsx` (this one is large – split internal parts if needed)
  - EQ controls, instrument boost UI, queue items, search result cards, side panels, landing page sections, etc.
- [ ] Create `src/hooks/` and extract the three custom hooks into individual files (keep them as `.js` for now).
- [ ] Introduce `useSessionState.js` (or equivalent) that encapsulates the big state + the giant persistence effect using `useReducer` + a few targeted `useEffect`s. This is the recommended path to tame PlayerApp.
- [ ] Split or logically section `src/styles.css` (create `src/styles/` folder or keep one file but add clear `/* === Section === */` comments + extract component-specific classes where obvious).
- [ ] Refactor `PlayerApp` and `App` to be thin orchestrators that compose the new pieces.
- [ ] Update all internal imports.

**Target Size**: `src/main.jsx` + `App.jsx`/`PlayerApp.jsx` together should feel like < 700 lines of "glue".

**Files Touched**: Many new files under `src/components/` and `src/hooks/`, reduced `src/main.jsx`, styles.

**Verification**:
- All UI still looks and behaves identically.
- No new console errors.
- `npm run build` succeeds.

**Owner / Status**: [ ]

### Phase 3: Fix Fragile Areas
**Goal**: Eliminate the known sources of races and leaks.

Sub-tasks:
- [ ] **YouTube Player**:
  - Move YT API loading to a singleton module or top-level effect in `App`.
  - Provide a clean `useYouTubePlayer` that receives a ready promise or uses a context.
  - Ensure two decks never fight over the global callback.
  - Test manually with rapid deck switches and page reloads.
- [ ] **useLocalEq / Direct Audio**:
  - Proper `AudioContext` ownership and `close()` on source change / disable / unmount.
  - Cancel animation frame reliably.
  - Consider extracting the visualizer into its own small hook/component.
- [ ] **State & Persistence**:
  - If `useSessionState` reducer was introduced in Phase 2, ensure the persistence effect is now much smaller and only reacts to a serializable slice.
  - Keep the "ignore storage failures" resilience comment/behavior.

**Files Touched**: The new hook files + any components that use them.

**Verification**:
- Load two different YouTube videos quickly; both should play correctly.
- Switch direct audio files multiple times; no leaked contexts or duplicate visualizers.
- Refresh the app; state restores correctly.

**Owner / Status**: [ ]

### Phase 4: Quality Infrastructure & Contracts
**Goal**: Make future work safer.

Tasks:
- [ ] Finish Vitest setup if not done in Phase 1 (`vite.config` test setup, `npm test` script).
- [ ] Add 2–4 more tests (queue operations, YouTube id/playlist parsers, desktop settings builder).
- [ ] Add JSDoc to all exported functions in `lib/presets.js` and the new hooks.
- [ ] Create or flesh out `shared/contracts.js` (or keep everything in JSDoc in presets for minimalism).
- [ ] Add comments in `native/audio-router/main.cpp` around the current lock scope and polling strategy, plus a "Future improvements" note.
- [ ] Update `engine/audio-engine.cjs` and `engine/audio-router.cjs` with references to the new canonical preset/curve module (even if just comments + import where possible).

**Owner / Status**: [ ]

### Phase 5: Documentation, Packaging Polish & Summary
Tasks:
- [ ] Update `README.md`:
  - New "Project Structure" section.
  - Mention `npm run lint`, `npm run test`.
  - Note that presets live in `src/lib/presets.js`.
- [ ] Lightly update `docs/desktop-app.md`, `docs/audio-engine.md`, `docs/plugin-hosting.md` if any file paths or concepts changed.
- [ ] Minor polish on the desktop packaging script if obvious improvements appear during work (document them).
- [ ] Create `REFACTOR_SUMMARY.md` (see template at bottom of this file).
- [ ] Final full verification pass.

**Owner / Status**: [ ]

---

## 5. Key Contracts to Define (Put These in Code + This Plan)

Define once, use everywhere:

```js
// Example shape (flesh out in shared/contracts.js or JSDoc)
export type DeckProcessing = {
  pan: number;           // -12 to +12 or similar
  eqBypassed: boolean;
  curve: number[];       // length 8
  pluginChain: any[];    // future
};

export type MoodPresetName = 'Focus' | 'Lift' | 'Warmth' | 'Drive' | 'Night';

export type MoodPreset = {
  curve: number[];
  instruments: Record<string, number>;
  mix?: { A: number; B: number };
  intent?: string;
  // icon handled at UI layer
};
```

Also document the exact shape sent to the desktop engine (`desktopEngineSettings`).

---

## 6. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|----------|
| Breaking YouTube playback during player hook refactor | Medium | Do the YT singleton change in a small isolated branch/step; test heavily with real videos. |
| Extension stops working after preset extraction | Low | Update packager script early; test `npm run package:extension` and load unpacked. |
| State refactor introduces persistence bugs | Medium | Keep the old giant effect temporarily behind a flag, or write a test that round-trips the full saved state object. |
| CSS split makes styles disappear | Low | Do styles last or incrementally; use build verification + visual diff if possible. |
| Agent over-abstracts | High | Re-read "Non-Goals" and "Do NOT" sections in CODEX_PROMPT.md frequently. |

---

## 7. Verification Checklist (Run at End of Major Phases)

- [ ] `npm run build` succeeds and `dist/` looks reasonable.
- [ ] `npm run lint` (once added) passes.
- [ ] `npm test` (once added) passes.
- [ ] Manual flows:
  - Load YT video into A, another into B, change moods, adjust volumes/pan/EQ.
  - Load a local audio file or URL, enable direct EQ, change presets/boosts, watch visualizer.
  - Use queue, likes, history, side panels.
  - (Windows) Run desktop, open engine panel, load WAV or start capture, see meters.
- [ ] Extension: `npm run package:extension`, load unpacked, start capture on a YouTube tab, apply moods.
- [ ] Refresh browser → state restores (decks, queue, curves, etc.).
- [ ] No new console errors/warnings in web or extension.

---

## 8. Open Decisions / Questions (Resolve During Planning)

- Exact location: `src/lib/` vs `src/core/` vs `shared/`?
- How to handle React icons inside the pure presets module?
- Do we introduce a `useReducer` for session state in Phase 2 or keep `useState` and just extract hooks first?
- Level of CSS modularization in this pass (full split vs logical sections + comments)?
- Should we touch the native C++ at all beyond comments?

---

## 9. Post-Refactor Recommended Next Steps (for the SUMMARY)

- Evaluate adopting TypeScript for the contracts + new modules.
- Consider `electron-builder` for real desktop releases.
- Event-driven WASAPI improvements in the router (documented in plan).
- Better sharing story for extension (esbuild/rollup step to produce a small bundle both web and extension can use).
- More tests, especially around desktop engine IPC simulation.

---

## Appendix: How to Use This Plan as an Agent

1. At the very beginning, read `CODEX_PROMPT.md` completely.
2. Read this `REFACTOR_PLAN.md`.
3. In the **Planning Phase**, expand every `[ ]` into concrete sub-tasks with file names and order.
4. Add new sections if you discover important things during exploration.
5. After each phase, update the status line at the top and mark completed items.
6. When done, fill in `REFACTOR_SUMMARY.md` using the structure below.

---

## Template for REFACTOR_SUMMARY.md (Create this at the end)

```markdown
# Resonance Refactoring Summary

**Date**: ...
**Agent**: ...
**Phases Completed**: 0–5 (or list what was actually done)

## What Changed
- High-level summary + before/after sizes (main.jsx lines, etc.)

## Key Decisions Made
- ...

## Verification Performed
- ...

## Remaining Technical Debt / Follow-ups
- ...

## Files Changed (high level)
- ...

## How to Continue
...
```

---

**End of Skeleton**

This file is intentionally a **skeleton**. The Codex agent is expected to turn the checkboxes into a living, detailed task list and keep it updated throughout the work.

Next action for the agent: Begin the **Exploration Phase** as described in `CODEX_PROMPT.md`, then come back here and flesh out the "Detailed Phased Plan" section with concrete, ordered steps.
