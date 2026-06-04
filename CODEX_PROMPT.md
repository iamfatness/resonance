# Codex / AI Coding Agent Prompt: Improve Resonance Architecture & Address Issues

**Target Repository**: https://github.com/iamfatness/resonance  
**Context**: This prompt is based on a thorough independent evaluation of the current codebase (as of June 2026 state). The agent should treat the evaluation findings as authoritative guidance on current problems.

**Important Supporting Files**:
- `REFACTOR_PLAN.md` — Detailed skeleton/ living plan. You **must** read this early, expand it, and keep it updated as your checklist.
- `REFACTOR_SUMMARY.md` (to be created by you at the end).

---

## Your Role
You are a senior software architect and refactoring expert. Your goal is to systematically improve the architecture, maintainability, and long-term evolvability of Resonance while **preserving all existing functionality**, the current UI/UX, the engine IPC contract, and the ability to run `npm run dev`, `npm run build`, the extension, and desktop flows.

You are methodical: explore first, plan, then execute in small verifiable steps.

---

## Project Overview (Resonance)

Resonance is a prototype **two-deck YouTube mixer** with mood-driven EQ guidance. Key parts:

- **Web app** (`src/main.jsx` + Vite): React 19 UI with YouTube iframes (Deck A/B), search, playlists, queue, likes, history, side panels, direct audio file/URL playback with real 8-band Web Audio EQ + instrument boosts, mood presets, and a desktop engine panel.
- **Chrome Extension** (`extension/`): MV3 extension using `tabCapture` + offscreen document to run the same style of EQ on the current tab.
- **Electron Desktop** (`electron/`, `engine/`): Clean separation — renderer talks via preload to main process, which manages a child `audio-engine.cjs` process. The engine manages settings persistence, device enumeration, and forwards to a native router when available.
- **Native Layer** (`native/`): Two small C++ tools (CMake):
  - `wasapi-meter`: Device enumeration + metering.
  - `audio-router`: Persistent WASAPI render server (stdio JSON protocol) supporting WAV, pushed PCM, bounded/continuous capture/loopback, per-deck gain/pan/EQ, peaks, and snapshots.
- **Backend**: Vite dev middleware + Cloudflare Worker (`src/worker.js`) that proxy YouTube Data API calls (search + playlist import).
- **Long-term vision**: Windows virtual audio device (SysVAD-based driver) + full native plugin host (VST3/Waves) so real system/YouTube audio can be routed through the engine.

**Important invariants to preserve**:
- The desktop engine settings payload shape (see `defaultSettings` and `deckProcessing` in both `src/main.jsx` and `engine/audio-engine.cjs`).
- Per-deck processing model: `{ pan, eqBypassed, curve: number[8], pluginChain: [] }`.
- All current features (YouTube loading, queue, persistence in localStorage + engine settings, mood presets affecting mix + real EQ, direct audio EQ, desktop WAV/capture flows, meters, etc.).
- Cross-platform web + extension experience (desktop/native is intentionally Windows-heavy).

---

## Known Major Issues (from Evaluation — Address These)

### 1. Monolithic Code (Critical)
- `src/main.jsx` (~2176 lines): Contains ~20 top-level functions, 33 `useState` calls, 14 `useEffect` calls, custom hooks (`useYouTubePlayer`, `useLocalEq`, `useDesktopEngine`), all components (`VideoDeck`, `DesktopEnginePanel`, `LandingPage`, `PlayerApp`, `App`), state management, persistence logic, search, queue, EQ UI, visualizers, etc. One giant file.
- `src/styles.css` (~2282 lines): Everything in a single stylesheet (~199 rule blocks).
- Result: Extremely hard to maintain, high risk of regressions, difficult to add features.

### 2. Duplicated Logic (High)
- Mood presets (`moodPresets`), `instrumentBandWeights`, `applyInstrumentBoosts`, `effectiveCurve`, `bandFreqs`, `flatCurve`, and related math are duplicated (or nearly duplicated) across:
  - `src/main.jsx`
  - `extension/popup.js`
  - `extension/offscreen.js`
- YouTube search/playlist normalization + metadata enrichment logic is almost identical in `vite.config.js` (Node middleware) and `src/worker.js` (Cloudflare Worker).
- `defaultDeckProcessing` / `deckProcessing` shape + normalization logic exists in multiple places.

