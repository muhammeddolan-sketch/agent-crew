---
name: crew-cost
description: Shows what the crew actually cost — runs, spend, idle spawns, thrash, verdicts and savings versus the chief model — from the local run ledger. Use when the user types /crew-cost or asks what the workers cost.
argument-hint: "[days]"
---

# Crew Cost

Report the real spend of agent-crew from its ledger. Do not estimate from memory.

## Steps

1. Run the report script (default: last 7 days):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/crew-cost.js" --days ${ARGUMENTS:-7}
```

2. Read the output and present it to the user in the **user's language**, keeping the numbers exact:
   - total spend and the "at Opus prices" comparison,
   - runs, real runs, standby/idle runs,
   - thrash runs and the money they burned,
   - spend per worker and per day.
3. Add one short interpretation, only from the numbers:
   - idle runs > 10% → the chief is opening workers before it has a task;
   - thrash > 0 → verifier briefs need a tighter `Scope:`;
   - one worker dominating spend → check whether the task belonged to a cheaper worker (`scout` for scanning, `coder` for scoped edits).
4. If the ledger is empty, say so and note that it fills when a worker finishes (the `SubagentStop` hook). Do not invent numbers.

## Notes

- Ledger: `~/.claude/agent-crew/runs.jsonl` (override with `AGENT_CREW_LEDGER`).
- Prices come from `hooks/pricing.json`; update that file when list prices change.
- Dollar figures are list-price equivalents. On a subscription plan they map to quota consumption, not to a bill — say that when the user is on a subscription.
