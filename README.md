# agent-crew

A Claude Code plugin that turns your main session into a **chief** (orchestrator) backed by **seven specialized workers**. Routing is cost-aware: cheap models do mechanical work, mid-tier models do scoped work, and the expensive model is reserved for what actually needs it.

## Workers

| Name | Model | Role |
|---|---|---|
| `scout` | haiku | Search, scanning, output summaries, running commands/tests, fully specified mechanical edits |
| `coder` | sonnet | Well-scoped coding, bug fixes, tests, code review, technical writing; the default worker |
| `senior` | opus | Hard debugging with unknown root cause, work `coder` could not finish, design-heavy reviews |
| `growth` | sonnet | Growth research and planning, channel strategy, post copy and scripts; prepares, never publishes |
| `analyst` | sonnet | Read-only measurement: users, traffic, installs, post performance |
| `browser` | sonnet | All Chrome work: navigation, forms, uploads, on-screen checks |
| `tester` | sonnet | Independent verifier: reads the diff, runs tests, returns PASSED / FAILED |

Flow for outward-facing work: `growth` prepares, the user approves, `browser` publishes.

## Install

```
/plugin marketplace add muhammeddolan-sketch/agent-crew
/plugin install agent-crew@agent-crew
```

Local test:

```
claude --plugin-dir D:\path\to\agent-crew
```

## Usage

- Type `/crew` to open the workers by name and keep them alive for the session; the chief then hands work over with `SendMessage` instead of spawning new agents.
- Or just work normally. A `SessionStart` hook injects the chief rules (`hooks/chief-rules.md`) into context on startup, resume, clear, and compact, so the main session routes work to the right worker on its own.

## Optional dependencies

The workers load without these, but the related capabilities will not be available.

- `analyst` uses Supabase MCP tools: `list_projects`, `list_tables`, `execute_sql`.
- `analyst` uses Vercel MCP tools: `list_projects`, `count_pageviews`, `aggregate_pageviews`, `count_events`, `aggregate_events`.
- `analyst` (read-only tools) and `browser` (full tool set) use Claude in Chrome (`mcp__claude-in-chrome__*`).
- `tester` references the `chrome-devtools` MCP server (`mcp__chrome-devtools`) and declares it via `npx -y chrome-devtools-mcp@1.13.0`. Claude Code may ignore `mcpServers` in plugin agent frontmatter; if so, install that MCP server yourself.

## Customizing

Edit the files in `agents/*.md` (frontmatter: `name`, `description`, `model`, `tools`; body: the worker's instructions) and `hooks/chief-rules.md` (the routing and verification rules). Remove tool names you do not have, or change models to fit your budget.

## License

MIT. See [LICENSE](LICENSE).
