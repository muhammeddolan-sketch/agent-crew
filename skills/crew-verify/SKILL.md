---
name: crew-verify
description: Runs an independent read-only tester worker against the current git diff (or specified target) and returns a PASSED / FAILED / INCONCLUSIVE report with command and file:line evidence. Use when the user types /crew-verify.
argument-hint: "[target or focus]"
---

# Crew Verify

Independently verify current changes without modifying product code:

1. **Pre-check (chief):**
   - Run `git status --short` and `git diff --stat` (plus check `$ARGUMENTS` if the user specified files, a commit/branch diff, or a behavior focus).
   - If both the working tree and staged index are clean and `$ARGUMENTS` does not name a target, tell the user there are no pending changes to verify (0 subagents spawned).

2. **Lazy `tester` spawn/reuse:**
   - If `tester` is not yet open in this session, spawn it with `Agent({ subagent_type: "agent-crew:tester", name: "tester", prompt: ... })`.
   - If `tester` is already open, reuse it via `SendMessage({ to: "tester", message: ... })`.

3. **Verification brief:**
   Give `tester` a self-contained English brief containing:
   - What changed (changed files from `git status`/`git diff --stat`, plus any user goal or `$ARGUMENTS` focus).
   - Instructions to read the full diff (`git diff` / `git diff --cached` / target files), check `CLAUDE.md` (if present) for project test/typecheck/build commands, run relevant verification commands, check edge cases, and report any missing test coverage as a gap without editing files (`Write`/`Edit` are disabled).
   - Expected report format: `PASSED` / `FAILED` / `INCONCLUSIVE`, exact commands and output lines, `file:line` error locations, and any untested areas.

4. **User Report:**
   - Present the `tester` verdict and supporting evidence clearly to the user in the **user's language**.
   - Never claim `PASSED` if `tester` reported failures or inconclusive/unrun checks.
