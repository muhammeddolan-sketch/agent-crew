---
name: crew
description: Cost-aware chief orchestration for a task (/crew <task>) with lazy on-demand named workers and SendMessage reuse, or a status/rules summary without spawning anyone (/crew). Use when the user types /crew.
argument-hint: "[task]"
---

# Crew Orchestrator

Check `$ARGUMENTS`.

## Mode A — Argumentless (`/crew`, `$ARGUMENTS` empty)

Spawn **zero** subagents. Present a concise summary in the **user's language**:

1. **Delegation threshold:** under ~5 tool calls or ~3 files the chief does the work itself; workers are opened only for broad scans, multi-file work, verification, or browser/analytics/growth.
2. **Workers & `maxTurns`:** `scout` (haiku, 15) · `coder` (sonnet, 25) · `senior` (opus, 30) · `tester` (sonnet, 12, read-only code) · `analyst` (sonnet, 25, strictly read-only) · `growth` (sonnet, 20) · `browser` (sonnet, 25, read-only code).
3. **Session state:** list the named workers already open in this conversation, or say none are open.
4. **Cost note:** an idle standby spawn still pays for a cold context (~$0.08); that is why workers open with their first real task. See `/crew-cost` for this project's actual spend.
5. **Commands:** `/crew <task>` to orchestrate; `/crew-verify [--quick|--deep]` to verify the current diff; `/crew-cost [days]` for the spend ledger.

## Mode B — Task Orchestration (`/crew <task>`)

### 1. Quick discovery

- Run 1-2 targeted greps/globs yourself.
- If the area is broad (> ~5 unknown files), open `scout` **with the mapping task as its brief** (not with "join the crew") to produce `path:line — what — why`. Reuse that map as `Start:` for `coder`.

### 2. Plan

- Short, concrete plan: target files, order, which worker does what, file-boundary split for parallel work, and what verification will run.
- Check the project's `CLAUDE.md` for test/build commands and delegation overrides.

### 3. Lazy delegation with a contract

Every `Agent` prompt for `agent-crew:*` must contain:

```text
Goal: <one sentence>
Scope: <files/dirs/globs, <= 10 entries>
Done when: <command or check>
Read budget: <= 15 files, <= 60k tokens; grep before reading; stop and report if exceeded.
```

A `PreToolUse` hook rejects briefs missing these and rejects standby spawns. Add `Start: path:line` when you know where work begins.

- **Reuse before spawn:** follow-up work goes to the open worker via `SendMessage`. A warm worker reads its cache at 1/25 of the write price.
- **Parallel:** at most 2 workers, partitioned strictly by file boundary. `isolation: "worktree"` only for large high-collision refactors.
- **Busy worker:** if the named worker is mid-task and an independent parallel task arrives, spawn a temporary worker of that type — with a full brief.

### 4. Verification

- Run the mechanical checks yourself first (`/crew-verify` quick path): build, tests, typecheck, lint.
- Escalate to `tester` only when a check is red, the diff is > ~200 lines, or the change is risky (auth, money, data, concurrency, protocol, migrations). Its brief needs `Scope:` with the changed files.
- For trivial single-line, comment, or config edits, the diff plus one command is enough.

### 5. Summary & hygiene

- Present the result and the verification evidence in the **user's language**.
- Keep open workers for related follow-ups instead of re-spawning; suggest `/clear` when the topic ends.
- If the user asks what this cost, run `/crew-cost`.
