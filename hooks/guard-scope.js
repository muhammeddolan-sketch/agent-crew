'use strict';

/**
 * agent-crew: PreToolUse guard for `Read` inside subagents.
 *
 * Measured problem: a verifier that explores the whole repository re-reads
 * hundreds of thousands of tokens, compacts, re-reads, and dies in
 * "Autocompact is thrashing" without returning a verdict (5 of 8 runs).
 *
 * Rule: if the worker's brief declares a `Scope:` block, the worker may only
 * `Read` paths inside that scope (plus CLAUDE.md/AGENTS.md/.claude). Grep and
 * Glob stay unrestricted, so targeted lookup is always possible.
 *
 * Shell reads count too. A real verifier run never called `Read` once: it
 * dumped the same 600-line `git diff` twice and `sed -n`-ed a 5k-line file
 * through Bash. So read-only workers also get:
 *   - the same dump command twice in one run -> deny (its output is already
 *     in context; the second run only burns cache writes),
 *   - a dump of an absolute path outside `Scope:` -> deny.
 *
 * Fails open when no scope is found (non-crew agents, free-form briefs).
 */

const fs = require('fs');
const path = require('path');

const MAX_BRIEF_LINES = 160;
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;

const READ_ONLY_WORKERS = /^(tester|analyst|browser)/i;

// Commands whose whole purpose is to dump file/diff content into context.
const DUMP_COMMAND =
  /\b(git\s+(?:diff|show|log\s+-p)|cat|type|Get-Content|sed\s+-n|head|tail|bat|less|more)\b/i;

const ALWAYS_ALLOWED = [/^claude\.md$/i, /^agents\.md$/i, /(^|[\\/])\.claude[\\/]/i];

function agentNameFromTranscript(transcript) {
  const m = /agent-(a?)([A-Za-z0-9_-]+?)-[0-9a-f]{16}\.jsonl$/i.exec(path.basename(transcript));
  return m ? m[2] : '';
}

function normalizeCmd(cmd) {
  return String(cmd || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*;\s*/g, '; ')
    .trim()
    .replace(/;+$/, '');
}

