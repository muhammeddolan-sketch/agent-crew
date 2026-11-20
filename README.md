# agent-crew

A Claude Code plugin that turns your main session into a **chief** (orchestrator) backed by **seven specialized workers**. Routing is cost-aware and lazy: cheap models handle mechanical scans, mid-tier models handle scoped tasks, expensive models stay reserved for hard problems, and workers spawn only when needed.

## How It Works

```text
User ──▶ Chief (main session + chief-rules.md via SessionStart)
            │
            ├─ Small / single-step task ──▶ Chief handles directly (0 subagents)
            │
            └─ Scoped / heavy / specialized task
                  │
                  ├──▶ Lazy named worker (first need only, reused via SendMessage)
                  │      scout (15) · coder (25) · senior (30)
                  │      analyst (25, RO) · growth (20) · browser (25, RO)
                  │      [PreToolUse Node guard blocks git commit/push/reset --hard & rm -rf]
                  │
                  └──▶ Independent verifier: tester (20, RO code)
                         reads git diff + runs tests/build ──▶ PASSED / FAILED / INCONCLUSIVE
```

## Workers

| Name | Model | Max Turns | Permissions | Role |
|---|---|---:|---|---|
| `scout` | haiku | 15 | Full (guarded) | Fast search, scanning, log/output summaries, running commands/tests, exact mechanical edits |
| `coder` | sonnet | 25 | Full (guarded) | Well-scoped coding, bug fixes, tests, code review, technical drafts; default coding worker |
| `senior` | opus | 30 | Full (guarded) | Hard debugging with unknown root cause, tasks `coder` could not finish, design-heavy reviews |
| `tester` | sonnet | 20 | Read-only code (`Write`/`Edit` disabled) | Independent verifier: reads `git diff`, runs tests/builds, returns `PASSED` / `FAILED` / `INCONCLUSIVE` |
| `analyst` | sonnet | 25 | Strictly read-only (`Write`/`Edit` disabled) | Discovers available DB/analytics/browser MCPs or CLIs, measures metrics, returns report |
| `growth` | sonnet | 20 | Drafts (`Edit` disabled) | Audience/channel research, campaign calendars, post copy and briefs; prepares, never publishes |
| `browser` | sonnet | 25 | Read-only code (`Write`/`Edit` disabled) | Interactive web UI work via discovered browser MCPs; stops before irreversible outward actions |

- **Mechanical subagent guard:** A cross-platform Node.js `PreToolUse` hook (`hooks/guard-subagent.js`) intercepts `Bash` and `PowerShell` calls inside subagents and blocks `git commit`, `git push`, `git reset --hard`, and `rm -rf` variants while leaving the main chief session unblocked.
- **Language rule:** Internal worker → chief reports stay concise English for token efficiency; the chief always responds to you in your language.

## Install

```text
/plugin marketplace add muhammeddolan-sketch/agent-crew
/plugin install agent-crew@agent-crew
```

Local test:

```text
claude --plugin-dir D:\path\to\agent-crew
```

## Usage & Scenarios

`SessionStart` injects `hooks/chief-rules.md` automatically on `startup`, `resume`, `clear`, and `compact` using a zero-dependency Node.js hook (`hooks/session-start.js`), so normal prompts already benefit from cost-aware routing.

### Scenario 1: End-to-end feature or refactor (`/crew <task>`)

```text
/crew Add rate limiting to the /api/login endpoint and cover edge cases with tests
```

1. Chief does a quick discovery pass (or lazily opens `scout` if broad) and writes a short plan.
2. Chief spawns `coder` (`name: "coder"`) on first need — or splits independent files across parallel workers by file boundary (`isolation: "worktree"` is available optionally for large, high-collision refactors).
3. Follow-up fixes go back to the existing named worker via `SendMessage` instead of paying cold-start spawns.
4. Chief spawns `tester` (`name: "tester"`) to verify the `git diff` and test suite independently before summarizing in your language.

### Scenario 2: Independent diff verification (`/crew-verify`)

```text
/crew-verify focus on auth error handling and edge cases
```

1. Inspects `git status` and `git diff --stat` (returns immediately if clean).
2. Lazily opens or reuses `tester` to review the diff and run relevant tests/typechecks/builds read-only.
3. Returns a `PASSED` / `FAILED` / `INCONCLUSIVE` verdict with exact command output and `file:line` evidence.

### Scenario 3: Rules & roster check (`/crew`)

```text
/crew
```

Spawns **0** agents and prints a concise summary of the delegation threshold, worker `maxTurns`, currently open workers in the session, and available commands.

## Customizing with `CLAUDE.md`

You do not need to fork the plugin to tune behavior per repository. Add an `agent-crew` section to your project's `CLAUDE.md` — the chief reads project instructions and overrides defaults accordingly:

```markdown
## agent-crew overrides
- Verification command: run `pnpm test:unit && pnpm typecheck` before claiming done.
- Delegation threshold: handle docs-only edits directly; always delegate API changes to `coder` + `tester`.
- Parallelism: use `isolation: "worktree"` for multi-package refactors touching shared types.
- Disable subagents: for quick exploratory prototypes on branch `spike/*`, work directly without spawning workers.
```

To customize worker models, turn caps, or prompts globally, edit `agents/*.md` and `hooks/chief-rules.md`.

## Optional MCPs (Stack-Agnostic)

All workers load and function with zero external MCP servers. When you configure MCPs in your environment, `analyst`, `browser`, `growth`, and `tester` use `ToolSearch` to discover what is installed:

- **Database / analytics MCPs** (e.g., Postgres, SQLite, BigQuery, PostHog, Plausible, or cloud platform MCPs): `analyst` queries schemas and metrics strictly read-only.
- **Browser / DevTools MCPs** (e.g., Playwright, Chrome DevTools, or Claude in Chrome): `browser` handles interactive UI flows, `analyst` reads dashboard numbers, and `tester` can inspect live UI behavior.
  - Note: Claude Code ignores `mcpServers` defined inside plugin agent frontmatter for security; configure any desired browser/DB MCPs at your user or project scope.

## License

MIT. See [LICENSE](LICENSE).
