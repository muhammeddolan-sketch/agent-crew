---
name: crew
description: Cost-aware chief orchestration for a task (/crew <task>) with lazy on-demand named workers and SendMessage reuse, or status/rules summary when invoked without arguments (/crew). Use when the user types /crew.
argument-hint: "[task]"
---

# Crew Orchestrator

Check `$ARGUMENTS`:

## Mode A — Argumentless (`/crew`, when `$ARGUMENTS` is empty)

Do **not** spawn any subagents (`0` `Agent` calls). Present a concise summary in the **user's language**:

1. **Delegation threshold:** Small/single-step tasks stay with the chief directly; subagents are opened lazily only when warranted (broad scans, multi-file work, verification, browser/analytics/growth).
2. **Workers & `maxTurns`:**
   - `scout` (haiku, 15) · `coder` (sonnet, 25) · `senior` (opus, 30) · `tester` (sonnet, 20, read-only code) · `analyst` (sonnet, 25, strictly read-only) · `growth` (sonnet, 20) · `browser` (sonnet, 25, read-only code)
3. **Session state:** List any named workers already open in this conversation (or note none are open yet).
4. **Commands:** `/crew <task>` to orchestrate a task end-to-end; `/crew-verify [target]` to run independent `tester` verification on the current `git diff`.

---

## Mode B — Task Orchestration (`/crew <task>`, when `$ARGUMENTS` is non-empty)

### 1. Quick Discovery
- Run 1–2 targeted greps/globs yourself first.
- If the codebase scan is broad or output-heavy, lazily open `scout` (`subagent_type: "agent-crew:scout"`, `name: "scout"`) to map the relevant files and report back.

### 2. Plan
- Write a short, concrete execution plan: target files, step order, which worker handles each part, file-boundary split (if parallel), and what `tester` will verify.
- Check the project's `CLAUDE.md` (if present) for custom test/build commands or delegation overrides.

### 3. Lazy On-Demand Delegation
- **Never open workers upfront.** Spawn each needed worker only on its first task using `Agent` with `subagent_type: "agent-crew:<worker>"` and `name: "<worker>"`.
- **Reuse via `SendMessage`:** For follow-up tasks on the same role, call `SendMessage({ to: "<worker>", message: ... })` instead of spawning a new worker.
- **Self-contained briefs:** Every prompt/message must include the goal, full file paths, constraints, expected English short report format, and a clear "stop when done" criterion (respecting the worker's `maxTurns`).
- **Parallel strategy (default = file-boundary split):** Send independent tasks in parallel in one message, partitioned strictly by file boundary so two workers never edit the same file. Only use `isolation: "worktree"` as an optional fallback for large refactors with high file-collision risk. Run dependent steps sequentially.
- **Busy-worker fallback:** If a named worker is mid-task and an independent parallel task arrives for the same role, spawn a temporary unnamed agent of that `subagent_type`.

### 4. Independent Verification
- After behavior-changing or multi-file code changes, lazily spawn `tester` (`subagent_type: "agent-crew:tester"`, `name: "tester"`) or reuse it via `SendMessage({ to: "tester", message: ... })`.
- Have `tester` inspect the diff, run relevant tests/builds/checks read-only, and return `PASSED` / `FAILED` / `INCONCLUSIVE` with command and `file:line` evidence.
- For trivial single-line, comment, or config-only edits, verify directly with diff + command.

### 5. Summary & Hygiene
- Present the final result and verification evidence to the user in the **user's language**.
- Workers auto-compact around 100K tokens (`autoCompactWindow`); continue reusing open named workers with self-contained briefs. Suggest `/clear` when the topic finishes.