**Target**: Single source of truth for presets, bands, DSP helpers, and the `DeckProcessing` / engine settings contract. The extension can either import a shared module (if a build step is added) or receive a tiny generated/copied version.

### 3. Fragile / Risky Code
- **YouTube player hook** (`useYouTubePlayer` around line 297): 
  - Dynamically injects the YT iframe API script inside the hook.
  - Overrides the global `window.onYouTubeIframeAPIReady` (with previous callback chaining).
  - Hook is called twice (once per deck) → race conditions on first load.
  - Initial player creation and later `loadVideoById` are split across effects.
- **Direct audio / local EQ** (`useLocalEq`):
  - Visualizer raf loop and AudioContext lifecycle tied only to an `enabled` boolean + refs.
  - Risk of leaked `requestAnimationFrame` loops, unclosed AudioContexts, or multiple graphs when switching sources.
- **PlayerApp state** (starting ~line 1076):
  - 20+ top-level `useState` for decks, queries, results, queue, history, likes, volumes, curves, boosts, panels, etc.
  - One massive `useEffect` that persists almost the entire world on any change (deps list is long).
  - Derived values (effectiveCurve, desktopEngineSettings, processedCurve) are recomputed in the render body.
- **Native render loop** (in `native/audio-router/main.cpp`):
  - Main render `while(true)` holds `std::lock_guard` across full buffer mixing (deque pops, WAV interpolation, EQ, pan, peaks, write).
  - Uses padding polling + Sleep rather than event-driven WASAPI.
  - Acceptable for prototype, but needs clearer boundaries for future work.

### 4. Missing Foundations
- **No tests** of any kind.
- **No linting or formatting** (no ESLint, Prettier).
- **No TypeScript** (pure JS/JSX) — painful for contracts between UI ↔ engine ↔ native.
- `package.json` is extremely minimal:
  - No `version`, `name` (meaningful), `description`, `license`, `repository`, `author`, etc.
  - Dependencies pinned to `"latest"` (bad practice).
- **No LICENSE** file in the repo.
- **No CI** (no `.github/workflows`).
- Desktop packaging (`scripts/package-desktop-local.ps1`) is a manual copy/rename hack (fragile).
- Many scripts and paths are PowerShell + hardcoded Windows (acceptable for native/driver, but dev experience suffers).

### 5. Architecture & Contracts
- The `deckProcessing` + full engine settings shape is the key cross-layer contract but is not defined in one canonical place with documentation.
- UI state, DSP model, and platform adapters (web audio vs desktop engine vs extension) are mixed together.
- Extension largely reimplements preset/EQ logic instead of sharing.
- Persistence (localStorage + engine JSON) and desktop readiness diagnostics are scattered.
- Good process separation already exists (renderer → engine process → native router); we should strengthen the model layer around it rather than flatten everything.

---

## Objectives & Success Criteria

After your work the codebase should be **noticeably easier to understand and extend** while remaining a lean prototype.

**Must achieve**:
1. `src/main.jsx` is dramatically smaller and focused (thin root + composition of focused components/hooks). Target: well under 800 lines for the main orchestration file if possible.
2. All preset, band, curve, and boost logic lives in **one** reusable, well-documented module (e.g. `src/lib/presets.js` or `src/core/presets.js`).
3. The two YouTube decks load reliably with no global callback races.
4. `useLocalEq` (or equivalent) has solid lifecycle management (no leaks on source changes or unmount).
5. A canonical definition (with JSDoc or types) of the core data shapes:
   - `MoodPreset`
   - `DeckProcessing`
   - `EngineSettings` / desktop payload
   - Band definitions
6. Basic quality infrastructure in place:
   - LICENSE file (MIT recommended).
   - Proper `package.json` metadata + replace `"latest"` with sensible `^` ranges.
   - ESLint + Prettier configured and runnable via `npm run lint` / `npm run format`.
   - Vitest (or equivalent) set up with at least 5–8 meaningful tests covering extracted DSP/preset/queue/normalizer logic.
   - Starter GitHub Actions workflow (`.github/workflows/ci.yml`) that runs install + lint + build on push/PR (Node matrix).
