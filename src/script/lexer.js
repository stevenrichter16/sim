import { createPosition, createSpan } from './span.js';

const KEYWORDS = new Map([
  ['fn', 'FN'],
  ['let', 'LET'],
  ['return', 'RETURN'],
  ['if', 'IF'],
  ['else', 'ELSE'],
  ['while', 'WHILE'],
  ['call', 'CALL'],
  ['schedule', 'SCHEDULE'],
  ['true', 'TRUE'],
  ['false', 'FALSE'],
  ['null', 'NULL'],
  ['onInit', 'ON_INIT'],
  ['onTick', 'ON_TICK'],
]);

const SINGLE_TOKENS = new Map([
  ['(', 'LEFT_PAREN'],
  [')', 'RIGHT_PAREN'],
  ['{', 'LEFT_BRACE'],
  ['}', 'RIGHT_BRACE'],
  [',', 'COMMA'],
  ['.', 'DOT'],
  [';', 'SEMICOLON'],
  ['+', 'PLUS'],
  ['-', 'MINUS'],
  ['*', 'STAR'],
  ['/', 'SLASH'],
  ['%', 'PERCENT'],
  ['?', 'QUESTION'],
  [':', 'COLON'],
]);

const DOUBLE_TOKENS = new Map([
  ['=', { match: '=', type: 'EQUAL_EQUAL', fallback: 'EQUAL' }],
  ['!', { match: '=', type: 'BANG_EQUAL', fallback: 'BANG' }],
  ['<', { match: '=', type: 'LESS_EQUAL', fallback: 'LESS' }],
  ['>', { match: '=', type: 'GREATER_EQUAL', fallback: 'GREATER' }],
  ['&', { match: '&', type: 'AND_AND', fallback: 'AMPERSAND' }],
  ['|', { match: '|', type: 'OR_OR', fallback: 'PIPE' }],
]);

export function lex(source) {
  const tokens = [];
  const diagnostics = [];
  let index = 0;
  let line = 1;
  let column = 1;

  function currentChar() {
    return source[index];
  }

  function makeSpan(startIndex, startLine, startColumn, endIndex = index, endLine = line, endColumn = column) {
    return createSpan(createPosition(startIndex, startLine, startColumn), createPosition(endIndex, endLine, endColumn));
  }

  function advance() {
    const char = source[index++];
    if (char === '\n') {
      line += 1;
      column = 1;
    } else if (char === '\r') {
      if (source[index] === '\n') {
        index++;
        line += 1;
        column = 1;
        return '\n';
      }
      line += 1;
      column = 1;
      return '\n';
    } else {
      column += 1;
    }
    return char;
  }

  function addToken(type, lexeme, literal, span) {
    tokens.push({ type, lexeme, literal, span });
  }

  function addDiagnostic(message, span) {
    diagnostics.push({ message, span });
  }

  function match(expected) {
    if (index >= source.length) return false;
    if (source[index] !== expected) return false;
    advance();
    return true;
  }

  function scanNumber(startIndex, startLine, startColumn, firstChar) {
    let value = firstChar;
    while (/[0-9]/.test(currentChar())) {
      value += advance();
    }
    if (currentChar() === '.' && /[0-9]/.test(source[index + 1])) {
      value += advance();
      while (/[0-9]/.test(currentChar())) {
        value += advance();
      }
    }
    const span = makeSpan(startIndex, startLine, startColumn);
    addToken('NUMBER', value, Number(value), span);
  }

  function scanIdentifier(startIndex, startLine, startColumn, firstChar) {
    let value = firstChar;
    while (/[0-9A-Za-z_]/.test(currentChar())) {
      value += advance();
    }
    const type = KEYWORDS.get(value) ?? 'IDENTIFIER';
    const span = makeSpan(startIndex, startLine, startColumn);
    addToken(type, value, value, span);
  }

  function scanString(startIndex, startLine, startColumn) {
    let value = '';
    let terminated = false;
    while (index < source.length) {
      const char = currentChar();
      if (char === '\"') {
        advance();
        terminated = true;
        break;
      }
      if (char === '\n' || char === '\r') {
        break;
      }
      if (char === '\\') {
        advance();
        const next = currentChar();
        switch (next) {
          case 'n':
            advance();
            value += '\n';
            continue;
          case 't':
            advance();
            value += '\t';
            continue;
          case '"':
            advance();
            value += '"';
            continue;
          case '\\':
            advance();
            value += '\\';
            continue;
          default:
            value += '\\';
            value += advance();
            continue;
        }
      }
      value += advance();
    }

    const span = makeSpan(startIndex, startLine, startColumn);
    if (!terminated) {
      addDiagnostic('Unterminated string literal.', span);
      return;
    }
    addToken('STRING', source.slice(startIndex + 1, index - 1), value, span);
  }

  while (index < source.length) {
    const startIndex = index;
    const startLine = line;
    const startColumn = column;
    const char = advance();

    if (char === undefined) break;

    if (char === ' ' || char === '\t' || char === '\f' || char === '\v') {
      continue;
    }

    if (char === '\n') {
      continue;
    }

    if (char === '/') {
      if (match('/')) {
        while (index < source.length && currentChar() !== '\n' && currentChar() !== '\r') {
          advance();
        }
        continue;
      }
      addToken('SLASH', '/', null, makeSpan(startIndex, startLine, startColumn));
      continue;
    }

    if (SINGLE_TOKENS.has(char)) {
      addToken(SINGLE_TOKENS.get(char), char, null, makeSpan(startIndex, startLine, startColumn));
      continue;
    }

    if (DOUBLE_TOKENS.has(char)) {
      const info = DOUBLE_TOKENS.get(char);
      const type = match(info.match) ? info.type : info.fallback;
      const span = makeSpan(startIndex, startLine, startColumn);
      addToken(type, source.slice(startIndex, index), null, span);
      continue;
    }

    if (/[0-9]/.test(char)) {
      scanNumber(startIndex, startLine, startColumn, char);
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      scanIdentifier(startIndex, startLine, startColumn, char);
      continue;
    }

    if (char === '"') {
      scanString(startIndex, startLine, startColumn);
      continue;
    }

    addDiagnostic(`Unexpected character '${char}'.`, makeSpan(startIndex, startLine, startColumn));
  }

  const eofSpan = makeSpan(index, line, column);
  addToken('EOF', '', null, eofSpan);

  return { tokens, diagnostics };
}
