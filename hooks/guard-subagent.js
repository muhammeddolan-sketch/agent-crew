'use strict';

const path = require('path');

const SHELL_WRAPPERS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'ash',
  'pwsh',
  'powershell',
  'cmd',
]);

const GIT_VALUE_FLAGS = new Set([
  '-c',
  '-C',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
  '--config-env',
  '--exec-path',
  '--list-cmds',
]);

const GIT_BOOL_FLAGS = new Set([
  '-p',
  '--paginate',
  '-P',
  '--no-pager',
  '--bare',
  '--no-replace-objects',
  '--literal-pathspecs',
  '--glob-pathspecs',
  '--noglob-pathspecs',
  '--icase-pathspecs',
  '--no-optional-locks',
  '--html-path',
  '--man-path',
  '--info-path',
  '-v',
  '--version',
  '-h',
  '--help',
]);

const PREFIX_COMMANDS = new Set(['sudo', 'command', 'env', 'time', 'nohup', 'exec', 'timeout']);
const SHELL_KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until']);
const MODE_BASH = 'bash';
const MODE_PS = 'powershell';
const MODE_CMD = 'cmd';

const POWERSHELL_WRAPPERS = new Set(['pwsh', 'powershell']);
const PS_REMOVE_ALIASES = new Set(['remove-item', 'ri', 'rd', 'rmdir', 'del', 'erase']);
const PS_RM_OPERATORS = new Set([
  '-eq', '-ieq', '-ceq',
  '-ne', '-ine', '-cne',
  '-gt', '-igt', '-cgt',
  '-lt', '-ilt', '-clt',
  '-ge', '-ige', '-cge',
  '-le', '-ile', '-cle',
  '-like', '-ilike', '-clike',
  '-notlike', '-inotlike', '-cnotlike',
  '-match', '-imatch', '-cmatch',
  '-notmatch', '-inotmatch', '-cnotmatch',
  '-replace', '-ireplace', '-creplace',
  '-split', '-isplit', '-csplit',
  '-join',
  '-in', '-iin', '-cin',
  '-notin', '-inotin', '-cnotin',
  '-contains', '-icontains', '-ccontains',
  '-notcontains', '-inotcontains', '-cnotcontains',
  '-and', '-or', '-xor', '-not',
  '-band', '-bor', '-bxor', '-bnot',
  '-shl', '-shr',
  '-is', '-isnot', '-as',
]);
const PS_GIT_OPERATORS = new Set([...PS_RM_OPERATORS, '-f']);
const REMOVE_ITEM_SAFE_PARAMS = new Set([
  'path',
  'literalpath',
  'filter',
  'filte',
  'filt',
  'fil',
  'fi',
  'include',
  'exclude',
  'credential',
  'stream',
  'whatif',
  'confirm',
  'verbose',
  'debug',
  'erroraction',
  'warningaction',
  'informationaction',
  'errorvariable',
  'warningvariable',
  'informationvariable',
  'outvariable',
  'outbuffer',
  'pipelinevariable',
  'ea',
  'wa',
  'ev',
  'wv',
  'ov',
  'ob',
  'wi',
  'cf',
]);

function isBashDoubleEscapeNext(ch) {
  return ch === '$' || ch === '`' || ch === '"' || ch === '\\' || ch === '\n';
}

function skipPsBlockComment(str, i, mode) {
  if (mode !== MODE_PS || str[i] !== '<' || str[i + 1] !== '#') return -1;
  if (i > 0 && !/[\s;|&(){}\[\]\r\n,]/.test(str[i - 1])) return -1;
  const closeIdx = str.indexOf('#>', i + 2);
  return closeIdx === -1 ? str.length : closeIdx + 2;
}

function stripLeadingPsTypeCasts(str) {
  let i = 0;
  while (i < str.length) {
    while (i < str.length && /\s/.test(str[i])) i++;
    if (i >= str.length || str[i] !== '[') break;
    let depth = 1;
    let inSingle = false;
    let inDouble = false;
    let escaped = false;
    i++;
    while (i < str.length && depth > 0) {
      const ch = str[i];
      if (escaped) {
        escaped = false;
        i++;
        continue;
      }
      if (inSingle) {
        if (ch === "'") {
          if (str[i + 1] === "'") i++;
          else inSingle = false;
        }
        i++;
        continue;
      }
      if (inDouble) {
        if (ch === '`') escaped = true;
        else if (ch === '"') inDouble = false;
        i++;
        continue;
      }
      if (ch === '`') escaped = true;
      else if (ch === "'") inSingle = true;
      else if (ch === '"') inDouble = true;
      else if (ch === '[') depth++;
      else if (ch === ']') depth--;
      i++;
    }
    if (depth !== 0) return null;
  }
  while (i < str.length && /\s/.test(str[i])) i++;
  return str.slice(i);
}