7. `npm run build` and `npm run dev` still work perfectly. Key user flows (load YT videos, direct audio EQ, mood changes, queue, desktop panel if on Windows) continue to function.
8. README and relevant `docs/*.md` files are lightly updated to reflect the new module structure where it affects developers.

**Nice to have (do if time / low risk)**:
- Introduce a small `useReducer` or custom hook for the "session" state (decks + queue + history + likes + active panels) to reduce the giant effect and number of individual states.
- Clearer `shared/` or `core/` folder for contracts that the engine and future native/plugin code can reference.
- JSDoc or a simple `.d.ts` for the preload/engine IPC messages.
- Minor robustness improvements in the native side (document the locking situation and suggest next steps in comments).

**Do NOT**:
- Introduce large new runtime dependencies (Zustand is acceptable if it clearly simplifies things; Redux is overkill).
- Change the engine IPC protocol or preload surface in a breaking way.
- Rewrite the C++ native code from scratch (focus on interfaces, comments, and small cleanups if any).
- Make the web app require a build step for the extension (keep the extension runnable as an unpacked folder of source files; a simple copy step in the extension packager is ok).
- Over-abstract for a prototype (keep things pragmatic).

---

## Mandatory Working Process (Follow This Order)

1. **Exploration Phase** (do this thoroughly)
   - Start by listing the directory structure.
   - Read key files: `README.md`, `package.json`, `src/main.jsx` (at least the top 150 lines + PlayerApp + the two custom hooks), `src/worker.js`, `vite.config.js`, `engine/audio-engine.cjs`, `electron/preload.cjs`, `extension/offscreen.js`, `extension/popup.js`, relevant docs.
   - Use grep/search to map:
     - All definitions and uses of `moodPresets`, `instrumentBandWeights`, `applyInstrumentBoosts`, `deckProcessing`, `bandFreqs`.
     - The YouTube player initialization and YT global handling.
     - How `desktopEngineSettings` is built and sent.
     - Storage keys and persistence paths.
     - All places that import or reference presets/EQ math.
   - Understand the data flow for a mood preset change end-to-end (UI → effective curve → volumes for YT + curve sent to desktop engine + applied in extension).
   - Note current component tree and hook responsibilities.

2. **Planning Phase**
   - Internally create a todo list (or explicit plan document).
   - Propose a target directory structure (e.g. `src/components/`, `src/hooks/`, `src/lib/`, `src/state/`, possibly `shared/` at root).
   - Decide on the shape of the extracted preset/DSP module (pure functions, no React, no side effects).
   - Decide how the extension will consume the shared logic (copy during `package:extension`, or a tiny build step).
   - Decide on state management approach for the big PlayerApp (recommend a pragmatic path).
   - Identify the smallest slices that can be done incrementally with running verification after each.
   - Document any contract decisions (e.g. exact exported API of the new preset module).
   - Present the plan clearly before making large edits.
- Use the provided `REFACTOR_PLAN.md` skeleton as your living plan document. Read it early, expand the phases and checkboxes during your Planning Phase, keep it updated with status, and use it as your checklist. At the end you must also produce `REFACTOR_SUMMARY.md`.

3. **Execution Phase — Incremental & Verifiable**
   - Work in small, logical steps. After each significant change, run `npm run build` (and `npm run dev` smoke if possible) and relevant scripts.
   - Use precise edits (search/replace style) rather than wholesale rewrites when possible.
   - Add tests for logic as you extract it.
   - Update call sites and fix any breakage immediately.
   - Keep the visual design, icons, and all current behaviors identical.
   - For the native layer, add clear comments around the render loop and locking if you touch the area.
   - After major phases, update the top-level README with any new folder explanations or "Architecture" section if helpful.

4. **Verification & Documentation**
   - At the end, run the full build, extension packager, and (on Windows) any desktop-related scripts that don't require WDK.
   - Manually verify (or describe how to verify) the main flows still work.
   - Update `README.md` and `docs/` files that describe development or architecture.
   - Leave a clear `REFACTOR_SUMMARY.md` or final section describing what was changed, why, and recommended follow-ups (e.g. "Next: adopt TypeScript for the contracts", "Consider event-driven WASAPI", "electron-builder evaluation", etc.).

