# How to Use These Files (Prompt for Codex / AI Coding Agents)

Copy and paste the following block as the main instruction when starting a new agent session on this repository.

---

You have been given three specific files in the root of this repository. They form a complete system for structured refactoring work.

**Your files are:**
- `CODEX_PROMPT.md` (the main mission and rules)
- `REFACTOR_PLAN.md` (your living, active plan and checklist)
- `REFACTOR_SUMMARY.md` (the required final output template)

## Mandatory Instructions

1. **Read all three files immediately and in this order:**
   - First: `CODEX_PROMPT.md` — This is your **primary directive**. It defines your role, the project, the exact problems to solve, strict "Do NOT" rules, the required working process (Exploration → Planning → Execution → Verification), success criteria, and non-goals.
   - Second: `REFACTOR_PLAN.md` — Treat this as your **living plan**. 
     - Expand every section with concrete details.
     - Turn the high-level tasks into specific, ordered, actionable items (use `- [ ]` checkboxes).
     - Add new tasks as you discover them during exploration.
     - Keep this file updated in real time as you work (mark items complete, note decisions, risks, and status).
   - Third: `REFACTOR_SUMMARY.md` — This is the **exact template** you must fill out when your work is complete. Do not create your own summary format.

2. **Follow the process defined in CODEX_PROMPT.md exactly:**
   - **Exploration Phase first** (no large edits yet). Use directory listings, file reads, searches, and command execution to deeply understand the current state.
   - **Planning Phase**: Update `REFACTOR_PLAN.md` with your findings and a detailed, phased execution plan before writing significant code.
   - Only then move to **Execution**, working incrementally with frequent verification (`npm run build`, testing key flows, etc.).
   - At the very end, complete `REFACTOR_SUMMARY.md` following its structure.

3. **Key Rules (from CODEX_PROMPT.md — do not violate these)**
   - Preserve 100% of existing functionality and the current UI/UX.
   - Do not break the engine IPC contract or preload surface.
   - Keep changes pragmatic for a prototype — avoid over-abstraction.
   - Verify builds and core flows after every significant phase.
   - Update documentation (README and relevant docs/) where architecture changes.

4. **Working Style**
   - Think step-by-step in your reasoning.
   - Read files before editing them.
   - Make small, reviewable changes.
   - Use the `REFACTOR_PLAN.md` as your active checklist and status board.
   - When finished, the three files (especially the updated plan and the completed summary) should clearly document the entire effort.

## Starting Command

Begin right now by:
1. Reading `CODEX_PROMPT.md`, `REFACTOR_PLAN.md`, and `REFACTOR_SUMMARY.md`.
2. Performing a thorough Exploration Phase.
3. Expanding and initializing `REFACTOR_PLAN.md` with your plan.

Do not make any structural code changes until you have completed the above and stated in your reasoning that you are ready to begin Phase 0 / Execution.

---

**End of instructions for the agent.**

You may now begin.