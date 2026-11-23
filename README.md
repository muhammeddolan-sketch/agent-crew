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
                  │      [PreToolUse guards: shell guard, brief/standby guard, scope guard]
                  │
                  └──▶ Independent verifier: tester (12, RO code)
                         reads the scoped diff + runs tests/build ──▶ PASSED / FAILED / INCONCLUSIVE
```

Every worker run is appended to a local ledger (`SubagentStop` hook), so `/crew-cost` can answer "what did this actually cost" with numbers instead of estimates.

## Workers

| Name | Model | Max Turns | Permissions | Role |
|---|---|---:|---|---|
| `scout` | haiku | 15 | Full (guarded) | Fast search, scanning, log/output summaries, running commands/tests, exact mechanical edits |
| `coder` | sonnet | 25 | Full (guarded) | Well-scoped coding, bug fixes, tests, code review, technical drafts; default coding worker |
| `senior` | opus | 30 | Full (guarded) | Hard debugging with unknown root cause, tasks `coder` could not finish, design-heavy reviews |
| `tester` | sonnet | 12 | Read-only code (`Write`/`Edit` disabled) | Independent verifier: reads the scoped diff, runs tests/builds, returns `PASSED` / `FAILED` / `INCONCLUSIVE` |
| `analyst` | sonnet | 25 | Strictly read-only (`Write`/`Edit` disabled) | Discovers available DB/analytics/browser MCPs or CLIs, measures metrics, returns report |
| `growth` | sonnet | 20 | Drafts (`Edit` disabled) | Audience/channel research, campaign calendars, post copy and briefs; prepares, never publishes |
| `browser` | sonnet | 25 | Read-only code (`Write`/`Edit` disabled) | Interactive web UI work via discovered browser MCPs; stops before irreversible outward actions |

Every worker also carries a **read budget** in its prompt (≤15 files / ~60k tokens of file content, `grep` before reading, `offset`/`limit` for large files). Hitting the budget means "stop and report what is missing", not "explore more".

### Guards (all fail-open, all individually removable)

| Hook | Event | What it blocks |
|---|---|---|
| `hooks/guard-subagent.js` | `PreToolUse: Bash + PowerShell` | `git commit`, `git push`, `git reset --hard`, `rm -rf` inside subagents (chief stays unblocked) |
| `hooks/guard-spawn.js` | `PreToolUse: Agent` | Standby spawns ("join the crew, just write ready") and briefs missing `Goal:` / `Scope:` / `Done when:` |
| `hooks/guard-scope.js` | `PreToolUse: Read`, `Bash + PowerShell` | Reads outside the brief's `Scope:`; repeated dump commands (same 600-line `git diff` twice) in read-only workers |
| `hooks/cost-ledger.js` | `SubagentStop` | Nothing — records one ledger row per worker run |

Escape hatches: add `CREW_BRIEF_EXEMPT` to a spawn prompt to bypass the brief check; omit `Scope:` to disable the scope guard for a worker. Hooks only act on `agent-crew:*` subagents and never block the chief.

## Measured cost

Measured on this plugin's own usage (17–22 Nov 2026, 46 crew runs, 23 of them real work, list prices of 22 Nov 2026):

| Finding | Number |
|---|---|
| Crew spend / same tokens on the chief model alone | **$75.99 / $158.14 → 52% saved** |
| Whole session vs. running everything on the chief model | $249.42 / $331.56 → **25% saved** |
| Where the crew money went | cache writes **69%** ($52.2), output 14%, cache reads 11% |
| Cold read per run | ~454k tokens |
| Idle "standby" spawns | 23 / 46 runs, ~$1.90 |
| Verifier runs killed by "Autocompact is thrashing" | 5 / 8, ~$5.69 |
| Cheapest useful worker | `scout`: 51 turns, $0.17 (38× cheaper than the same work on the chief model) |

What the measurement changed: standby spawns are now blocked by a hook, verifiers get a `Scope:` lock and a 12-turn cap, briefs must declare `Goal/Scope/Done when`, and every run lands in the ledger so the next measurement is a command instead of transcript archaeology.

Run it yourself:

```text
/crew-cost            # last 7 days
/crew-cost 30         # last 30 days
```

Ledger: `~/.claude/agent-crew/runs.jsonl` (override with `AGENT_CREW_LEDGER`). Prices live in `hooks/pricing.json`. On a subscription plan the dollar figures are quota equivalents, not a bill.

- **Language rule:** Internal worker → chief reports stay concise English for token efficiency; the chief always responds to you in your language.

## Development

```bash
node --test tests/hooks.test.js   # 25 unit tests, zero dependencies
node scripts/crew-cost.js --days 7
```

Tests cover the three guards (standby/brief, scope, repeated dumps) and the ledger, including a replay of a real verifier transcript.

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

### Scenario 2: Diff verification (`/crew-verify`)

```text
/crew-verify                          # cheap path: chief runs build/tests itself, 0 workers
/crew-verify --deep focus on auth     # escalate to an independent tester
```

1. Inspects `git status` and `git diff --stat` (returns immediately if clean).
2. **Quick (default):** the chief runs the project's test/typecheck/lint itself — no worker, no cold context.
3. **Deep:** opens or reuses `tester` with the changed files as its `Scope:`; the scope guard blocks reads outside it.
4. Returns a `PASSED` / `FAILED` / `INCONCLUSIVE` verdict with exact command output and `file:line` evidence.

### Scenario 3: Rules, roster & spend (`/crew`, `/crew-cost`)

```text
/crew
/crew-cost 30
```

`/crew` spawns **0** agents and prints the delegation threshold, worker `maxTurns`, open workers, and commands. `/crew-cost` reads the ledger and reports runs, spend, idle spawns, thrash and savings versus the chief model.

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