function parseHeredocOperator(str, ltIndex) {
  let pos = ltIndex + 2;
  let stripTabs = false;
  if (str[pos] === '-') {
    stripTabs = true;
    pos++;
  }
  while (pos < str.length && (str[pos] === ' ' || str[pos] === '\t')) {
    pos++;
  }
  if (pos >= str.length) return null;

  let delim = '';
  let quoted = false;
  let hasDelimChars = false;
  while (pos < str.length) {
    const ch = str[pos];
    if (/[\s;|&()<>\r\n]/.test(ch)) break;
    if (ch === "'" || ch === '"') {
      quoted = true;
      const quoteCh = ch;
      pos++;
      while (pos < str.length && str[pos] !== quoteCh) {
        if (quoteCh === '"' && str[pos] === '\\' && pos + 1 < str.length && isBashDoubleEscapeNext(str[pos + 1])) {
          delim += str[pos + 1];
          pos += 2;
        } else {
          delim += str[pos];
          pos++;
        }
      }
      if (pos < str.length && str[pos] === quoteCh) pos++;
      hasDelimChars = true;
    } else if (ch === '\\') {
      quoted = true;
      pos++;
      if (pos < str.length && str[pos] !== '\n' && str[pos] !== '\r') {
        delim += str[pos];
        pos++;
      }
      hasDelimChars = true;
    } else {
      delim += ch;
      pos++;
      hasDelimChars = true;
    }
  }
  if (!hasDelimChars) return null;
  return { delim, stripTabs, quoted, endPos: pos };
}

function extractUnquotedHeredocSubs(body, nested) {
  let escaped = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      const next = body[i + 1];
      if (next === '$' || next === '`' || next === '\\' || next === '\n') {
        escaped = true;
      }
      continue;
    }
    if (ch === '$' && body[i + 1] === '(') {
      const end = findMatchingParen(body, i + 1, MODE_BASH);
      if (end !== -1) {
        const inner = body.slice(i + 2, end);
        if (inner.trim()) nested.push(inner);
        i = end;
        continue;
      }
    }
    if (ch === '`') {
      const end = findMatchingBacktick(body, i);
      if (end !== -1) {
        const inner = body.slice(i + 1, end);
        if (inner.trim()) nested.push(inner);
        i = end;
        continue;
      }
    }
  }
}

function consumeHeredocs(str, nlIndex, pendingHeredocs, nested) {
  let pos = nlIndex;
  if (str[pos] === '\r' && str[pos + 1] === '\n') {
    pos += 2;
  } else if (pos < str.length && (str[pos] === '\n' || str[pos] === '\r')) {
    pos++;
  }

  for (const hd of pendingHeredocs) {
    let body = '';
    while (pos < str.length) {
      let lineEnd = pos;
      while (lineEnd < str.length && str[lineEnd] !== '\n' && str[lineEnd] !== '\r') {
        lineEnd++;
      }
      const line = str.slice(pos, lineEnd);
      if (lineEnd < str.length) {
        if (str[lineEnd] === '\r' && str[lineEnd + 1] === '\n') {
          pos = lineEnd + 2;
        } else {
          pos = lineEnd + 1;
        }
      } else {
        pos = lineEnd;
      }

      const candidate = hd.stripTabs ? line.replace(/^\t+/, '') : line;
      if (candidate === hd.delim) {
        break;
      }
      body += line + '\n';
    }
    if (!hd.quoted && nested && body) {
      extractUnquotedHeredocSubs(body, nested);
    }
  }
  pendingHeredocs.length = 0;
  return pos;
}

