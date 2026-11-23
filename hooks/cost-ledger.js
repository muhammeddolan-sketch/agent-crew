'use strict';

/**
 * agent-crew: SubagentStop hook — one line per worker run in a local ledger.
 *
 * Why: without this, nobody can tell whether the crew pays for itself. The
 * first real measurement had to be reconstructed by mining transcripts.
 *
 * Writes ~/.claude/agent-crew/runs.jsonl (override: AGENT_CREW_LEDGER).
 * Never blocks anything; fails open and silent.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PRICING_PATH = path.join(__dirname, 'pricing.json');
const DEFAULT_LEDGER = path.join(os.homedir(), '.claude', 'agent-crew', 'runs.jsonl');

function loadPricing() {
  try {
    return JSON.parse(fs.readFileSync(PRICING_PATH, 'utf8'));
  } catch {
    return { models: {}, fallback: { in: 4, out: 20, cacheWrite: 5, cacheRead: 0.2 } };
  }
}

function priceFor(pricing, model) {
  const table = pricing.models || {};
  const m = String(model || '').toLowerCase();
  let best = null;
  for (const key of Object.keys(table)) {
    if (m.startsWith(key.toLowerCase()) && (!best || key.length > best.length)) best = key;
  }
  return (best && table[best]) || pricing.fallback || { in: 0, out: 0, cacheWrite: 0, cacheRead: 0 };
}

function usd(pricing, model, t) {
  const p = priceFor(pricing, model);
  return (t.i * p.in + t.o * p.out + t.cw * p.cacheWrite + t.cr * p.cacheRead) / 1e6;
}

const KNOWN_WORKERS = ['scout', 'coder', 'senior', 'tester', 'analyst', 'growth', 'browser'];

function agentName(file) {
  const m = /agent-(.+)-[0-9a-f]{16}\.jsonl$/i.exec(path.basename(file));
  if (!m) return path.basename(file, '.jsonl');
  let name = m[1].replace(/-\d+$/, '');
  // Claude Code names subagent transcripts agent-a<type>-<hash>.jsonl
  if (name.startsWith('a') && KNOWN_WORKERS.some((k) => name.slice(1).startsWith(k))) name = name.slice(1);
  return name;
}

function findTranscript(input) {
  const direct = [
    input.agent_transcript_path,
    input.subagent_transcript_path,
    input.transcript_path,
  ].filter((p) => typeof p === 'string' && p);
  for (const p of direct) {
    if (/[\\/]subagents[\\/]/i.test(p) && fs.existsSync(p)) return p;
  }

  // Fallback: Claude Code keeps subagent transcripts in <session-id>/subagents/.
  // SubagentStop fires right after that worker finished, so the newest file is it.
  const session = typeof input.transcript_path === 'string' ? input.transcript_path : '';
  if (!session) return null;
  const dir = path.join(path.dirname(session), path.basename(session, '.jsonl'), 'subagents');
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^agent-.*\.jsonl$/i.test(f))
      .map((f) => path.join(dir, f))
      .map((f) => ({ f, t: fs.statSync(f).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    return files.length ? files[0].f : null;
  } catch {
    return null;
  }
}

function scan(file) {
  const pricing = loadPricing();
  const perModel = {};
  let turns = 0;
  let reads = 0;
  let thrash = false;
  let firstTs = null;
  let lastTs = null;
  let lastText = '';

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.timestamp) {
      if (!firstTs) firstTs = d.timestamp;
      lastTs = d.timestamp;
    }
    if (d.type !== 'assistant') continue;
    const msg = d.message || {};
    const u = msg.usage;
    if (u) {
      turns++;
      const key = msg.model || 'unknown';
      const t = perModel[key] || (perModel[key] = { i: 0, o: 0, cw: 0, cr: 0 });
      t.i += u.input_tokens || 0;
      t.o += u.output_tokens || 0;
      t.cw += u.cache_creation_input_tokens || 0;
      t.cr += u.cache_read_input_tokens || 0;
    }
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'tool_use' && part.name === 'Read') reads++;
        if (part.type === 'text' && part.text) {
          lastText = part.text;
          if (/Autocompact is thrashing/i.test(part.text)) thrash = true;
        }
      }
    }
  }

  let cost = 0;
  let costOpus = 0;
  let tokens = { i: 0, o: 0, cw: 0, cr: 0 };
  for (const [model, t] of Object.entries(perModel)) {
    cost += usd(pricing, model, t);
    costOpus += usd(pricing, 'claude-opus-5-5', t);
    tokens.i += t.i;
    tokens.o += t.o;
    tokens.cw += t.cw;
    tokens.cr += t.cr;
  }

  const v = /\b(PASSED|FAILED|INCONCLUSIVE)\b/i.exec(lastText);
  let verdict = v ? v[1].toUpperCase() : null;
  if (!verdict) {
    if (/\bGE[ÇC]T[İI]\b/i.test(lastText)) verdict = 'PASSED';
    else if (/\bKALDI\b/i.test(lastText)) verdict = 'FAILED';
  }

  const minutes =
    firstTs && lastTs
      ? Math.round(((Date.parse(lastTs) - Date.parse(firstTs)) / 60000) * 10) / 10
      : null;

  return {
    ts: new Date().toISOString(),
    started: firstTs,
    agent: agentName(file),
    models: Object.keys(perModel),
    turns,
    reads,
    tokens,
    usd: Math.round(cost * 100) / 100,
    usdOpus: Math.round(costOpus * 100) / 100,
    minutes,
    verdict,
    thrash,
  };
}

function alreadyRecorded(ledger, file) {
  try {
    const lines = fs.readFileSync(ledger, 'utf8').split(/\r?\n/).filter(Boolean).slice(-400);
    return lines.some((l) => {
      try {
        return JSON.parse(l).file === file;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function handleInput(raw) {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!input || typeof input !== 'object') return null;
  if (input.hook_event_name && !/^SubagentStop$/i.test(input.hook_event_name)) return null;

  const file = findTranscript(input);
  const ledger = process.env.AGENT_CREW_LEDGER || DEFAULT_LEDGER;

  if (!file) {
    if (process.env.AGENT_CREW_DEBUG) {
      try {
        fs.mkdirSync(path.dirname(ledger), { recursive: true });
        fs.appendFileSync(
          path.join(path.dirname(ledger), 'hook-debug.jsonl'),
          JSON.stringify({ ts: new Date().toISOString(), event: 'SubagentStop', keys: Object.keys(input), input }) + '\n',
          'utf8'
        );
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  const row = scan(file);
  if (!row.turns) return null;
  row.session = input.session_id || null;
  row.file = path.basename(file);

  if (alreadyRecorded(ledger, row.file)) return null;

  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  fs.appendFileSync(ledger, JSON.stringify(row) + '\n', 'utf8');
  return row;
}

function main() {
  const chunks = [];
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => {
    try {
      handleInput(chunks.join(''));
    } catch {
      /* fail open */
    }
    process.exit(0);
  });
}

if (require.main === module) main();

module.exports = { handleInput, scan, priceFor };