5. **Style & Quality**
   - Add or improve JSDoc on public functions in the new shared modules.
   - Keep the codebase pragmatic and prototype-friendly — avoid premature abstraction.
   - Make sure error handling and the existing "ignore private mode storage failures" style of resilience is preserved.

---

## Suggested High-Level Phases (You May Adjust Order Slightly)

**Phase 0 — Hygiene (low risk, high value)**
- Add LICENSE (MIT).
- Flesh out `package.json` (version, description, license, repository, engines, etc.).
- Replace `"latest"` strings with proper ranges based on current lockfile + latest stable.
- Add ESLint (React + modern) + Prettier config + `lint` and `format` scripts.
- Create `.github/workflows/ci.yml` (basic: Node 20/22, `npm ci`, lint, build).

**Phase 1 — Extract Core Models**
- Create `src/lib/presets.js` (or `src/core/presets.js`) containing:
  - `bandFreqs`, `bands` (labels), `flatCurve`
  - Full `moodPresets` definition (move icons if needed or keep them in a UI layer)
  - `instrumentBandWeights`
  - `applyInstrumentBoosts(baseCurve, boosts)`
  - `effectiveCurve(presetName, useManual, manualCurve, instrumentBoosts)`
  - Helpers like `clampGain`, `getPreset(name)`
  - The `DeckProcessing` shape + `normalizeDeckProcessing`
- Update `src/main.jsx`, extension files, and engine (if possible) or at least document the canonical shape.
- Make the extension packager copy the new module (or keep a tiny duplicate for now and note the plan).

**Phase 2 — Modularize the UI**
- Create `src/components/`, `src/hooks/`.
- Extract `VideoDeck`, `DesktopEnginePanel`, landing pieces, EQ controls, queue items, search results, side panels, etc.
- Extract the three custom hooks into their own files.
- Reduce `PlayerApp` / `App` to orchestration + the big state + derived values.
- Split or modularize the giant CSS (at minimum into logical sections or co-located styles if using a simple approach).

**Phase 3 — Fix Fragile Spots**
- Robust YouTube IFrame API loading (single load, proper ready promise or singleton, safe multi-deck usage).
- Improve `useLocalEq` lifecycle: proper `AudioContext.close()`, cancel raf on disable/unmount/source change, clearer ownership of the graph.
- Consider a reducer or well-factored custom hook for the large session state to simplify the giant persistence effect.

**Phase 4 — Quality & Contracts**
- Add Vitest + a handful of tests for the new `lib/presets.js` (curve math, preset application, normalization) and any queue or YouTube normalizer helpers.
- Add JSDoc or a `src/types.js` / `shared/contracts.js` that defines the key interfaces (DeckProcessing, EngineSettings, etc.).
- Clean up duplication in the YouTube proxy code if easy (or clearly document why it's duplicated).
- Add comments in the C++ around the current locking and polling strategy + suggested future improvements.

**Phase 5 — Packaging & Docs**
- Review the desktop packaging script; leave a note or small improvement if obvious.
- Update README with new structure ("Key folders", "Development", "Architecture notes").
- Update relevant `docs/` files if they reference file locations.

---

## Final Deliverables Expected From You

- A cleaner, more maintainable codebase.
- A `REFACTOR_PLAN.md` (or equivalent in your process) + final `REFACTOR_SUMMARY.md` describing changes, decisions, and next steps.
- All tests and lint pass (`npm run build` succeeds, new lint script succeeds).
- No loss of functionality.
- Clear, small, reviewable changes (think like a good PR author).

---

## Starting Instructions

1. If the repository is not already checked out, clone it: `git clone https://github.com/iamfatness/resonance.git && cd resonance`.
2. Run `npm install` (the lockfile is present).
3. Begin with **Exploration Phase** — use tools (directory listing, reading files, searching) to confirm and expand on the issues listed above.
4. Create an internal todo list and share your exploration findings + high-level plan before making large structural edits.
5. Proceed incrementally, verifying builds frequently.

You have full permission to create new files and directories, edit existing ones, update scripts, and add configuration files as needed to achieve the objectives.

---

**Begin now.**

(End of prompt — copy everything above this line when giving it to the coding agent.)
