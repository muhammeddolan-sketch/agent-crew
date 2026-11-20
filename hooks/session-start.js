'use strict';

const fs = require('fs');
const path = require('path');

try {
  const rulesPath = path.join(__dirname, 'chief-rules.md');
  const content = fs.readFileSync(rulesPath, 'utf8');

  const payload = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: content,
    },
  };

  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (err) {
  process.stderr.write(`agent-crew SessionStart hook warning: ${err.message}\n`);
}

process.exit(0);
