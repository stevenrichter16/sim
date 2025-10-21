const DEFAULT_INSTRUCTION_LIMIT = 256;
const DEFAULT_STACK_SIZE = 256;
const DEFAULT_FRAME_LIMIT = 32;

const OPCODE_IDS = new Map([
  ['PUSH_CONST', 0],
  ['LOAD_GLOBAL', 1],
  ['STORE_GLOBAL', 2],
  ['LOAD_LOCAL', 3],
  ['STORE_LOCAL', 4],
  ['CALL_NATIVE', 5],
  ['POP', 6],
  ['ADD', 7],
  ['SUB', 8],
  ['MUL', 9],
  ['DIV', 10],
  ['MOD', 11],
  ['CMP_EQ', 12],
  ['CMP_NE', 13],
  ['CMP_LT', 14],
  ['CMP_LE', 15],
  ['CMP_GT', 16],
  ['CMP_GE', 17],
  ['NEG', 18],
  ['NOT', 19],
  ['JMP', 20],
  ['JMPF', 21],
  ['RET', 22],
  ['HALT', 23],
]);

function coerceNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new TypeError('Expected numeric value.');
  }
  return value;
}

function makeRuntimeError(message, context) {
  const error = {
    type: context?.type ?? 'RuntimeError',
    message,
    chunk: context?.chunk?.name ?? null,
    span: context?.span ?? null,
    tick: context?.tick ?? null,
    native: context?.native ?? null,
  };
  return error;
}

function computeLocalCount(chunk) {
  let maxSlot = chunk.params;
  for (const instruction of chunk.instructions) {
    if (
      instruction.op === 'STORE_LOCAL' ||
      instruction.op === 'LOAD_LOCAL'
    ) {
      const slot = instruction.args[0] ?? 0;
      if (slot + 1 > maxSlot) {
        maxSlot = slot + 1;
      }
    }
  }
  return maxSlot;
}

function normaliseNativeBinding(binding) {
  if (!binding) {
    return null;
  }
  if (typeof binding === 'function') {
    return { fn: binding, capability: null, name: binding.name || null };
  }
  const { fn, capability = null, name = null } = binding;
  if (typeof fn !== 'function') {
    return null;
  }
  return { fn, capability, name };
}

