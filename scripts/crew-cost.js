'use strict';

/**
 * agent-crew: cost report for the local run ledger.
 *
 *   node scripts/crew-cost.js [--days 7] [--json]
 *
 * Reads ~/.claude/agent-crew/runs.jsonl (override: AGENT_CREW_LEDGER).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_LEDGER = path.join(os.homedir(), '.claude', 'agent-crew', 'runs.jsonl');

function parseArgs(argv) {
  const out = { days: 7, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') out.days = Number(argv[++i]) || 7;
    else if (argv[i] === '--json') out.json = true;
  }
  return out;
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function money(n) {
  return '$' + (Math.round(n * 100) / 100).toFixed(2);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ledger = process.env.AGENT_CREW_LEDGER || DEFAULT_LEDGER;

  if (!fs.existsSync(ledger)) {
    console.log(
      `No ledger yet at ${ledger}.\n` +
        'It fills up when a worker finishes (SubagentStop hook). Run a task with /crew first.'
    );
    return;
  }

  const cutoff = Date.now() - args.days * 86400000;
  const rows = fs
    .readFileSync(ledger, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((r) => Date.parse(r.started || r.ts) >= cutoff);

  if (!rows.length) {
    console.log(`No worker runs in the last ${args.days} days.`);
    return;
  }

  const cost = rows.reduce((a, r) => a + (r.usd || 0), 0);
  const opus = rows.reduce((a, r) => a + (r.usdOpus || 0), 0);
  const idle = rows.filter((r) => (r.turns || 0) <= 1);
  const thrash = rows.filter((r) => r.thrash);
  const real = rows.filter((r) => (r.turns || 0) > 1);
  const byAgent = {};
  for (const r of rows) {
    const a = (byAgent[r.agent] = byAgent[r.agent] || { n: 0, usd: 0, thrash: 0 });
    a.n++;
    a.usd += r.usd || 0;
    if (r.thrash) a.thrash++;
  }
  const days = {};
  for (const r of rows) {
    const d = String(r.started || r.ts).slice(0, 10);
    days[d] = (days[d] || 0) + (r.usd || 0);
  }

  if (args.json) {
    console.log(JSON.stringify({ rows, totals: { cost, opus } }, null, 2));
    return;
  }

  const verdicts = {};
  for (const r of rows) if (r.verdict) verdicts[r.verdict] = (verdicts[r.verdict] || 0) + 1;

  console.log(`agent-crew · last ${args.days} days · ${ledger}`);
  console.log('');
  console.log(`runs            ${rows.length}  (${real.length} real, ${idle.length} standby/idle)`);
  console.log(`spend           ${money(cost)}   at Opus 5.5 prices: ${money(opus)}   saved ${money(opus - cost)}`);
  console.log(`per real run    avg ${money(real.reduce((a, r) => a + (r.usd || 0), 0) / (real.length || 1))} · median ${money(median(real.map((r) => r.usd || 0)))}`);
  console.log(`thrash runs     ${thrash.length}${thrash.length ? ' (' + money(thrash.reduce((a, r) => a + (r.usd || 0), 0)) + ' wasted)' : ''}`);
  console.log(`verdicts        ${Object.entries(verdicts).map(([k, v]) => k + ':' + v).join(' · ') || 'none'}`);
  console.log('');
  console.log('by worker');
  for (const [a, v] of Object.entries(byAgent).sort((x, y) => y[1].usd - x[1].usd)) {
    console.log(`  ${a.padEnd(18)} runs ${String(v.n).padStart(3)}  ${money(v.usd).padStart(8)}${v.thrash ? `  thrash ${v.thrash}` : ''}`);
  }
  console.log('');
  console.log('by day');
  for (const d of Object.keys(days).sort()) console.log(`  ${d}  ${money(days[d])}`);
}

main();