/** Absolute file paths that a dump command would pull into context. */
function dumpTargets(cmd) {
  const out = [];
  for (const raw of String(cmd || '').split(/;|&&|\|\||\r?\n/)) {
    const seg = raw.trim();
    if (!seg || /^cd\b/i.test(seg) || !DUMP_COMMAND.test(seg)) continue;
    const re = /(?:^|[\s"'`=:(])([a-z]:[\\/][^\s"'`;|&<>]*|\/(?:[\w.@+-]+\/)+[\w.@+-]*)/gi;
    let m;
    while ((m = re.exec(seg))) {
      const p = m[1].replace(/[.,;:)]+$/, '');
      const base = p.split(/[\\/]/).pop() || '';
      if (p.length < 4 || !/\.[A-Za-z0-9]+$/.test(base)) continue;
      out.push(p);
    }
  }
  return out;
}

function readCommands(transcriptPath) {
  let text;
  try {
    const st = fs.statSync(transcriptPath);
    const fd = fs.openSync(transcriptPath, 'r');
    try {
      const size = Math.min(st.size, MAX_TRANSCRIPT_BYTES);
      const buf = Buffer.alloc(size);
      const read = fs.readSync(fd, buf, 0, size, 0);
      text = buf.slice(0, read).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }

  const cmds = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const c = d.message && d.message.content;
    if (!Array.isArray(c)) continue;
    for (const part of c) {
      if (part.type !== 'tool_use') continue;
      if (part.name !== 'Bash' && part.name !== 'PowerShell') continue;
      const cmd = part.input && part.input.command;
      if (typeof cmd === 'string' && cmd.trim()) cmds.push(normalizeCmd(cmd));
    }
  }
  return cmds;
}

function norm(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function toRegex(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if ('\\^$+.()|{}[]'.includes(c)) {
      out += '\\' + c;
    } else {
      out += c;
    }
  }
  return new RegExp('^' + out + '$', 'i');
}

function cleanEntry(line) {
  let s = line
    .replace(/^\s*(?:[-*+]|\d+\.)\s*/, '')
    .replace(/`/g, '')
    .replace(/^["']|["']$/g, '')
    .replace(/\s+#.*$/, '')
    .replace(/\s+[\u2013\u2014-]{1,2}\s+.*$/, '')
    .trim();
  if (!s) return null;
  if (/\s/.test(s)) s = s.split(/\s+/)[0];
  if (!/[\\/*.]/.test(s)) return null;
  return s;
}

function parseScope(brief) {
  const m = /(?:^|\n)[ \t]*(?:[-*][ \t]+)?(?:\*\*|__)?[ \t]*(?:scope|kapsam)[ \t]*(?:\*\*|__)?[ \t]*:([\s\S]*?)(?=\n[ \t]*(?:[-*][ \t]+)?(?:\*\*|__)?[ \t]*(?:goal|hedef|ama[cç]|done when|bitince|bitti[gğ]inde|constraints|rules|report|notes?|verification|verify|start|entry)[ \t]*(?:\*\*|__)?[ \t]*:|\n[ \t]*\n|$)/i.exec(
    brief
  );
  if (!m) return null;
  const entries = m[1]
    .split(/\r?\n/)
    .map(cleanEntry)
    .filter(Boolean);
  return entries.length ? entries : null;
}

function readBrief(transcriptPath) {
  const fd = fs.openSync(transcriptPath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 512);
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    const text = buf.slice(0, read).toString('utf8');
    const lines = text.split(/\r?\n/).slice(0, MAX_BRIEF_LINES);
    for (const line of lines) {
      if (!line.trim()) continue;
      let d;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      if (d.type !== 'user' || d.isMeta) continue;
      const c = d.message && d.message.content;
      if (typeof c === 'string' && c.trim()) return c;
    }
  } finally {
    fs.closeSync(fd);
  }
  return null;
}

function inScope(filePath, entries) {
  const target = norm(filePath);
  const base = target.split('/').pop();
  if (ALWAYS_ALLOWED.some((re) => re.test(target) || re.test(base))) return true;
  for (const raw of entries) {
    const entry = norm(raw).replace(/^\.\//, '');
    if (!entry) continue;
    if (/[*?]/.test(entry)) {
      const re = toRegex(entry);
      const parts = target.split('/');
      const subs = [];
      for (let i = 0; i < parts.length; i++) subs.push(parts.slice(i).join('/'));
      if (subs.some((s) => re.test(s))) return true;
      if (re.test(base)) return true;
      continue;
    }
    if (entry.startsWith('/') || /^[a-z]:\//i.test(entry)) {
      if (target.toLowerCase() === entry.toLowerCase()) return true;
      if (target.toLowerCase().startsWith(entry.toLowerCase() + '/')) return true;
      continue;
    }
    if (target.toLowerCase().endsWith('/' + entry.toLowerCase())) return true;
    if (target.toLowerCase() === entry.toLowerCase()) return true;
    if (!entry.includes('/') && base.toLowerCase() === entry.toLowerCase()) return true;
  }
  return false;
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
  if (tool !== 'Read' && tool !== 'Bash' && tool !== 'PowerShell') return null;

  const transcript = typeof input.transcript_path === 'string' ? input.transcript_path : '';
  if (!transcript || !/[\\/]subagents[\\/]/i.test(transcript)) return null;

  const ti = input.tool_input || {};

  if (tool !== 'Read') {
    if (!READ_ONLY_WORKERS.test(agentNameFromTranscript(transcript))) return null;
    return checkShellRead(ti.command, transcript);
  }

  const filePath = ti.file_path || ti.path || '';
  if (!filePath) return null;

  let brief;
  try {
    brief = readBrief(transcript);
  } catch {
    return null;
  }
  if (!brief) return null;

  const entries = parseScope(brief);
  if (!entries) return null;
  if (inScope(filePath, entries)) return null;

  const shown = entries.slice(0, 4).join(', ');
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `Read blocked (agent-crew scope guard): ${path.basename(filePath)} is outside this worker's brief.\n` +
        `Scope: ${shown}${entries.length > 4 ? ` (+${entries.length - 4} more)` : ''}\n` +
        'Use Grep/Glob to locate the exact lines, or ask the chief to widen Scope. ' +
        'Reading outside scope is what pushes workers into compaction thrash.'
    },
  };
}

/**
 * Shell reads inside read-only workers: block a repeated dump and a dump of an
 * absolute path outside `Scope:`. Everything else (tests, builds, git status)
 * passes untouched.
 */
function checkShellRead(command, transcript) {
  const cmd = normalizeCmd(command);
  if (!cmd || !DUMP_COMMAND.test(cmd) || cmd.length < 12) return null;

  let brief;
  try {
    brief = readBrief(transcript);
  } catch {
    return null;
  }
  if (!brief) return null;

  const entries = parseScope(brief);

  if (entries) {
    const outside = dumpTargets(cmd).filter((p) => !inScope(p, entries));
    const realOutside = outside.filter((p) => !ALWAYS_ALLOWED.some((re) => re.test(p)));
    if (realOutside.length) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            `Shell read blocked (agent-crew scope guard): ${path.basename(realOutside[0])} is outside this worker's brief.\n` +
            `Scope: ${entries.slice(0, 4).join(', ')}${entries.length > 4 ? ` (+${entries.length - 4} more)` : ''}\n` +
            'Dumping a file through Bash costs the same as `Read`. Ask the chief to widen Scope if you truly need it.'
        },
      };
    }
  }

  let history;
  try {
    history = readCommands(transcript);
  } catch {
    return null;
  }
  if (!history) return null;

  const seen = history.filter((c) => c === cmd).length;
  if (seen >= 1) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'Repeated dump blocked (agent-crew): you already ran this exact command and its output is in your context.\n' +
          'Re-running it only pays for cache writes. Instead: narrow the command (`git diff --stat`, `git diff -U0 -- <file>`, `| head -40`), ' +
          'or read the specific lines you need. If the output was truncated, say so in your report and stop.'
      },
    };
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

module.exports = {
  handleInput,
  parseScope,
  inScope,
  checkShellRead,
  normalizeCmd,
  agentNameFromTranscript,
};
