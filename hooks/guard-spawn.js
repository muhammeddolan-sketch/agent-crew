'use strict';

/**
 * agent-crew: PreToolUse guard for `Agent` spawns from the chief session.
 *
 * Two deterministic blocks, both aimed at measured waste:
 *  1. Standby spawns ("join the crew, wait for tasks") cost ~$0.08 each and do
 *     no work. 23 of 46 runs in real usage were exactly this.
 *  2. Briefs without Goal / Scope / Done when produce unscoped workers that
 *     burn context re-exploring the repo (the main driver of cache writes).
 *
 * Only `agent-crew:*` subagent types are inspected; other plugins are untouched.
 * Fails open on any error.
 */

const fs = require('fs');
const path = require('path');

const STANDBY_PATTERNS = [
  /joined the crew/i,
  /ekibe kat/i,
  /just write\s*["'\u201c\u201d]?ready/i,
  /do not call any tool now/i,
  /g[oö]revlerin\s+\S*[eç]ften/i,
  /^\s*ready\s*$/i,
];

const LABELS = {
  goal: /^[ \t]*(?:[-*][ \t]+)?(?:\*\*|__)?[ \t]*(goal|hedef|ama[cç]|amac)[ \t]*(?:\*\*|__)?[ \t]*:/im,
  scope: /^[ \t]*(?:[-*][ \t]+)?(?:\*\*|__)?[ \t]*(scope|kapsam)[ \t]*(?:\*\*|__)?[ \t]*:/im,
  done: /^[ \t]*(?:[-*][ \t]+)?(?:\*\*|__)?[ \t]*(done when|definition of done|bitince|bitti[gğ]inde|biti[sş])[ \t]*(?:\*\*|__)?[ \t]*:/im,
};

const EXEMPT_MARKER = 'CREW_BRIEF_EXEMPT';

function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

function labelBody(prompt, re) {
  const m = re.exec(prompt);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = prompt.slice(start, start + 800);
  const stop = /\n[ \t]*(?:[-*][ \t]+)?(?:\*\*|__)?[ \t]*(?:goal|hedef|ama[cç]|scope|kapsam|done when|bitince|bitti[gğ]inde|constraints|rules|report|notes?|verification|verify)[ \t]*(?:\*\*|__)?[ \t]*:/i;
  const s = stop.exec(rest);
  const body = (s ? rest.slice(0, s.index) : rest)
    .replace(/[`*_>#]/g, ' ')
    .replace(/[\u2013\u2014-]/g, ' ')
    .trim();
  return body;
}

function handleInput(raw) {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!input || typeof input !== 'object') return null;

  const tool = input.tool_name;
  if (tool !== 'Agent' && tool !== 'Task') return null;

  const ti = input.tool_input || {};
  const type = typeof ti.subagent_type === 'string' ? ti.subagent_type : '';
  if (!/^agent-crew:/i.test(type)) return null;

  const prompt = typeof ti.prompt === 'string' ? ti.prompt : '';
  if (!prompt.trim()) return null;
  if (prompt.includes(EXEMPT_MARKER)) return null;

  for (const re of STANDBY_PATTERNS) {
    if (re.test(prompt)) {
      return deny(
        'Standby spawn blocked (agent-crew). A worker must be opened with its first real task, not with "join the crew / write ready". ' +
          'Each idle spawn still pays for a cold context. To show the roster without spawning, use /crew. ' +
          'If this spawn is intentional, add CREW_BRIEF_EXEMPT to the prompt.'
      );
    }
  }

  const missing = [];
  for (const [name, re] of Object.entries(LABELS)) {
    const body = labelBody(prompt, re);
    if (!body || body.length < 3) missing.push(name);
  }

  if (missing.length) {
    const human = missing.map((m) => (m === 'goal' ? 'Goal:' : m === 'scope' ? 'Scope:' : 'Done when:')).join(' ');
    return deny(
      `Brief rejected (agent-crew): missing or empty ${human}. ` +
        'Add the three fields, one per line, and spawn again:\n' +
        '  Goal: <what to achieve, one sentence>\n' +
        '  Scope: <files/dirs/globs the worker may touch, <= 10 entries>\n' +
        '  Done when: <command or check that proves it is finished>\n' +
        'Unscoped workers re-read the repository and dominate the bill. ' +
        'Escape hatch: add CREW_BRIEF_EXEMPT to the prompt.'
    );
  }

  return null;
}

function main() {
  const chunks = [];
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => {
    try {
      const out = handleInput(chunks.join(''));
      if (out) process.stdout.write(JSON.stringify(out) + '\n');
    } catch {
      /* fail open */
    }
    process.exit(0);
  });
}

if (require.main === module) main();

module.exports = { handleInput };
