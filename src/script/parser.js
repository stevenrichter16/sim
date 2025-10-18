import { lex } from './lexer.js';
import { emptySpan, mergeSpans } from './span.js';

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.current = 0;
    this.diagnostics = [];
    this.scopeDepth = 0;
  }

  parseProgram() {
    const statements = [];
    const startSpan = this.peek()?.span ?? emptySpan();
    while (!this.isAtEnd()) {
      if (this.check('EOF')) break;
      if (this.match('FN')) {
        statements.push(this.parseFunctionDeclaration());
      } else {
        statements.push(this.parseStatement());
      }
    }
    let span = emptySpan();
    if (statements.length > 0) {
      span = mergeSpans(statements[0].span, statements[statements.length - 1].span);
    } else if (startSpan) {
      span = startSpan;
    }
    return { type: 'Program', body: statements, span };
  }

  parseFunctionDeclaration() {
    const fnToken = this.previous();
    const nameToken = this.consumeFunctionName();
    const params = this.parseParameterList();
    const openBrace = this.consume('LEFT_BRACE', 'Expected "{" before function body.');
    const body = this.parseBlockFromBrace(openBrace);
    let type = 'FunctionDeclaration';
    if (nameToken.type === 'ON_INIT') type = 'OnInitDeclaration';
    if (nameToken.type === 'ON_TICK') type = 'OnTickDeclaration';
    const span = mergeSpans(fnToken.span, body?.span ?? nameToken.span);
    return {
      type,
      name: nameToken.lexeme,
      nameSpan: nameToken.span,
      params,
      body,
      span,
    };
  }

  parseParameterList() {
    this.consume('LEFT_PAREN', 'Expected "(" after function name.');
    const params = [];
    if (!this.check('RIGHT_PAREN')) {
      do {
        const token = this.consumeIdentifier('Expected parameter name.');
        params.push({ type: 'Identifier', name: token.lexeme, span: token.span });
      } while (this.match('COMMA'));
    }
    this.consume('RIGHT_PAREN', 'Expected ")" after parameter list.');
    return params;
  }

  parseStatement() {
    if (this.match('LET')) {
      return this.parseLetStatement(this.previous());
    }
    if (this.match('RETURN')) {
      return this.parseReturnStatement(this.previous());
    }
    if (this.match('IF')) {
      return this.parseIfStatement(this.previous());
    }
    if (this.match('WHILE')) {
      return this.parseWhileStatement(this.previous());
    }
    if (this.match('SCHEDULE')) {
      return this.parseScheduleStatement(this.previous());
    }
    if (this.match('LEFT_BRACE')) {
      return this.parseBlockFromBrace(this.previous());
    }
    return this.parseExpressionStatement();
  }

  parseLetStatement(letToken) {
    const nameToken = this.consumeIdentifier('Expected variable name after "let".');
    let initializer = null;
    if (this.match('EQUAL')) {
      initializer = this.parseExpression();
    }
    const semicolon = this.consume('SEMICOLON', 'Expected ";" after variable declaration.');
    const span = mergeSpans(letToken.span, semicolon.span ?? nameToken.span);
    return {
      type: 'LetStatement',
      name: { type: 'Identifier', name: nameToken.lexeme, span: nameToken.span },
      initializer,
      isGlobal: this.scopeDepth === 0,
      span,
    };
  }

  parseReturnStatement(returnToken) {
    let value = null;
    if (!this.check('SEMICOLON')) {
      value = this.parseExpression();
    }
    const semicolon = this.consume('SEMICOLON', 'Expected ";" after return statement.');
    const span = value ? mergeSpans(returnToken.span, value.span) : mergeSpans(returnToken.span, semicolon.span);
    return { type: 'ReturnStatement', argument: value, span };
  }

  parseIfStatement(ifToken) {
    this.consume('LEFT_PAREN', 'Expected "(" after "if".');
    const test = this.parseExpression();
    this.consume('RIGHT_PAREN', 'Expected ")" after if condition.');
    const consequent = this.parseStatement();
    let alternate = null;
    if (this.match('ELSE')) {
      alternate = this.parseStatement();
    }
    let span = mergeSpans(ifToken.span, consequent.span);
    if (alternate) {
      span = mergeSpans(span, alternate.span);
    }
    return { type: 'IfStatement', test, consequent, alternate, span };
  }

  parseWhileStatement(whileToken) {
    this.consume('LEFT_PAREN', 'Expected "(" after "while".');
    const test = this.parseExpression();
    this.consume('RIGHT_PAREN', 'Expected ")" after while condition.');
    const body = this.parseStatement();
    const span = mergeSpans(whileToken.span, body.span);
    return { type: 'WhileStatement', test, body, span };
  }

  parseScheduleStatement(scheduleToken) {
    this.consume('LEFT_PAREN', 'Expected "(" after "schedule".');
    const delay = this.parseExpression();
    this.consume('COMMA', 'Expected "," between schedule arguments.');
    const task = this.parseExpression();
    const close = this.consume('RIGHT_PAREN', 'Expected ")" after schedule arguments.');
    const semicolon = this.consume('SEMICOLON', 'Expected ";" after schedule call.');
    const span = mergeSpans(scheduleToken.span, semicolon.span ?? close.span);
    return { type: 'ScheduleStatement', delay, task, span };
  }

  parseExpressionStatement() {
    const expression = this.parseExpression();
    const semicolon = this.consume('SEMICOLON', 'Expected ";" after expression.');
    const span = mergeSpans(expression.span, semicolon.span ?? expression.span);
    return { type: 'ExpressionStatement', expression, span };
  }

  parseExpression() {
    return this.parseAssignment();
  }

  parseAssignment() {
    const left = this.parseLogicalOr();
    if (this.match('EQUAL')) {
      const equals = this.previous();
      const value = this.parseAssignment();
      if (left.type === 'Identifier') {
        const span = mergeSpans(left.span, value.span);
        return { type: 'AssignmentExpression', target: left, value, span };
      }
      this.error(equals, 'Invalid assignment target.');
    }
    return left;
  }

  parseLogicalOr() {
    return this.parseBinary(this.parseLogicalAnd.bind(this), ['OR_OR']);
  }

  parseLogicalAnd() {
    return this.parseBinary(this.parseEquality.bind(this), ['AND_AND']);
  }

  parseEquality() {
    return this.parseBinary(this.parseComparison.bind(this), ['EQUAL_EQUAL', 'BANG_EQUAL']);
  }

  parseComparison() {
    return this.parseBinary(this.parseTerm.bind(this), ['GREATER', 'GREATER_EQUAL', 'LESS', 'LESS_EQUAL']);
  }

  parseTerm() {
    return this.parseBinary(this.parseFactor.bind(this), ['PLUS', 'MINUS']);
  }

  parseFactor() {
    return this.parseBinary(this.parseUnary.bind(this), ['STAR', 'SLASH', 'PERCENT']);
  }

  parseUnary() {
    if (this.match('BANG', 'MINUS')) {
      const operator = this.previous();
      const argument = this.parseUnary();
      const span = mergeSpans(operator.span, argument.span);
      return { type: 'UnaryExpression', operator: operator.type, argument, span };
    }
    return this.parseCall();
  }

  parseCall() {
    let expression = this.parsePrimary();
    while (true) {
      if (this.match('LEFT_PAREN')) {
        const open = this.previous();
        expression = this.finishCallExpression(expression, open);
        continue;
      }
      break;
    }
    return expression;
  }

  finishCallExpression(callee, openToken) {
    const args = [];
    if (!this.check('RIGHT_PAREN')) {
      do {
        args.push(this.parseExpression());
      } while (this.match('COMMA'));
    }
    const close = this.consume('RIGHT_PAREN', 'Expected ")" after call arguments.');
    const span = mergeSpans(callee.span ?? openToken.span, close.span ?? openToken.span);
    return { type: 'CallExpression', callee, arguments: args, span };
  }

  parsePrimary() {
    if (this.match('NUMBER')) {
      const token = this.previous();
      return { type: 'NumberLiteral', value: Number(token.lexeme), span: token.span };
    }
    if (this.match('STRING')) {
      const token = this.previous();
      return { type: 'StringLiteral', value: token.literal, span: token.span };
    }
    if (this.match('TRUE')) {
      const token = this.previous();
      return { type: 'BooleanLiteral', value: true, span: token.span };
    }
    if (this.match('FALSE')) {
      const token = this.previous();
      return { type: 'BooleanLiteral', value: false, span: token.span };
    }
    if (this.match('NULL')) {
      const token = this.previous();
      return { type: 'NullLiteral', value: null, span: token.span };
    }
    if (this.match('CALL')) {
      return this.parseNativeCall(this.previous());
    }
    if (this.match('IDENTIFIER', 'ON_INIT', 'ON_TICK')) {
      const token = this.previous();
      return { type: 'Identifier', name: token.lexeme, span: token.span };
    }
    if (this.match('LEFT_PAREN')) {
      const open = this.previous();
      const expression = this.parseExpression();
      const close = this.consume('RIGHT_PAREN', 'Expected ")" after expression.');
      const span = mergeSpans(open.span, close.span ?? expression.span);
      return { type: 'GroupingExpression', expression, span };
    }
    const token = this.peek();
    this.error(token, 'Unexpected token.');
    this.advance();
    return { type: 'NullLiteral', value: null, span: token?.span ?? emptySpan() };
  }

  parseNativeCall(callToken) {
    const nameToken = this.consumeIdentifier('Expected native name after "call".');
    this.consume('LEFT_PAREN', 'Expected "(" after native function name.');
    const args = [];
    if (!this.check('RIGHT_PAREN')) {
      do {
        args.push(this.parseExpression());
      } while (this.match('COMMA'));
    }
    const close = this.consume('RIGHT_PAREN', 'Expected ")" after native call arguments.');
    const span = mergeSpans(callToken.span, close.span ?? nameToken.span);
    return {
      type: 'NativeCallExpression',
      name: nameToken.lexeme,
      nameSpan: nameToken.span,
      arguments: args,
      span,
    };
  }

  consume(type, message) {
    if (this.check(type)) {
      return this.advance();
    }
    const token = this.peek();
    this.error(token, message);
    return token;
  }

  consumeIdentifier(message) {
    if (this.match('IDENTIFIER')) return this.previous();
    if (this.match('ON_INIT') || this.match('ON_TICK')) return this.previous();
    const token = this.peek();
    this.error(token, message);
    return token;
  }

  consumeFunctionName() {
    if (this.match('IDENTIFIER', 'ON_INIT', 'ON_TICK')) {
      return this.previous();
    }
    const token = this.peek();
    this.error(token, 'Expected function name after "fn".');
    return token;
  }

  parseBlockFromBrace(openBrace) {
    this.scopeDepth += 1;
    const statements = [];
    while (!this.check('RIGHT_BRACE') && !this.isAtEnd()) {
      statements.push(this.match('FN') ? this.parseFunctionDeclaration() : this.parseStatement());
    }
    const close = this.consume('RIGHT_BRACE', 'Expected "}" to close block.');
    this.scopeDepth -= 1;
    return { type: 'BlockStatement', body: statements, span: mergeSpans(openBrace.span, close.span ?? openBrace.span) };
  }

  parseBinary(parseOperand, operators) {
    let left = parseOperand();
    while (this.match(...operators)) {
      const operator = this.previous();
      const right = parseOperand();
      const span = mergeSpans(left.span, right.span);
      left = { type: 'BinaryExpression', operator: operator.type, left, right, span };
    }
    return left;
  }

  match(...types) {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  check(type) {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  advance() {
    if (!this.isAtEnd()) {
      this.current += 1;
    }
    return this.previous();
  }

  isAtEnd() {
    return this.peek()?.type === 'EOF';
  }

  peek() {
    return this.tokens[this.current];
  }

  previous() {
    return this.tokens[this.current - 1];
  }

  error(token, message) {
    const span = token?.span ?? emptySpan();
    this.diagnostics.push({ message, span });
  }
}

export function parseTokens(tokens) {
  const parser = new Parser(tokens);
  const ast = parser.parseProgram();
  return { ast, diagnostics: parser.diagnostics };
}

export function parseSource(source) {
  const { tokens, diagnostics: lexDiagnostics } = lex(source);
  const { ast, diagnostics: parseDiagnostics } = parseTokens(tokens);
  return { ast, diagnostics: [...lexDiagnostics, ...parseDiagnostics], tokens };
}
