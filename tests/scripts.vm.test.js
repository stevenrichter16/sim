import { describe, it, expect, beforeEach } from 'vitest';
import ScenarioVM, { InstructionBudgetError } from '../src/script/vm.js';
import { OPCODES, encodeUint16 } from '../src/script/compiler.js';

function code(...values) {
  return Uint8Array.from(values.flat());
}

const GLOBALS = {
  TOTAL: 0,
  SCRATCH: 1,
};

function constant(index) {
  return encodeUint16(index);
}

function globalIndex(index) {
  return encodeUint16(index);
}

describe('ScenarioVM', () => {
  let hostCalls;
  let compiled;
  let vm;

  beforeEach(() => {
    hostCalls = [];
    compiled = {
      constants: [5, 3, 1, 'host:add'],
      globals: [
        { name: 'total', initialValue: 0 },
        { name: 'scratch', initialValue: 0 },
      ],
      entryPoints: {
        onInit: { chunk: 0, arity: 1 },
        onTick: { chunk: 1, arity: 2 },
      },
      chunks: [
        {
          code: code(
            OPCODES.CONSTANT, ...constant(0),
            OPCODES.ADD,
            OPCODES.CONSTANT, ...constant(1),
            OPCODES.ADD,
            OPCODES.GLOBAL_SET, ...globalIndex(GLOBALS.TOTAL),
            OPCODES.RETURN,
          ),
        },
        {
          code: code(
            OPCODES.GLOBAL_GET, ...globalIndex(GLOBALS.TOTAL),
            OPCODES.CONSTANT, ...constant(2),
            OPCODES.ADD,
            OPCODES.GLOBAL_SET, ...globalIndex(GLOBALS.TOTAL),
            OPCODES.GLOBAL_GET, ...globalIndex(GLOBALS.TOTAL),
            OPCODES.RETURN,
          ),
        },
        {
          code: code(
            OPCODES.CONSTANT, ...constant(0),
            OPCODES.CONSTANT, ...constant(1),
            OPCODES.CALL_NATIVE, ...constant(3), ...encodeUint16(2),
            OPCODES.GLOBAL_SET, ...globalIndex(GLOBALS.SCRATCH),
            OPCODES.GLOBAL_GET, ...globalIndex(GLOBALS.SCRATCH),
            OPCODES.RETURN,
          ),
        },
        {
          code: code(
            OPCODES.CONSTANT, ...constant(0),
            OPCODES.CONSTANT, ...constant(1),
            OPCODES.JUMP, ...encodeUint16(0),
            OPCODES.RETURN,
          ),
        },
      ],
      stackSize: 32,
      frameCapacity: 4,
      instructionBudget: 100,
    };

    vm = new ScenarioVM(compiled, {
      hostBindings: {
        'host:add': (a, b) => {
          hostCalls.push([a, b]);
          return a + b;
        },
      },
    });
  });

  it('executes the onInit chunk and seeds globals', () => {
    const res = vm.runInit(4);
    expect(res).toBe(12);
    expect(vm.globals[GLOBALS.TOTAL]).toBe(12);
  });

  it('executes the onTick chunk and preserves global state between ticks', () => {
    vm.runInit(4);
    const first = vm.runTick(1, 0.1);
    const second = vm.runTick(2, 0.1);
    expect(first).toBe(13);
    expect(second).toBe(14);
    expect(vm.globals[GLOBALS.TOTAL]).toBe(14);
  });

  it('dispatches native calls through the host bindings table', () => {
    compiled.entryPoints.onNative = { chunk: 2, arity: 0 };
    const nativeResult = vm.runEntry('onNative');
    expect(nativeResult).toBe(8);
    expect(vm.globals[GLOBALS.SCRATCH]).toBe(8);
    expect(hostCalls).toEqual([[5, 3]]);
  });

  it('enforces the per-tick instruction budget', () => {
    vm = new ScenarioVM(
      {
        ...compiled,
        entryPoints: { loop: { chunk: 3, arity: 0 } },
      },
      { instructionBudget: 5 },
    );

    expect(() => vm.runEntry('loop')).toThrowError(InstructionBudgetError);
    try {
      vm.runEntry('loop');
    } catch (err) {
      expect(err).toBeInstanceOf(InstructionBudgetError);
      expect(err.diagnostic).toMatchObject({
        type: 'instruction-budget-exceeded',
        limit: 5,
        entry: 'loop',
      });
    }
  });
});
