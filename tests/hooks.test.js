'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const spawnGuard = require('../hooks/guard-spawn');
const scopeGuard = require('../hooks/guard-scope');
const ledger = require('../hooks/cost-ledger');

const BRIEF = `Goal: verify the DM request change against the spec.
Scope:
  - server/internal/api/**
  - D:\\projeler\\frogcord\\client\\src\\features\\friends\\*
Done when: return PASSED / FAILED / INCONCLUSIVE with file:line evidence.`;

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'crew-test-'));
}

function writeTranscript(dir, agent, brief, extraCommands = []) {
  const sub = path.join(dir, 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  const file = path.join(sub, `agent-a${agent}-0123456789abcdef.jsonl`);
  const lines = [
    JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: '<system-reminder>x</system-reminder>' } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: brief } }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-11-22T10:00:00.000Z',
      message: {
        model: 'claude-sonnet-5-5',
        usage: { input_tokens: 12, output_tokens: 900, cache_creation_input_tokens: 40000, cache_read_input_tokens: 120000 },
        content: [{ type: 'text', text: 'checking' }],
      },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-11-22T10:04:00.000Z',
      message: {
        model: 'claude-sonnet-5-5',
        usage: { input_tokens: 8, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 90000 },
        content: [
          { type: 'tool_use', name: 'Read', input: { file_path: 'x' } },
          { type: 'text', text: '**Verdict: PASSED.** tsc clean.' },
        ],
      },
    }),
  ];

  for (const cmd of extraCommands) {
    lines.push(
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-11-22T10:05:00.000Z',
        message: {
          model: 'claude-sonnet-5-5',
          usage: { input_tokens: 5, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 1000 },
          content: [{ type: 'tool_use', name: 'Bash', input: { command: cmd } }],
        },
      })
    );
  }

  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  return file;
}

function spawnEvent(prompt, type = 'agent-crew:coder') {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
    tool_input: { subagent_type: type, name: 'coder', description: 'x', prompt },
  });
}

// ---------- spawn guard ----------

test('blocks standby spawn (English)', () => {
  const out = spawnGuard.handleInput(
    spawnEvent('You joined the crew. Your tasks will arrive from the chief via SendMessage. Do not call any tool now, just write "ready".')
  );
  assert.ok(out, 'expected a deny');
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /Standby spawn blocked/);
});

test('blocks standby spawn (Turkish)', () => {
  const out = spawnGuard.handleInput(spawnEvent('Ekibe katıldın. Görevlerin şeften SendMessage ile gelecek. Şimdilik sadece "hazır" yaz.'));
  assert.ok(out);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
});

test('blocks a brief without Done when', () => {
  const out = spawnGuard.handleInput(spawnEvent('Goal: fix the thing\nScope: src/**'));
  assert.ok(out);
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /Done when/);
});

test('blocks a brief with empty Scope', () => {
  const out = spawnGuard.handleInput(spawnEvent('Goal: fix the thing\nScope:\nDone when: tests pass'));
  assert.ok(out);
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /Scope/);
});

test('accepts a complete brief', () => {
  assert.strictEqual(spawnGuard.handleInput(spawnEvent(BRIEF)), null);
});

test('accepts Turkish labels', () => {
  const p = 'Hedef: DM isteği değişikliğini doğrula.\nKapsam: server/internal/api/**\nBitince: PASSED/FAILED döndür.';
  assert.strictEqual(spawnGuard.handleInput(spawnEvent(p)), null);
});

test('ignores non agent-crew subagent types', () => {
  assert.strictEqual(spawnGuard.handleInput(spawnEvent('just write "ready"', 'web-fetch')), null);
});

test('honours the escape hatch', () => {
  assert.strictEqual(spawnGuard.handleInput(spawnEvent('CREW_BRIEF_EXEMPT just write "ready"')), null);
});

test('ignores other tools', () => {
  const raw = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.strictEqual(spawnGuard.handleInput(raw), null);
});

// ---------- scope guard ----------

test('parseScope extracts entries', () => {
  const entries = scopeGuard.parseScope(BRIEF);
  assert.deepStrictEqual(entries, ['server/internal/api/**', 'D:\\projeler\\frogcord\\client\\src\\features\\friends\\*']);
});

