import { describe, expect, it } from 'vitest';
import { lex } from '../src/script/lexer.js';
import { parseSource } from '../src/script/parser.js';
import { compileProgram, OPCODES } from '../src/script/compiler.js';

describe('script lexer', () => {
  it('captures spans for schedule and native calls', () => {
    const source = 'schedule(5, call ignite("core"));';
    const { tokens, diagnostics } = lex(source);
    expect(diagnostics).toEqual([]);
    const scheduleToken = tokens.find((token) => token.type === 'SCHEDULE');
    const stringToken = tokens.find((token) => token.type === 'STRING');
    expect(scheduleToken).toBeDefined();
    expect(scheduleToken.span.start.line).toBe(1);
    expect(scheduleToken.span.start.column).toBe(1);
    expect(scheduleToken.span.end.column).toBe(9);
    expect(stringToken).toBeDefined();
    expect(stringToken.literal).toBe('core');
    expect(stringToken.span.start.index).toBe(source.indexOf('"'));
    expect(tokens[tokens.length - 1].type).toBe('EOF');
  });
});

describe('script parser', () => {
  it('parses entry points, schedule statements, and native calls with spans', () => {
    const source = `let counter = 1;
fn onInit(seed) {
  schedule(5, call ignite(seed, "main"));
}

fn onTick(frame, dt) {
  call switchFaction(frame, dt);
}
`;
    const { ast, diagnostics } = parseSource(source);
    expect(diagnostics).toEqual([]);
    expect(ast.body).toHaveLength(3);
    const initNode = ast.body[1];
    const tickNode = ast.body[2];
    expect(initNode.type).toBe('OnInitDeclaration');
    expect(initNode.body.body).toHaveLength(1);
    const scheduleStmt = initNode.body.body[0];
    expect(scheduleStmt.type).toBe('ScheduleStatement');
    expect(scheduleStmt.span.start.line).toBe(3);
    expect(scheduleStmt.task.type).toBe('NativeCallExpression');
    expect(scheduleStmt.task.arguments).toHaveLength(2);
    expect(scheduleStmt.task.span.start.line).toBe(3);
    expect(tickNode.type).toBe('OnTickDeclaration');
    const callStmt = tickNode.body.body[0];
    expect(callStmt.type).toBe('ExpressionStatement');
    expect(callStmt.expression.type).toBe('NativeCallExpression');
    expect(callStmt.expression.name).toBe('switchFaction');
  });

  it('emits diagnostics with spans when schedule is malformed', () => {
    const broken = 'schedule(1, call ignite("x");';
    const { diagnostics } = parseSource(broken);
    expect(diagnostics).toHaveLength(1);
    const [diag] = diagnostics;
    expect(diag.message).toContain('Expected ")" after schedule arguments.');
    expect(diag.span.start.index).toBe(broken.length - 1);
  });
});

describe('script compiler', () => {
  it('allocates globals, maps entry points, and appends HALT instructions', () => {
    const source = `let counter = 1;
fn onInit(seed) {
  schedule(5, call ignite(seed, "main"));
}

fn onTick(frame, dt) {
  call switchFaction(frame, dt);
}
`;
    const { ast, diagnostics: parseDiagnostics } = parseSource(source);
    expect(parseDiagnostics).toEqual([]);
    const compiled = compileProgram(ast, {
      nativeIds: {
        ignite: 0,
        schedule: 1,
        switchFaction: 2,
      },
    });
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.globals.get('counter')).toBe(0);
    const initChunk = compiled.chunks.find((chunk) => chunk.name === '<init>');
    expect(initChunk).toBeDefined();
    const onInitChunk = compiled.chunks.find((chunk) => chunk.name === 'onInit');
    const onTickChunk = compiled.chunks.find((chunk) => chunk.name === 'onTick');
    expect(onInitChunk).toBeDefined();
    expect(onTickChunk).toBeDefined();
    expect(initChunk.instructions[initChunk.instructions.length - 1].op).toBe(OPCODES.HALT);
    expect(onInitChunk.instructions[onInitChunk.instructions.length - 1].op).toBe(OPCODES.HALT);
    expect(onTickChunk.instructions[onTickChunk.instructions.length - 1].op).toBe(OPCODES.HALT);
    const scheduleCall = onInitChunk.instructions.filter((ins) => ins.op === OPCODES.CALL_NATIVE);
    expect(scheduleCall).toHaveLength(2);
    expect(scheduleCall[0].args).toEqual([0, 2]);
    expect(scheduleCall[1].args).toEqual([1, 2]);
    const tickCall = onTickChunk.instructions.find((ins) => ins.op === OPCODES.CALL_NATIVE);
    expect(tickCall.args).toEqual([2, 2]);
    expect(compiled.entryPoints.onInit).toBe('onInit');
    expect(compiled.entryPoints.onTick).toBe('onTick');
    expect(compiled.constants).toEqual(expect.arrayContaining([1, 5, 'main']));
  });
});