function findMatchingDelimiter(str, openIndex, openCh, closeCh, mode) {
  let depth = 1;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  const pendingHeredocs = [];
  const escapeChar = mode === MODE_PS ? '`' : (mode === MODE_CMD ? '^' : '\\');

  for (let i = openIndex + 1; i < str.length; i++) {
    const ch = str[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        if (mode === MODE_PS && str[i + 1] === "'") {
          i++;
        } else {
          inSingle = false;
        }
      }
      continue;
    }
    if (inDouble) {
      if (mode !== MODE_CMD && ch === escapeChar) {
        if (mode === MODE_PS || isBashDoubleEscapeNext(str[i + 1])) {
          escaped = true;
        }
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    const blockEnd = skipPsBlockComment(str, i, mode);
    if (blockEnd !== -1) {
      i = blockEnd - 1;
      continue;
    }
    if (ch === escapeChar) {
      escaped = true;
    } else if (mode !== MODE_CMD && ch === '#') {
      const prev = i > 0 ? str[i - 1] : '';
      const isBraceParamLen = prev === '{' && i >= 2 && str[i - 2] === '$';
      const commentPrevRe = mode === MODE_PS ? /[\s;|&(){}\r\n]/ : /[\s;|&(\r\n]/;
      if ((i === 0 || commentPrevRe.test(prev)) && !isBraceParamLen) {
        while (i + 1 < str.length && str[i + 1] !== '\n' && str[i + 1] !== '\r') {
          i++;
        }
        continue;
      }
    } else if (mode === MODE_BASH && ch === '<' && str[i + 1] === '<') {
      if (str[i + 2] === '<') {
        i += 2;
        continue;
      }
      const op = parseHeredocOperator(str, i);
      if (op) {
        pendingHeredocs.push(op);
        i = op.endPos - 1;
        continue;
      }
    } else if (mode === MODE_BASH && (ch === '\n' || ch === '\r') && pendingHeredocs.length > 0) {
      i = consumeHeredocs(str, i, pendingHeredocs, null) - 1;
      continue;
    } else if (mode !== MODE_CMD && ch === "'") {
      inSingle = true;
    } else if (ch === '"') {
      inDouble = true;
    } else if (ch === openCh) {
      depth++;
    } else if (ch === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findMatchingParen(str, openIndex, mode) {
  return findMatchingDelimiter(str, openIndex, '(', ')', mode);
}

function findMatchingBrace(str, openIndex, mode) {
  return findMatchingDelimiter(str, openIndex, '{', '}', mode);
}

function findMatchingBacktick(str, openIndex) {
  let escaped = false;
  for (let i = openIndex + 1; i < str.length; i++) {
    const ch = str[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
    } else if (ch === '`') {
      return i;
    }
  }
  return -1;
}

function splitShellSegments(command, mode) {
  const segments = [];
  const nested = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  const pendingHeredocs = [];
  const escapeChar = mode === MODE_PS ? '`' : (mode === MODE_CMD ? '^' : '\\');

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (inSingle) {
      current += ch;
      if (ch === "'") {
        if (mode === MODE_PS && command[i + 1] === "'") {
          current += "'";
          i++;
        } else {
          inSingle = false;
        }
      }
      continue;
    }

    if (inDouble) {
      if (mode !== MODE_CMD && ch === escapeChar) {
        current += ch;
        if (mode === MODE_PS || isBashDoubleEscapeNext(command[i + 1])) {
          escaped = true;
        }
        continue;
      }
      if (mode !== MODE_CMD && ch === '$' && command[i + 1] === '(') {
        const end = findMatchingParen(command, i + 1, mode);
        if (end !== -1) {
          nested.push(command.slice(i + 2, end));
          current += command.slice(i, end + 1);
          i = end;
          continue;
        }
      }
      if (mode === MODE_BASH && ch === '`') {
        const end = findMatchingBacktick(command, i);
        if (end !== -1) {
          nested.push(command.slice(i + 1, end));
          current += command.slice(i, end + 1);
          i = end;
          continue;
        }
      }
      current += ch;
      if (ch === '"') inDouble = false;
      continue;
    }

    const blockEnd = skipPsBlockComment(command, i, mode);
    if (blockEnd !== -1) {
      if (current.length > 0 && !/\s$/.test(current)) {
        current += ' ';
      }
      i = blockEnd - 1;
      continue;
    }

    if (ch === escapeChar) {
      current += ch;
      escaped = true;
      continue;
    }

    if (mode !== MODE_CMD && ch === '#') {
      const prev = i > 0 ? command[i - 1] : '';
      const isBraceParamLen = prev === '{' && i >= 2 && command[i - 2] === '$';
      const commentPrevRe = mode === MODE_PS ? /[\s;|&(){}\r\n]/ : /[\s;|&(\r\n]/;
      if ((i === 0 || commentPrevRe.test(prev)) && !isBraceParamLen) {
        while (i + 1 < command.length && command[i + 1] !== '\n' && command[i + 1] !== '\r') {
          i++;
        }
        continue;
      }
    }

    if (mode !== MODE_CMD && ch === "'") {
      inSingle = true;
      current += ch;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      current += ch;
      continue;
    }

    if (
      mode === MODE_PS &&
      (current.trim() === '' || stripLeadingPsTypeCasts(current.trimStart()) === '')
    ) {
      const paramMatch = command.slice(i).match(/^param\s*\(/i);
      if (paramMatch) {
        const openIdx = i + paramMatch[0].length - 1;
        const end = findMatchingParen(command, openIdx, MODE_PS);
        if (end !== -1) {
          const inner = command.slice(openIdx + 1, end);
          if (inner.trim()) nested.push(inner);
          current = '';
          i = end;
          continue;
        }
      }
    }

    if (mode === MODE_BASH && ch === '<' && command[i + 1] === '<') {
      if (command[i + 2] === '<') {
        current += '<<<';
        i += 2;
        continue;
      }
      const op = parseHeredocOperator(command, i);
      if (op) {
        pendingHeredocs.push(op);
        current += command.slice(i, op.endPos);
        i = op.endPos - 1;
        continue;
      }
    }

    if (mode !== MODE_CMD && ch === '$' && command[i + 1] === '(') {
      const end = findMatchingParen(command, i + 1, mode);
      if (end !== -1) {
        nested.push(command.slice(i + 2, end));
        current += command.slice(i, end + 1);
        i = end;
        continue;
      }
    }

    if (mode === MODE_BASH && (ch === '<' || ch === '>') && command[i + 1] === '(') {
      const end = findMatchingParen(command, i + 1, MODE_BASH);
      if (end !== -1) {
        const inner = command.slice(i + 2, end);
        if (inner.trim()) nested.push(inner);
        current += command.slice(i, end + 1);
        i = end;
        continue;
      }
    }

    if (mode === MODE_PS && ch === '(') {
      const end = findMatchingParen(command, i, MODE_PS);
      if (end !== -1) {
        const inner = command.slice(i + 1, end);
        if (inner.trim()) nested.push(inner);
        current += command.slice(i, end + 1);
        i = end;
        continue;
      }
    }

    if (mode === MODE_BASH && ch === '`') {
      const end = findMatchingBacktick(command, i);
      if (end !== -1) {
        nested.push(command.slice(i + 1, end));
        current += command.slice(i, end + 1);
        i = end;
        continue;
      }
    }

    if (mode === MODE_PS && ch === '{') {
      const prev = i > 0 ? command[i - 1] : '';
      if (prev === '$') {
        const end = findMatchingBrace(command, i, MODE_PS);
        if (end !== -1) {
          current += command.slice(i, end + 1);
          i = end;
          continue;
        }
      } else if (prev !== '@') {
        const end = findMatchingBrace(command, i, MODE_PS);
        if (end !== -1) {
          const inner = command.slice(i + 1, end);
          if (inner.trim()) nested.push(inner);
          i = end;
          continue;
        }
      }
    }

    if ((mode !== MODE_CMD && ch === ';') || ch === '\n' || ch === '\r') {
      if (current.trim()) segments.push(current.trim());
      current = '';
      if (mode === MODE_BASH && (ch === '\n' || ch === '\r') && pendingHeredocs.length > 0) {
        i = consumeHeredocs(command, i, pendingHeredocs, nested) - 1;
      }
      continue;
    }

    if ((ch === '&' && command[i + 1] === '&') || (ch === '|' && command[i + 1] === '|')) {
      if (current.trim()) segments.push(current.trim());
      current = '';
      i++;
      continue;
    }

    if (mode === MODE_BASH && ch === '|' && command[i + 1] === '&') {
      if (current.trim()) segments.push(current.trim());
      current = '';
      i++;
      continue;
    }

    if (ch === '&') {
      const prev = i > 0 ? command[i - 1] : '';
      if (prev === '>' || prev === '<' || (mode === MODE_BASH && command[i + 1] === '>')) {
        current += ch;
        continue;
      }
      if (mode === MODE_PS) {
        const trimmed = current.trim();
        if (trimmed === '') {
          current = '& ';
          continue;
        }
        if (trimmed.endsWith('=') || /(?:^|\s)return$/i.test(trimmed)) {
          segments.push(trimmed);
          current = '& ';
          continue;
        }
        segments.push(trimmed);
        current = '';
        continue;
      }
    }

    if (ch === '|' || ch === '&') {
      if (current.trim()) segments.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim()) segments.push(current.trim());
  return { segments, nested };
}

function tokenizeSegment(segment, mode) {
  const tokens = [];
  const quoted = [];
  const rhsQuoted = [];
  let current = '';
  let hasToken = false;
  let startsQuoted = false;
  let rhsStartsQuoted = false;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  const escapeChar = mode === MODE_PS ? '`' : (mode === MODE_CMD ? '^' : '\\');

  const pushCurrent = () => {
    if (hasToken) {
      tokens.push(current);
      quoted.push(startsQuoted);
      rhsQuoted.push(rhsStartsQuoted);
      current = '';
      hasToken = false;
      startsQuoted = false;
      rhsStartsQuoted = false;
    }
  };

  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];

    if (escaped) {
      current += ch;
      hasToken = true;
      escaped = false;
      continue;
    }

    if (inSingle) {
      if (ch === "'") {
        if (mode === MODE_PS && segment[i + 1] === "'") {
          current += "'";
          i++;
        } else {
          inSingle = false;
        }
      } else {
        current += ch;
      }
      hasToken = true;
      continue;
    }

    if (inDouble) {
      if (mode !== MODE_CMD && ch === escapeChar) {
        if (mode === MODE_PS || isBashDoubleEscapeNext(segment[i + 1])) {
          escaped = true;
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inDouble = false;
      } else {
        current += ch;
      }
      hasToken = true;
      continue;
    }

    const blockEnd = skipPsBlockComment(segment, i, mode);
    if (blockEnd !== -1) {
      pushCurrent();
      i = blockEnd - 1;
      continue;
    }

    if (ch === escapeChar) {
      if (mode === MODE_BASH) {
        const next = segment[i + 1];
        const isSafeNext = (c) => Boolean(c) && !/[\s;|&(){}<>$`'"\\*?\[\]#~=!]/ .test(c);
        if (current === '' && next === '\\' && isSafeNext(segment[i + 2])) {
          current += ch;
          hasToken = true;
          continue;
        }
        const inWinPath =
          /^(?:[A-Za-z]:|\.\.?)$/.test(current) ||
          current === '\\' ||
          /^([A-Za-z]:[\\/]|\\\\|\.\.?\\)/.test(current);
        if (inWinPath && isSafeNext(next)) {
          current += ch;
          hasToken = true;
          continue;
        }
      }
      escaped = true;
      hasToken = true;
      continue;
    }

    if (mode !== MODE_CMD && ch === "'") {
      if (!hasToken) startsQuoted = true;
      else if (mode === MODE_PS && current.endsWith('=')) rhsStartsQuoted = true;
      inSingle = true;
      hasToken = true;
      continue;
    }

    if (ch === '"') {
      if (!hasToken) startsQuoted = true;
      else if (mode === MODE_PS && current.endsWith('=')) rhsStartsQuoted = true;
      inDouble = true;
      hasToken = true;
      continue;
    }

    if (/\s/.test(ch)) {
      pushCurrent();
      continue;
    }

    if (mode === MODE_PS && ch === '{' && !startsQuoted && (current === '$' || /\]\$$/.test(current))) {
      const end = findMatchingBrace(segment, i, MODE_PS);
      if (end !== -1) {
        current += segment.slice(i, end + 1);
        i = end;
        hasToken = true;
        continue;
      }
    }

    if (ch === '(' || ch === ')' || (mode !== MODE_CMD && (ch === '{' || ch === '}'))) {
      pushCurrent();
      continue;
    }

    current += ch;
    hasToken = true;
  }

  pushCurrent();
  return { tokens, quoted, rhsQuoted };
}

function normalizeCmdName(token) {
  const base = path.posix.basename(token.replace(/\\/g, '/')).toLowerCase();
  return base.endsWith('.exe') ? base.slice(0, -4) : base;
}

function isEnvAssignment(token) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

const PS_VAR_RE = /^(?:\$(?:[A-Za-z_][A-Za-z0-9_]*:)?[A-Za-z_][A-Za-z0-9_]*|\$\{[^}]+\})$/;
const PS_ASSIGN_OP_RE = /^([+\-*/%]?=)(?!=)(.*)$/;
const PS_ASSIGN_RE = /^(?:\$(?:[A-Za-z_][A-Za-z0-9_]*:)?[A-Za-z_][A-Za-z0-9_]*|\$\{[^}]+\})([+\-*/%]?=)(?!=)(.*)$/;
const BASH_REDIR_OP_ONLY_RE = /^(?:\d*(?:>>?|<<?-?|<>|>&|<&|>\||<<<)|&>>?)$/;
const BASH_REDIR_WITH_TARGET_RE = /^(?:\d*(?:>>?|<<?-?|<>|>&|<&|>\||<<<)|&>>?).+$/;
const CMD_REDIR_OP_ONLY_RE = /^(?:\d*(?:>>?|<<?)|>&|<&)$/;
const CMD_REDIR_WITH_TARGET_RE = /^(?:\d*(?:>>?|<<?)|>&|<&).+$/;

function findEndOfPsCastTokens(list, qList, startIdx) {
  let k = startIdx;
  while (k < list.length && !qList[k] && list[k].startsWith('[')) {
    let depth = 0;
    let closedAt = -1;
    let finished = false;
    while (k < list.length && !qList[k]) {
      const tok = list[k];
      for (let c = 0; c < tok.length; c++) {
        if (tok[c] === '[') depth++;
        else if (tok[c] === ']') {
          depth--;
          if (depth === 0) {
            closedAt = c;
            const rest = tok.slice(c + 1);
            if (rest.startsWith('[')) continue;
            if (rest.length > 0) {
              finished = true;
            }
            break;
          }
        }
      }
      if (finished) {
        return { endTokenIdx: k, remainder: tok.slice(closedAt + 1) };
      }
      if (depth === 0) {
        k++;
        break;
      }
      k++;
    }
    if (depth !== 0) return null;
  }
  return k > startIdx ? { endTokenIdx: k, remainder: null } : null;
}

function stripPrefixes(rawResult, mode) {
  const list = rawResult.tokens.slice();
  const qList = rawResult.quoted.slice();
  const rhsQList = rawResult.rhsQuoted.slice();
  let idx = 0;
  let invokedByCallOp = false;

  while (idx < list.length) {
    const tok = list[idx];
    const isQuoted = qList[idx];

    if (mode === MODE_BASH && !isQuoted) {
      if (BASH_REDIR_OP_ONLY_RE.test(tok)) {
        idx += 2;
        continue;
      }
      if (BASH_REDIR_WITH_TARGET_RE.test(tok)) {
        idx++;
        continue;
      }
    } else if (mode === MODE_CMD && !isQuoted) {
      if (CMD_REDIR_OP_ONLY_RE.test(tok)) {
        idx += 2;
        continue;
      }
      if (CMD_REDIR_WITH_TARGET_RE.test(tok)) {
        idx++;
        continue;
      }
      if (tok === '@') {
        idx++;
        continue;
      }
      if (tok.startsWith('@') && tok.length > 1) {
        list[idx] = tok.slice(1);
        qList[idx] = false;
        continue;
      }
      if (tok.toLowerCase() === 'call') {
        idx++;
        continue;
      }
    } else if (mode === MODE_PS && !isQuoted) {
      if (tok === '&' || tok === '.') {
        invokedByCallOp = true;
        idx++;
        continue;
      }
      if (tok.startsWith('[')) {
        const castInfo = findEndOfPsCastTokens(list, qList, idx);
        if (castInfo) {
          if (castInfo.remainder !== null && castInfo.remainder.length > 0) {
            const rem = castInfo.remainder;
            const rIdx = castInfo.endTokenIdx;
            if (
              PS_VAR_RE.test(rem) &&
              rIdx + 1 < list.length &&
              !qList[rIdx + 1] &&
              PS_ASSIGN_OP_RE.test(list[rIdx + 1])
            ) {
              const opMatch = list[rIdx + 1].match(PS_ASSIGN_OP_RE);
              invokedByCallOp = false;
              if (opMatch[2]) {
                list[rIdx + 1] = opMatch[2];
                qList[rIdx + 1] = rhsQList[rIdx + 1];
                idx = rIdx + 1;
              } else {
                idx = rIdx + 2;
              }
              continue;
            }
            const remAssignMatch = rem.match(PS_ASSIGN_RE);
            if (remAssignMatch) {
              invokedByCallOp = false;
              if (remAssignMatch[2]) {
                list[rIdx] = remAssignMatch[2];
                qList[rIdx] = rhsQList[rIdx];
                idx = rIdx;
              } else {
                idx = rIdx + 1;
              }
              continue;
            }
          } else {
            const nextIdx = castInfo.endTokenIdx;
            if (nextIdx < list.length && !qList[nextIdx]) {
              const nextTok = list[nextIdx];
              if (
                PS_VAR_RE.test(nextTok) &&
                nextIdx + 1 < list.length &&
                !qList[nextIdx + 1] &&
                PS_ASSIGN_OP_RE.test(list[nextIdx + 1])
              ) {
                const opMatch = list[nextIdx + 1].match(PS_ASSIGN_OP_RE);
                invokedByCallOp = false;
                if (opMatch[2]) {
                  list[nextIdx + 1] = opMatch[2];
                  qList[nextIdx + 1] = rhsQList[nextIdx + 1];
                  idx = nextIdx + 1;
                } else {
                  idx = nextIdx + 2;
                }
                continue;
              }
              const nextAssignMatch = nextTok.match(PS_ASSIGN_RE);
              if (nextAssignMatch) {
                invokedByCallOp = false;
                if (nextAssignMatch[2]) {
                  list[nextIdx] = nextAssignMatch[2];
                  qList[nextIdx] = rhsQList[nextIdx];
                  idx = nextIdx;
                } else {
                  idx = nextIdx + 1;
                }
                continue;
              }
            }
          }
        }
      }
      if (PS_VAR_RE.test(tok) && idx + 1 < list.length && !qList[idx + 1]) {
        const opMatch = list[idx + 1].match(PS_ASSIGN_OP_RE);
        if (opMatch) {
          invokedByCallOp = false;
          if (opMatch[2]) {
            list[idx + 1] = opMatch[2];
            qList[idx + 1] = rhsQList[idx + 1];
            idx++;
          } else {
            idx += 2;
          }
          continue;
        }
      }
      const psAssignMatch = tok.match(PS_ASSIGN_RE);
      if (psAssignMatch) {
        invokedByCallOp = false;
        if (psAssignMatch[2]) {
          list[idx] = psAssignMatch[2];
          qList[idx] = rhsQList[idx];
        } else {
          idx++;
        }
        continue;
      }
    }

    if (mode === MODE_PS && isQuoted && !invokedByCallOp) {
      break;
    }

    if (
      mode !== MODE_CMD &&
      !isQuoted &&
      (tok === '!' || (mode === MODE_BASH && isEnvAssignment(tok)) || SHELL_KEYWORDS.has(tok.toLowerCase()))
    ) {
      idx++;
      continue;
    }

    const name = normalizeCmdName(tok);
    if (PREFIX_COMMANDS.has(name) && !(mode === MODE_PS && isQuoted && !invokedByCallOp)) {
      idx++;
      if (name === 'timeout') {
        while (idx < list.length && list[idx].startsWith('-')) {
          if (list[idx] === '--') {
            idx++;
            break;
          }
          if (
            list[idx] === '-k' ||
            list[idx] === '--kill-after' ||
            list[idx] === '-s' ||
            list[idx] === '--signal'
          ) {
            idx += 2;
          } else {
            idx++;
          }
        }
        if (idx < list.length && list[idx] !== '--') {
          idx++;
        }
        continue;
      }
      let envSplits = 0;
      while (idx < list.length && (list[idx].startsWith('-') || isEnvAssignment(list[idx]))) {
        const flag = list[idx];
        if (flag === '--') {
          idx++;
          break;
        }
        if (
          (name === 'sudo' || name === 'env') &&
          (flag === '-u' || flag === '--user')
        ) {
          idx += 2;
        } else if (
          name === 'env' &&
          (flag === '-C' || flag === '--chdir' || flag === '--unset')
        ) {
          idx += 2;
        } else if (name === 'env' && envSplits < 10) {
          let splitPayload = null;
          let consumeCount = 0;
          if (flag === '--split-string' || /^-[A-Za-z]*S$/.test(flag)) {
            if (idx + 1 < list.length) {
              splitPayload = list[idx + 1];
              consumeCount = 2;
            } else {
              idx++;
              break;
            }
          } else if (flag.startsWith('--split-string=')) {
            splitPayload = flag.slice('--split-string='.length);
            consumeCount = 1;
          } else if (/^-[A-Za-z]*S.+$/.test(flag)) {
            const sIdx = flag.indexOf('S');
            splitPayload = flag.slice(sIdx + 1);
            if (splitPayload.startsWith('=')) splitPayload = splitPayload.slice(1);
            consumeCount = 1;
          }
          if (consumeCount > 0) {
            envSplits++;
            const subTok = tokenizeSegment(splitPayload, MODE_BASH);
            list.splice(idx, consumeCount, ...subTok.tokens);
            qList.splice(idx, consumeCount, ...subTok.quoted);
            rhsQList.splice(idx, consumeCount, ...subTok.rhsQuoted);
            continue;
          }
          idx++;
        } else if (name === 'exec' && flag === '-a') {
          idx += 2;
        } else {
          idx++;
        }
      }
      continue;
    }
    break;
  }

  return {
    tokens: list.slice(idx),
    quoted: qList.slice(idx),
    invokedByCallOp,
  };
}

function checkGitTokens(args, mode) {
  let i = 0;
  while (i < args.length) {
    const tok = args[i];
    if (tok === '--') break;
    if (mode === MODE_PS && PS_GIT_OPERATORS.has(tok.toLowerCase())) {
      return null;
    }
    if (GIT_VALUE_FLAGS.has(tok)) {
      i += 2;
      continue;
    }
    if (
      tok.startsWith('-C') ||
      tok.startsWith('-c') ||
      tok.startsWith('--git-dir=') ||
      tok.startsWith('--work-tree=') ||
      tok.startsWith('--namespace=') ||
      tok.startsWith('--super-prefix=') ||
      tok.startsWith('--config-env=') ||
      tok.startsWith('--exec-path=')
    ) {
      i++;
      continue;
    }
    if (GIT_BOOL_FLAGS.has(tok) || tok.startsWith('-')) {
      i++;
      continue;
    }
    const subcmd = tok.toLowerCase();
    if (subcmd === 'commit') return 'git commit';
    if (subcmd === 'push') return 'git push';
    if (subcmd === 'reset') {
      for (let j = i + 1; j < args.length; j++) {
        if (args[j] === '--') break;
        if (args[j].toLowerCase() === '--hard') return 'git reset --hard';
      }
    }
    return null;
  }
  return null;
}

function checkRmTokens(args, argQuoted, cmd, mode) {
  let hasR = false;
  let hasF = false;
  let hasWhatIf = false;
  let hasWhatIfFalse = false;
  const isRemoveItem = PS_REMOVE_ALIASES.has(cmd);
  const isCmdRd = mode === MODE_CMD && (cmd === 'rd' || cmd === 'rmdir');

  for (let j = 0; j < args.length; j++) {
    const tok = args[j];
    const isQuoted = Boolean(argQuoted[j]);
    if (tok === '--') break;

    if (isCmdRd) {
      if (!isQuoted && tok.startsWith('/')) {
        const switches = tok.slice(1).toLowerCase().split('/');
        if (switches.length > 0 && switches.every((s) => s === 's' || s === 'q')) {
          if (switches.includes('s')) hasR = true;
          if (switches.includes('q')) hasF = true;
        }
      }
      continue;
    }

    if (mode === MODE_PS && !isQuoted && PS_RM_OPERATORS.has(tok.toLowerCase())) {
      break;
    }

    if (mode === MODE_PS && isQuoted) {
      continue;
    }

    if (tok.startsWith('--')) {
      const lower = tok.toLowerCase();
      if (lower === '--recursive') hasR = true;
      else if (lower === '--force') hasF = true;
    } else if (tok.startsWith('-') && tok.length > 1) {
      const colonIdx = tok.indexOf(':');
      const flagBody = colonIdx === -1 ? tok.slice(1) : tok.slice(1, colonIdx);
      const colonVal = colonIdx === -1 ? null : tok.slice(colonIdx + 1).toLowerCase();
      const lower = flagBody.toLowerCase();

      if ((isRemoveItem || mode === MODE_PS) && /^(?:wi|wh(?:a(?:t(?:i(?:f)?)?)?)?)$/.test(lower)) {
        if (
          colonVal === null ||
          colonVal === '$true' ||
          colonVal === 'true' ||
          colonVal === '1' ||
          colonVal === '$1'
        ) {
          hasWhatIf = true;
        } else {
          hasWhatIfFalse = true;
        }
        continue;
      }

      if (colonVal === '$false' || colonVal === 'false' || colonVal === '0' || colonVal === '$0') {
        continue;
      }

      if (/^r(e(c(u(r(s(e)?)?)?)?)?)?$/.test(lower)) {
        hasR = true;
      } else if (/^fo(r(c(e)?)?)?$/.test(lower)) {
        hasF = true;
      } else if (!isRemoveItem && lower === 'f') {
        hasF = true;
      } else if (!isRemoveItem && !REMOVE_ITEM_SAFE_PARAMS.has(lower) && /^[rfivdpxw]+$/i.test(flagBody)) {
        if (/[rR]/.test(flagBody)) hasR = true;
        if (/[fF]/.test(flagBody)) hasF = true;
      }
    }
  }

  if (hasWhatIf && !hasWhatIfFalse) return null;
  if (!hasR || !hasF) return null;
  return isRemoveItem ? 'Remove-Item -Recurse -Force' : 'rm -rf';
}

function stripOuterBraces(str) {
  const trimmed = str.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function findBlockedCommand(rootCommand, initialMode) {
  const queue = [{ command: rootCommand, mode: initialMode }];
  const visited = new Set();

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || !item.command) continue;
    const visitKey = `${item.mode}:${item.command}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);

    const { segments, nested } = splitShellSegments(item.command, item.mode);
    for (const sub of nested) {
      queue.push({ command: sub, mode: item.mode });
    }

    for (const seg of segments) {
      const rawResult = tokenizeSegment(seg, item.mode);
      const { tokens, quoted, invokedByCallOp } = stripPrefixes(rawResult, item.mode);
      if (tokens.length === 0) continue;

      if (item.mode === MODE_PS && quoted[0] && !invokedByCallOp) {
        continue;
      }

      let cmd = normalizeCmdName(tokens[0]);
      let args = tokens.slice(1);
      let argQuoted = quoted.slice(1);

      if (item.mode === MODE_CMD && !quoted[0]) {
        const rdMatch = tokens[0].match(/^(rd|rmdir)(\/.*)$/i);
        if (rdMatch) {
          cmd = rdMatch[1].toLowerCase();
          args = [rdMatch[2], ...args];
          argQuoted = [false, ...argQuoted];
        }
      }

      if (SHELL_WRAPPERS.has(cmd)) {
        if (cmd === 'cmd') {
          for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            const cmdMatch = arg.match(/^(?:\/(?:[audqsyx]|[efv]:(?:on|off)|t:[0-9a-f]{1,2}))*\/([ckr])(.*)$/i);
            if (cmdMatch) {
              const remainder = cmdMatch[2];
              const tail = args.slice(i + 1);
              const payload = remainder ? [remainder, ...tail].join(' ') : tail.join(' ');
              if (payload.trim()) {
                queue.push({ command: payload, mode: MODE_CMD });
              }
              break;
            }
          }
        } else if (POWERSHELL_WRAPPERS.has(cmd)) {
          for (let i = 0; i < args.length; i++) {
            const lower = args[i].toLowerCase();
            if (/^-(?:c|co|com|comm|comma|comman|command)$/i.test(lower)) {
              let startIdx = i + 1;
              if (args[startIdx] === '--') startIdx++;
              if (startIdx < args.length) {
                const rawInner = args.length === startIdx + 1
                  ? args[startIdx]
                  : args.slice(startIdx).join(' ');
                queue.push({ command: stripOuterBraces(rawInner), mode: MODE_PS });
              }
              break;
            }
          }
        } else {
          for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            const lower = arg.toLowerCase();
            if (lower === '-c' || /^-[a-z]*c[a-z]*$/i.test(arg)) {
              let startIdx = i + 1;
              while (
                startIdx < args.length &&
                (args[startIdx].startsWith('-') || args[startIdx].startsWith('+')) &&
                args[startIdx] !== '--' &&
                args[startIdx] !== '-' &&
                args[startIdx] !== '+'
              ) {
                if (/^[-+][a-zA-Z]*[oO]$/.test(args[startIdx])) {
                  startIdx += 2;
                } else {
                  startIdx++;
                }
              }
              if (args[startIdx] === '--' || args[startIdx] === '-' || args[startIdx] === '+') {
                startIdx++;
              }
              if (startIdx < args.length) {
                queue.push({ command: args[startIdx], mode: MODE_BASH });
              }
              break;
            }
          }
        }
        continue;
      }

      if (cmd === 'git') {
        const hit = checkGitTokens(args, item.mode);
        if (hit) return hit;
      } else if (
        cmd === 'rm' ||
        cmd === 'remove-item' ||
        cmd === 'ri' ||
        (item.mode === MODE_PS && PS_REMOVE_ALIASES.has(cmd)) ||
        (item.mode === MODE_CMD && (cmd === 'rd' || cmd === 'rmdir'))
      ) {
        const hit = checkRmTokens(args, argQuoted, cmd, item.mode);
        if (hit) return hit;
      }
    }
  }

  return null;
}

function handleInput(raw) {
  if (!raw || !raw.trim()) return;

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }

  if (!input || typeof input !== 'object') return;

  const isSubagent =
    Boolean(input.agent_id) ||
    (typeof input.transcript_path === 'string' &&
      /[\\\/]subagents[\\\/]/i.test(input.transcript_path));

  if (!isSubagent) return;

  if (input.tool_name && input.tool_name !== 'Bash' && input.tool_name !== 'PowerShell') {
    return;
  }

  const command = input.tool_input && typeof input.tool_input.command === 'string'
    ? input.tool_input.command
    : '';

  if (!command.trim()) return;

  const initialMode = input.tool_name === 'PowerShell' ? MODE_PS : MODE_BASH;
  const blocked = findBlockedCommand(command, initialMode);
  if (!blocked) return;

  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Blocked in subagent (${blocked}): commits, pushes, hard resets, and recursive forced deletions require chief/user approval.`,
    },
  };

  process.stdout.write(JSON.stringify(output) + '\n');
}

const chunks = [];
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
  handleInput(chunks.join(''));
  process.exit(0);
});
process.stdin.on('error', () => {
  process.exit(0);
});