test('allows a file inside a scope glob', () => {
  const dir = tmpDir();
  const t = writeTranscript(dir, 'tester', BRIEF);
  const raw = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    transcript_path: t,
    tool_input: { file_path: 'D:\\projeler\\frogcord\\server\\internal\\api\\dm_istek.go' },
  });
  assert.strictEqual(scopeGuard.handleInput(raw), null);
});

test('allows a file inside an absolute glob', () => {
  const dir = tmpDir();
  const t = writeTranscript(dir, 'tester', BRIEF);
  const raw = JSON.stringify({
    tool_name: 'Read',
    transcript_path: t,
    tool_input: { file_path: 'D:/projeler/frogcord/client/src/features/friends/Arkadas.tsx' },
  });
  assert.strictEqual(scopeGuard.handleInput(raw), null);
});

test('blocks a read outside the scope', () => {
  const dir = tmpDir();
  const t = writeTranscript(dir, 'tester', BRIEF);
  const raw = JSON.stringify({
    tool_name: 'Read',
    transcript_path: t,
    tool_input: { file_path: 'D:\\projeler\\frogcord\\server\\internal\\store\\attachments.go' },
  });
  const out = scopeGuard.handleInput(raw);
  assert.ok(out, 'expected a deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /outside this worker's brief/);
});

test('always allows CLAUDE.md', () => {
  const dir = tmpDir();
  const t = writeTranscript(dir, 'tester', BRIEF);
  const raw = JSON.stringify({
    tool_name: 'Read',
    transcript_path: t,
    tool_input: { file_path: 'D:\\projeler\\frogcord\\CLAUDE.md' },
  });
  assert.strictEqual(scopeGuard.handleInput(raw), null);
});

test('fails open when the brief has no Scope', () => {
  const dir = tmpDir();
  const t = writeTranscript(dir, 'tester', 'Goal: look around.\nDone when: report.');
  const raw = JSON.stringify({
    tool_name: 'Read',
    transcript_path: t,
    tool_input: { file_path: 'D:\\projeler\\frogcord\\anything.go' },
  });
  assert.strictEqual(scopeGuard.handleInput(raw), null);
});

test('ignores reads from the main session', () => {
  const dir = tmpDir();
  const t = writeTranscript(dir, 'tester', BRIEF);
  const raw = JSON.stringify({ tool_name: 'Read', transcript_path: t.replace(/[\\/]subagents[\\/]/, '\\'), tool_input: { file_path: 'C:\\x' } });
  assert.strictEqual(scopeGuard.handleInput(raw), null);
});

// ---------- shell reads inside read-only workers ----------

const DIFF_CMD = "cd /d/projeler/frogcord; git diff -U2 -- apps/core/src/services/sesEfektleri.ts | grep -n '^[+]' | head -600";

function shellEvent(transcript, command) {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    transcript_path: transcript,
    tool_input: { command },
  });
}

