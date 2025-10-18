import { describe, expect, it } from 'vitest';
import { lex } from '../src/script/lexer.js';
import { parseSource } from '../src/script/parser.js';
import { compileProgram, OPCODES } from '../src/script/compiler.js';
import { createScenarioVM } from '../src/script/vm.js';

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

describe('scenario script vm', () => {
  const compile = (source, nativeIds = {}) => {
    const { ast, diagnostics } = parseSource(source);
    expect(diagnostics).toEqual([]);
    return compileProgram(ast, { nativeIds });
  };

  it('runs entry points, updates globals, and dispatches deterministic natives', () => {
    const script = `let accumulator = 0;
fn onInit(seed) {
  accumulator = call rand();
}

fn onTick(frame, dt) {
  accumulator = accumulator + call rand();
  call ignite(frame, accumulator);
}
`;
    const compiled = compile(script, { rand: 0, ignite: 1 });
    const randValues = [0.25, 0.5];
    const igniteCalls = [];
    const vm = createScenarioVM(compiled, {
      natives: {
        rand: () => ({ ok: true, value: randValues.shift() ?? 0 }),
        ignite: ({ args }) => {
          igniteCalls.push([...args]);
          return { ok: true, value: null };
        },
      },
      capabilities: ['ignite'],
    });
    expect(vm.bootstrapError).toBeUndefined();
    const initResult = vm.runInit(123);
    expect(initResult.status).toBe('ok');
    const slot = compiled.globals.get('accumulator');
    expect(vm.globals[slot]).toBeCloseTo(0.25, 6);
    const tickResult = vm.tick(0, 0.016);
    expect(tickResult.status).toBe('ok');
    expect(vm.globals[slot]).toBeCloseTo(0.75, 6);
    expect(igniteCalls).toEqual([[0, 0.75]]);
  });

  it('executes scheduled chunks before tick processing', () => {
    const script = `let hits = 0;
fn event() {
  hits = hits + 1;
}

fn onInit(seed) {
  schedule(1, "event");
}

fn onTick(frame, dt) {
  if (frame == 2) {
    schedule(1, "event");
  }
}
`;
    const compiled = compile(script, { schedule: 0 });
    const vm = createScenarioVM(compiled);
    const slot = compiled.globals.get('hits');
    expect(vm.runInit(0).status).toBe('ok');
    expect(vm.globals[slot]).toBe(0);
    expect(vm.tick(0, 0.016).status).toBe('ok');
    expect(vm.globals[slot]).toBe(0);
    expect(vm.tick(1, 0.016).status).toBe('ok');
    expect(vm.globals[slot]).toBe(1);
    expect(vm.tick(2, 0.016).status).toBe('ok');
    expect(vm.globals[slot]).toBe(1);
    expect(vm.tick(3, 0.016).status).toBe('ok');
    expect(vm.globals[slot]).toBe(2);
  });

  it('runs same-tick tasks scheduled during execution before returning', () => {
    const script = `let hits = 0;
fn event() {
  hits = hits + 1;
  if (hits == 1) {
    schedule(0, "event");
  }
}

fn later() {
}

fn onInit(seed) {
  schedule(1, "event");
  schedule(2, "later");
}

fn onTick(frame, dt) {
}
`;
    const compiled = compile(script, { schedule: 0 });
    const vm = createScenarioVM(compiled);
    expect(vm.runInit(0).status).toBe('ok');
    const slot = compiled.globals.get('hits');
    expect(vm.tick(1, 0.016).status).toBe('ok');
    expect(vm.globals[slot]).toBe(2);
  });

  it('halts execution when exceeding the instruction watchdog limit', () => {
    const script = `fn onTick(frame, dt) {
  while (true) {
  }
}
`;
    const compiled = compile(script);
    const vm = createScenarioVM(compiled, { instructionLimit: 32 });
    const result = vm.tick(0, 0.016);
    expect(result.status).toBe('error');
    expect(result.error.type).toBe('WatchdogViolation');
    expect(result.error.message).toContain('Instruction limit');
  });

  it('propagates native capability errors with spans', () => {
    const script = `fn onTick(frame, dt) {
  call ignite(frame);
}
`;
    const compiled = compile(script, { ignite: 0 });
    const vm = createScenarioVM(compiled, {
      natives: {
        ignite: { capability: 'ignite', fn: () => ({ ok: true, value: null }) },
      },
    });
    const result = vm.tick(0, 0.016);
    expect(result.status).toBe('error');
    expect(result.error.message).toContain("Missing capability 'ignite'");
    expect(result.error.span).toBeDefined();
  });

  it('does not leak stack slots when initialising many globals', () => {
    const declarationCount = 300;
    const declarations = Array.from({ length: declarationCount }, (_, index) => `let g${index} = ${index};`).join('\n');
    const script = `${declarations}
fn onInit() {
}
`;
    const compiled = compile(script);
    const vm = createScenarioVM(compiled, { stackSize: 256, instructionLimit: 4096 });
    expect(vm.bootstrapError).toBeUndefined();
    const lastSlot = compiled.globals.get(`g${declarationCount - 1}`);
    expect(vm.globals[lastSlot]).toBe(declarationCount - 1);
  });

  it('keeps the operand stack balanced for many local declarations', () => {
    const locals = Array.from({ length: 260 }, (_, index) => `  let l${index} = frame + ${index};`).join('\n');
    const script = `fn onTick(frame, dt) {
${locals}
}
`;
    const compiled = compile(script);
    const vm = createScenarioVM(compiled, { stackSize: 256, instructionLimit: 4096 });
    const result = vm.tick(0, 0.016);
    expect(result.status).toBe('ok');
  });
});
