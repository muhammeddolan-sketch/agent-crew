---
name: crew-verify
description: Verifies the current change cheaply first (chief runs build/tests, 0 workers) and escalates to an independent read-only tester only when the diff or the risk justifies it. Use when the user types /crew-verify.
argument-hint: "[--quick|--deep] [target or focus]"
---

# Crew Verify

`$ARGUMENTS` may contain `--quick`, `--deep`, and/or a target (files, commit range, branch) or a behavior focus.

## Step 1 — Scope (always, 0 workers)

- Run `git status --short` and `git diff --stat` (plus the staged diff if anything is staged).
- If the tree is clean and no target is given: say there is nothing to verify and stop.
- Collect the changed file list — this becomes `Scope:` later.

## Step 2 — Quick verification (default)

Run the mechanical checks **yourself**; do not spawn a worker for this:

1. Find the project's commands from `CLAUDE.md` / `AGENTS.md`, else infer: `package.json` scripts (`test`, `typecheck`, `lint`), `go test ./...`, `cargo test`, `pytest`, `dotnet test`.
2. Run the narrowest set that covers the change, piping output (`2>&1 | tail -40`).
3. Report `PASSED` / `FAILED` with the exact commands and the relevant output lines.

This is the correct path for most changes and costs no worker tokens.

## Step 3 — Escalate to `--deep` when any of these is true

- a quick check failed,
- the diff is larger than ~200 lines,
- the change touches a risk area: auth/session, money/payments, data deletion or migration, concurrency, protocol/wire format, permissions.

Also go deep when the user passed `--deep` explicitly. Say which trigger fired.

## Step 4 — Deep verification (independent `tester`)

- Reuse the open `tester` via `SendMessage({ to: "tester", message: ... })`; spawn it only if it is not open.
- The brief must contain the three required lines and nothing vague:

```text
Goal: independently verify <what changed> against <the requested behavior>.
Scope: <changed files from step 1, one per line, <= 10 entries>
Done when: return PASSED / FAILED / INCONCLUSIVE with command output and file:line evidence.
```

- Also pass: the user's `$ARGUMENTS` focus, the exact commands from step 2, and "read-only, do not edit".
- The scope guard blocks reads outside `Scope:`; if `tester` reports it needs another file, widen `Scope:` and send it back rather than letting it explore.

## Step 5 — Report

- Present the verdict and evidence in the **user's language**.
- Never claim `PASSED` when a check failed or was not run. Name what stayed untested.