test('blocks the same dump command twice in a tester run', () => {
  const dir = tmpDir();
  const t = writeTranscript(dir, 'tester', BRIEF, [DIFF_CMD]);
  const out = scopeGuard.handleInput(shellEvent(t, DIFF_CMD.replace(/\s+/g, ' ')));
  assert.ok(out, 'expected a deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /Repeated dump blocked/);
});

test('allows a dump command the first time', () => {
  const dir = tmpDir();
  const t = writeTranscript(dir, 'tester', BRIEF, []);
  assert.strictEqual(scopeGuard.handleInput(shellEvent(t, DIFF_CMD)), null);
});

test('allows repeated non-dump commands (tests, builds, status)', () => {
  const dir = tmpDir();
  const cmd = 'cd D:\\Projeler\\frogcord\\apps\\core; npx tsc --noEmit -p .';
  const t = writeTranscript(dir, 'tester', BRIEF, [cmd]);
  assert.strictEqual(scopeGuard.handleInput(shellEvent(t, cmd)), null);
});

test('does not police shell reads in writable workers', () => {
  const dir = tmpDir();
  const t = writeTranscript(dir, 'coder', BRIEF, [DIFF_CMD]);
  assert.strictEqual(scopeGuard.handleInput(shellEvent(t, DIFF_CMD)), null);
});

test('blocks a shell dump of an absolute path outside scope', () => {
  const dir = tmpDir();
  const t = writeTranscript(dir, 'tester', BRIEF, []);
  const out = scopeGuard.handleInput(
    shellEvent(t, 'Get-Content D:\\projeler\\frogcord\\server\\internal\\store\\attachments.go')
  );
  assert.ok(out, 'expected a deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /outside this worker's brief/);
});

test('allows a shell dump of an absolute path inside scope', () => {
  const dir = tmpDir();
  const t = writeTranscript(dir, 'tester', BRIEF, []);
  assert.strictEqual(
    scopeGuard.handleInput(shellEvent(t, 'Get-Content D:\\projeler\\frogcord\\server\\internal\\api\\dm.go')),
    null
  );
});

test('detects the worker name from the transcript file name', () => {
  assert.strictEqual(scopeGuard.agentNameFromTranscript('C:\\x\\subagents\\agent-atester-7568319be53bd33e.jsonl'), 'tester');
  assert.strictEqual(scopeGuard.agentNameFromTranscript('C:\\x\\subagents\\agent-acoder-istemci-7568319be53bd33e.jsonl'), 'coder-istemci');
  assert.strictEqual(scopeGuard.agentNameFromTranscript('C:\\x\\subagents\\agent-ascout-0123456789abcdef.jsonl'), 'scout');
});

// ---------- cost ledger ----------

test('ledger records a run with cost and verdict', () => {
  const dir = tmpDir();
  const t = writeTranscript(dir, 'tester', BRIEF);
  const outFile = path.join(dir, 'runs.jsonl');
  const prev = process.env.AGENT_CREW_LEDGER;
  process.env.AGENT_CREW_LEDGER = outFile;
  try {
    const row = ledger.handleInput(
      JSON.stringify({ hook_event_name: 'SubagentStop', session_id: 's1', agent_transcript_path: t })
    );
    assert.ok(row, 'expected a ledger row');
    assert.strictEqual(row.agent, 'tester');
    assert.strictEqual(row.turns, 2);
    assert.strictEqual(row.reads, 1);
    assert.strictEqual(row.verdict, 'PASSED');
    assert.ok(row.usd > 0 && row.usd < 1, `unexpected cost ${row.usd}`);
    assert.ok(row.usdOpus > row.usd, 'opus equivalent should be higher');

    const written = fs.readFileSync(outFile, 'utf8').trim().split('\n');
    assert.strictEqual(written.length, 1);
    assert.strictEqual(JSON.parse(written[0]).session, 's1');
  } finally {
    if (prev === undefined) delete process.env.AGENT_CREW_LEDGER;
    else process.env.AGENT_CREW_LEDGER = prev;
  }
});

test('ledger finds the transcript via the session subagents dir and dedupes', () => {
  const dir = tmpDir();
  const sessionId = '73d92c38-6fa0-4417-b62e-059f18561c4c';
  const sessionFile = path.join(dir, sessionId + '.jsonl');
  fs.writeFileSync(sessionFile, '{}\n', 'utf8');
  const sub = path.join(dir, sessionId, 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  const agentFile = path.join(sub, 'agent-atester-0123456789abcdef.jsonl');
  fs.copyFileSync(writeTranscript(tmpDir(), 'tester', BRIEF), agentFile);

  const outFile = path.join(dir, 'runs.jsonl');
  const prev = process.env.AGENT_CREW_LEDGER;
  process.env.AGENT_CREW_LEDGER = outFile;
  try {
    const payload = JSON.stringify({ hook_event_name: 'SubagentStop', session_id: sessionId, transcript_path: sessionFile });
    const row = ledger.handleInput(payload);
    assert.ok(row, 'expected the fallback lookup to find the worker transcript');
    assert.strictEqual(row.agent, 'tester');
    assert.strictEqual(ledger.handleInput(payload), null, 'second stop event must not double count');
    assert.strictEqual(fs.readFileSync(outFile, 'utf8').trim().split('\n').length, 1);
  } finally {
    if (prev === undefined) delete process.env.AGENT_CREW_LEDGER;
    else process.env.AGENT_CREW_LEDGER = prev;
  }
});

test('pricing picks the longest matching model prefix', () => {
  const pricing = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'pricing.json'), 'utf8'));
  assert.strictEqual(ledger.priceFor(pricing, 'claude-haiku-4-5-20251001').out, 5);
  assert.strictEqual(ledger.priceFor(pricing, 'claude-opus-5-5').out, 20);
});