export function createScenarioVM(compiled, options = {}) {
  const instructionLimit = options.instructionLimit ?? DEFAULT_INSTRUCTION_LIMIT;
  const stackSize = options.stackSize ?? DEFAULT_STACK_SIZE;
  const frameLimit = options.frameLimit ?? DEFAULT_FRAME_LIMIT;
  const capabilitySource = options.capabilities ?? ['runtime.schedule'];
  const capabilitySet = new Set(
    capabilitySource instanceof Set
      ? capabilitySource
      : Array.isArray(capabilitySource)
        ? capabilitySource
        : Array.from(capabilitySource ?? []),
  );

  const constants = compiled.constants ?? [];
  const globals = new Array(compiled.globals?.size ?? 0).fill(null);
  const chunkTable = new Map();
  const chunkIndex = new Map();
  let maxLocals = 0;

  compiled.chunks.forEach((chunk, index) => {
    const instructions = chunk.instructions.map((instruction) => ({
      op: OPCODE_IDS.get(instruction.op),
      args: instruction.args ?? [],
      span: instruction.span ?? chunk.span ?? null,
      raw: instruction,
    }));
    const localCount = computeLocalCount(chunk);
    if (localCount > maxLocals) {
      maxLocals = localCount;
    }
    const packed = {
      name: chunk.name,
      params: chunk.params ?? 0,
      span: chunk.span ?? null,
      instructions,
      localCount,
    };
    chunkTable.set(chunk.name, packed);
    chunkIndex.set(index, packed);
  });

  const stack = new Array(stackSize).fill(null);
  const frames = Array.from({ length: frameLimit }, () => ({
    chunk: null,
    ip: 0,
    stackBase: 0,
    locals: new Array(maxLocals).fill(null),
  }));

  let frameTop = 0;
  let stackTop = 0;
  let currentTick = 0;
  let watchdogBudget = instructionLimit;
  let lastSpan = null;

  const scheduleQueue = new Map();
  const scheduledTicks = [];
  let scheduleDirty = false;

  const nativeDispatch = new Map();

  const registerNative = (name, binding) => {
    const id = compiled.nativeIds?.get(name);
    if (id === undefined) {
      return;
    }
    const normalised = normaliseNativeBinding(binding);
    if (!normalised) {
      return;
    }
    nativeDispatch.set(id, { ...normalised, name });
  };

  if (options.natives) {
    for (const [name, binding] of Object.entries(options.natives)) {
      registerNative(name, binding);
    }
  }

  const scheduleBinding = ({ delay, target, args, span }) => {
    const delayNumber = coerceNumber(delay);
    const absolute = currentTick + Math.max(0, Math.floor(delayNumber));
    let chunk;
    if (typeof target === 'string') {
      chunk = chunkTable.get(target);
    } else if (typeof target === 'number') {
      chunk = chunkIndex.get(target);
    } else if (target && typeof target === 'object' && target.chunk) {
      chunk = chunkTable.get(target.chunk);
    }
    if (!chunk) {
      throw new Error(`Unknown scheduled chunk '${target}'.`);
    }
    const existing = scheduleQueue.get(absolute);
    if (existing) {
      existing.push({ chunk, args, span });
    } else {
      scheduleQueue.set(absolute, [{ chunk, args, span }]);
      scheduledTicks.push(absolute);
      scheduleDirty = true;
    }
  };

  registerNative('schedule', {
    capability: 'runtime.schedule',
    fn: ({ args, span }) => {
      const [delay, target, ...rest] = args;
      try {
        scheduleBinding({ delay, target, args: rest, span });
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      return { ok: true, value: null };
    },
  });

  const sortScheduledTicks = () => {
    if (!scheduleDirty) {
      return;
    }
    scheduledTicks.sort((a, b) => a - b);
    scheduleDirty = false;
  };

  const resetMachine = () => {
    frameTop = 0;
    stackTop = 0;
  };

  const pushValue = (value) => {
    if (stackTop >= stack.length) {
      throw new Error('Operand stack overflow.');
    }
    stack[stackTop] = value;
    stackTop += 1;
  };

  const popValue = () => {
    if (stackTop <= 0) {
      throw new Error('Operand stack underflow.');
    }
    stackTop -= 1;
    const value = stack[stackTop];
    stack[stackTop] = null;
    return value;
  };

  const pushFrame = (chunk, args) => {
    if (frameTop >= frames.length) {
      throw new Error('Call stack overflow.');
    }
    const frame = frames[frameTop];
    frame.chunk = chunk;
    frame.ip = 0;
    frame.stackBase = stackTop;
    for (let i = 0; i < frame.locals.length; i += 1) {
      frame.locals[i] = null;
    }
    for (let i = 0; i < chunk.params; i += 1) {
      frame.locals[i] = args[i] ?? null;
    }
    frameTop += 1;
  };

  const popFrame = () => {
    if (frameTop === 0) {
      return;
    }
    frameTop -= 1;
    const frame = frames[frameTop];
    frame.chunk = null;
    frame.ip = 0;
    stackTop = frame.stackBase;
  };

  const makeContext = (span) => ({
    span,
    chunk: frameTop > 0 ? frames[frameTop - 1].chunk : null,
    tick: currentTick,
  });

  const executeInstruction = (instruction) => {
    switch (instruction.op) {
      case OPCODE_IDS.get('PUSH_CONST'): {
        const [index] = instruction.args;
        pushValue(constants[index]);
        break;
      }
      case OPCODE_IDS.get('LOAD_GLOBAL'): {
        const [slot] = instruction.args;
        pushValue(globals[slot]);
        break;
      }
      case OPCODE_IDS.get('STORE_GLOBAL'): {
        const [slot] = instruction.args;
        const value = popValue();
        globals[slot] = value;
        pushValue(value);
        break;
      }
      case OPCODE_IDS.get('LOAD_LOCAL'): {
        const [slot] = instruction.args;
        const frame = frames[frameTop - 1];
        pushValue(frame.locals[slot]);
        break;
      }
      case OPCODE_IDS.get('STORE_LOCAL'): {
        const [slot] = instruction.args;
        const frame = frames[frameTop - 1];
        const value = popValue();
        frame.locals[slot] = value;
        pushValue(value);
        break;
      }
      case OPCODE_IDS.get('CALL_NATIVE'): {
        const frame = frames[frameTop - 1];
        const [nativeId, argc] = instruction.args;
        const binding = nativeDispatch.get(nativeId);
        if (!binding) {
          throw new Error(`Unknown native id ${nativeId}.`);
        }
        if (binding.capability && !capabilitySet.has(binding.capability)) {
          const message = `Missing capability '${binding.capability}' for native '${binding.name}'.`;
          const error = makeRuntimeError(message, {
            chunk: frame.chunk,
            span: instruction.span,
            tick: currentTick,
            native: binding.name,
          });
          error.blocking = true;
          throw error;
        }
        const args = new Array(argc);
        for (let i = argc - 1; i >= 0; i -= 1) {
          args[i] = popValue();
        }
        let result;
        try {
          result = binding.fn({ vm, args, span: instruction.span, chunk: frame.chunk, tick: currentTick });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw makeRuntimeError(message, {
            chunk: frame.chunk,
            span: instruction.span,
            tick: currentTick,
            native: binding.name,
          });
        }
        if (!result || typeof result !== 'object') {
          pushValue(null);
          break;
        }
        if (result.ok === false) {
          const message = result.error ?? `Native '${binding.name}' failed.`;
          throw makeRuntimeError(message, {
            chunk: frame.chunk,
            span: instruction.span,
            tick: currentTick,
            native: binding.name,
          });
        }
        pushValue(result.value ?? null);
        break;
      }
      case OPCODE_IDS.get('POP'): {
        popValue();
        break;
      }
      case OPCODE_IDS.get('ADD'): {
        const b = popValue();
        const a = popValue();
        pushValue(a + b);
        break;
      }
      case OPCODE_IDS.get('SUB'): {
        const b = popValue();
        const a = popValue();
        pushValue(a - b);
        break;
      }
      case OPCODE_IDS.get('MUL'): {
        const b = popValue();
        const a = popValue();
        pushValue(a * b);
        break;
      }
      case OPCODE_IDS.get('DIV'): {
        const b = popValue();
        const a = popValue();
        pushValue(a / b);
        break;
      }
      case OPCODE_IDS.get('MOD'): {
        const b = popValue();
        const a = popValue();
        pushValue(a % b);
        break;
      }
      case OPCODE_IDS.get('CMP_EQ'): {
        const b = popValue();
        const a = popValue();
        pushValue(a === b);
        break;
      }
      case OPCODE_IDS.get('CMP_NE'): {
        const b = popValue();
        const a = popValue();
        pushValue(a !== b);
        break;
      }
      case OPCODE_IDS.get('CMP_LT'): {
        const b = popValue();
        const a = popValue();
        pushValue(a < b);
        break;
      }
      case OPCODE_IDS.get('CMP_LE'): {
        const b = popValue();
        const a = popValue();
        pushValue(a <= b);
        break;
      }
      case OPCODE_IDS.get('CMP_GT'): {
        const b = popValue();
        const a = popValue();
        pushValue(a > b);
        break;
      }
      case OPCODE_IDS.get('CMP_GE'): {
        const b = popValue();
        const a = popValue();
        pushValue(a >= b);
        break;
      }
      case OPCODE_IDS.get('NEG'): {
        const value = popValue();
        pushValue(-value);
        break;
      }
      case OPCODE_IDS.get('NOT'): {
        const value = popValue();
        pushValue(!value);
        break;
      }
      case OPCODE_IDS.get('JMP'): {
        const frame = frames[frameTop - 1];
        const [target] = instruction.args;
        frame.ip = target;
        break;
      }
      case OPCODE_IDS.get('JMPF'): {
        const frame = frames[frameTop - 1];
        const [target] = instruction.args;
        const condition = popValue();
        if (!condition) {
          frame.ip = target;
        }
        break;
      }
      case OPCODE_IDS.get('RET'): {
        const frame = frames[frameTop - 1];
        const returnValue = stackTop > frame.stackBase ? popValue() : null;
        popFrame();
        if (frameTop > 0) {
          pushValue(returnValue);
        } else {
          stackTop = 0;
        }
        break;
      }
      case OPCODE_IDS.get('HALT'): {
        popFrame();
        if (frameTop === 0) {
          stackTop = 0;
        }
        break;
      }
      default:
        throw new Error('Unknown opcode.');
    }
  };

  const runFrames = () => {
    while (frameTop > 0) {
      if (watchdogBudget <= 0) {
        const context = makeContext(lastSpan);
        throw makeRuntimeError(`Instruction limit of ${instructionLimit} exceeded.`, {
          ...context,
          type: 'WatchdogViolation',
        });
      }
      const frame = frames[frameTop - 1];
      if (!frame.chunk) {
        popFrame();
        continue;
      }
      if (frame.ip >= frame.chunk.instructions.length) {
        popFrame();
        continue;
      }
      const instruction = frame.chunk.instructions[frame.ip];
      lastSpan = instruction.span ?? frame.chunk.span ?? null;
      frame.ip += 1;
      watchdogBudget -= 1;
      executeInstruction(instruction);
    }
  };

  const executeChunk = (chunk, args = []) => {
    try {
      pushFrame(chunk, args);
      runFrames();
      return { status: 'ok' };
    } catch (error) {
      let payload;
      if (error && typeof error === 'object' && 'type' in error) {
        payload = error;
      } else if (error instanceof Error) {
        payload = makeRuntimeError(error.message, makeContext(lastSpan));
      } else {
        payload = makeRuntimeError(String(error), makeContext(lastSpan));
      }
      resetMachine();
      return { status: 'error', error: payload };
    }
  };

  const executeChunkByName = (name, args = []) => {
    const chunk = chunkTable.get(name);
    if (!chunk) {
      return {
        status: 'error',
        error: makeRuntimeError(`Unknown chunk '${name}'.`, { chunk: { name }, tick: currentTick }),
      };
    }
    return executeChunk(chunk, args);
  };

  const runScheduledTasks = (untilTick) => {
    sortScheduledTicks();
    while (scheduledTicks.length > 0 && scheduledTicks[0] <= untilTick) {
      const tick = scheduledTicks.shift();
      const tasks = scheduleQueue.get(tick) ?? [];
      try {
        for (let i = 0; i < tasks.length; i += 1) {
          const task = tasks[i];
          const result = executeChunk(task.chunk, task.args ?? []);
          if (result.status === 'error') {
            return result;
          }
        }
      } finally {
        scheduleQueue.delete(tick);
      }
      if (scheduleDirty) {
        sortScheduledTicks();
      }
    }
    return { status: 'ok' };
  };

  const vm = {
    get globals() {
      return globals;
    },
    get constants() {
      return constants;
    },
    schedule(delay, target, args = [], span = null) {
      scheduleBinding({ delay, target, args, span });
    },
    runInit(...args) {
      watchdogBudget = instructionLimit;
      const chunkName = compiled.entryPoints?.onInit;
      if (!chunkName) {
        return { status: 'ok' };
      }
      currentTick = 0;
      return executeChunkByName(chunkName, args);
    },
    tick(frame, dt) {
      watchdogBudget = instructionLimit;
      currentTick = frame;
      const runTasks = runScheduledTasks(frame);
      if (runTasks.status === 'error') {
        return runTasks;
      }
      const chunkName = compiled.entryPoints?.onTick;
      if (!chunkName) {
        return { status: 'ok' };
      }
      const result = executeChunkByName(chunkName, [frame, dt]);
      return result;
    },
  };

  const initChunk = chunkTable.get('<init>');
  if (initChunk) {
    const initResult = executeChunk(initChunk, []);
    if (initResult.status === 'error') {
      return { ...vm, bootstrapError: initResult.error };
    }
  }

  return vm;
}
