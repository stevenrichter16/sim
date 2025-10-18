import { OPCODES, decodeUint16 } from './compiler.js';

export class InstructionBudgetError extends Error {
  constructor(diagnostic) {
    super(`Instruction budget exceeded after ${diagnostic.executed} instructions`);
    this.name = 'InstructionBudgetError';
    this.diagnostic = diagnostic;
  }
}

function createFrame() {
  return {
    chunkIndex: 0,
    ip: 0,
    stackBase: 0,
  };
}

export class ScenarioVM {
  constructor(compiled, options = {}) {
    const {
      chunks = [],
      constants = [],
      globals = [],
      entryPoints = {},
      stackSize = 256,
      frameCapacity = 16,
    } = compiled ?? {};

    this.chunks = chunks;
    this.constants = constants;
    this.entryPoints = entryPoints;

    this.globalNames = globals.map((g) => g.name ?? null);
    this.globalInitials = globals.map((g) => g.initialValue ?? null);
    this.globals = new Array(this.globalInitials.length);

    this.stack = new Array(stackSize);
    this.stackTop = 0;

    this.frames = Array.from({ length: frameCapacity }, () => createFrame());
    this.frameCount = 0;

    this.defaultInstructionBudget = options.instructionBudget ?? compiled.instructionBudget ?? 1000;
    this.instructionBudget = this.defaultInstructionBudget;
    this.instructionsExecuted = 0;

    this.hostBindings = options.hostBindings ?? {};
    this.nativeArgsBuffer = new Array(options.nativeArgCapacity ?? 8);

    this.currentEntry = null;

    this.resetGlobals();
  }

  resetGlobals() {
    for (let i = 0; i < this.globalInitials.length; i += 1) {
      this.globals[i] = this.globalInitials[i];
    }
  }

  setHostBindings(bindings) {
    this.hostBindings = bindings ?? {};
  }

  runInit(seed) {
    this.resetGlobals();
    return this.runEntry('onInit', seed === undefined ? [] : [seed]);
  }

  runTick(frame, dt) {
    return this.runEntry('onTick', [frame, dt]);
  }

  runEntry(name, args = []) {
    const entry = this.entryPoints?.[name];
    if (!entry) {
      return undefined;
    }

    const chunkIndex = typeof entry === 'object' ? entry.chunk : entry;
    const arity = typeof entry === 'object' && entry.arity != null ? entry.arity : args.length;

    this.resetStack();
    this.instructionsExecuted = 0;
    this.instructionBudget = this.defaultInstructionBudget;

    return this.execute(chunkIndex, arity, args, name);
  }

  resetStack() {
    this.stackTop = 0;
    this.frameCount = 0;
  }

  push(value) {
    if (this.stackTop >= this.stack.length) {
      throw new Error('stack overflow');
    }
    this.stack[this.stackTop] = value;
    this.stackTop += 1;
  }

  pop() {
    if (this.stackTop <= 0) {
      throw new Error('stack underflow');
    }
    this.stackTop -= 1;
    const value = this.stack[this.stackTop];
    this.stack[this.stackTop] = undefined;
    return value;
  }

  peek(distance = 0) {
    const index = this.stackTop - 1 - distance;
    if (index < 0) {
      throw new Error('stack underflow');
    }
    return this.stack[index];
  }

  execute(chunkIndex, arity, args, entryName) {
    if (arity !== args.length) {
      throw new Error(`entry ${entryName ?? chunkIndex} expected ${arity} args, received ${args.length}`);
    }

    const frame = this.frames[0];
    frame.chunkIndex = chunkIndex;
    frame.ip = 0;
    frame.stackBase = 0;
    this.frameCount = 1;

    for (let i = 0; i < args.length; i += 1) {
      this.push(args[i]);
    }

    let returnValue;

    while (this.frameCount > 0) {
      const currentFrame = this.frames[this.frameCount - 1];
      const chunk = this.chunks[currentFrame.chunkIndex];
      if (!chunk) {
        throw new Error(`missing chunk ${currentFrame.chunkIndex}`);
      }
      const code = chunk.code ?? chunk.instructions ?? [];
      if (currentFrame.ip >= code.length) {
        // Implicit return
        this.frameCount -= 1;
        this.stackTop = currentFrame.stackBase;
        if (this.frameCount === 0) {
          return returnValue;
        }
        continue;
      }

      if (this.instructionsExecuted >= this.instructionBudget) {
        throw new InstructionBudgetError({
          type: 'instruction-budget-exceeded',
          limit: this.instructionBudget,
          executed: this.instructionsExecuted,
          entry: entryName ?? null,
          chunkIndex: currentFrame.chunkIndex,
          ip: currentFrame.ip,
        });
      }
      this.instructionsExecuted += 1;

      const opcode = code[currentFrame.ip];
      currentFrame.ip += 1;

      switch (opcode) {
        case OPCODES.CONSTANT: {
          const index = this.readUint16(code, currentFrame);
          this.push(this.constants[index]);
          break;
        }
        case OPCODES.NULL: {
          this.push(null);
          break;
        }
        case OPCODES.TRUE: {
          this.push(true);
          break;
        }
        case OPCODES.FALSE: {
          this.push(false);
          break;
        }
        case OPCODES.POP: {
          this.pop();
          break;
        }
        case OPCODES.DUP: {
          this.push(this.peek());
          break;
        }
        case OPCODES.GLOBAL_GET: {
          const index = this.readUint16(code, currentFrame);
          this.push(this.globals[index]);
          break;
        }
        case OPCODES.GLOBAL_SET: {
          const index = this.readUint16(code, currentFrame);
          this.globals[index] = this.peek();
          break;
        }
        case OPCODES.ADD: {
          const b = this.pop();
          const a = this.pop();
          this.push(a + b);
          break;
        }
        case OPCODES.SUB: {
          const b = this.pop();
          const a = this.pop();
          this.push(a - b);
          break;
        }
        case OPCODES.MUL: {
          const b = this.pop();
          const a = this.pop();
          this.push(a * b);
          break;
        }
        case OPCODES.DIV: {
          const b = this.pop();
          const a = this.pop();
          this.push(a / b);
          break;
        }
        case OPCODES.NEGATE: {
          const value = this.pop();
          this.push(-value);
          break;
        }
        case OPCODES.NOT: {
          const value = this.pop();
          this.push(!value);
          break;
        }
        case OPCODES.LT:
        case OPCODES.LTE:
        case OPCODES.GT:
        case OPCODES.GTE:
        case OPCODES.EQ:
        case OPCODES.NEQ: {
          const b = this.pop();
          const a = this.pop();
          let result;
          switch (opcode) {
            case OPCODES.LT:
              result = a < b;
              break;
            case OPCODES.LTE:
              result = a <= b;
              break;
            case OPCODES.GT:
              result = a > b;
              break;
            case OPCODES.GTE:
              result = a >= b;
              break;
            case OPCODES.EQ:
              result = a === b;
              break;
            default:
              result = a !== b;
              break;
          }
          this.push(result);
          break;
        }
        case OPCODES.JUMP: {
          const target = this.readUint16(code, currentFrame);
          currentFrame.ip = target;
          break;
        }
        case OPCODES.JUMP_IF_FALSE: {
          const target = this.readUint16(code, currentFrame);
          const condition = this.pop();
          if (!condition) {
            currentFrame.ip = target;
          }
          break;
        }
        case OPCODES.CALL_NATIVE: {
          const bindingIndex = this.readUint16(code, currentFrame);
          const arityValue = this.readUint16(code, currentFrame);
          const bindingName = this.constants[bindingIndex];
          const fn = this.hostBindings?.[bindingName];
          if (typeof fn !== 'function') {
            throw new Error(`native binding ${bindingName} is not available`);
          }
          if (arityValue > this.nativeArgsBuffer.length) {
            this.nativeArgsBuffer.length = arityValue;
          }
          for (let i = arityValue - 1; i >= 0; i -= 1) {
            this.nativeArgsBuffer[i] = this.pop();
          }
          this.nativeArgsBuffer.length = arityValue;
          const result = fn(...this.nativeArgsBuffer);
          this.push(result);
          break;
        }
        case OPCODES.RETURN: {
          const value = this.pop();
          this.frameCount -= 1;
          this.stackTop = currentFrame.stackBase;
          if (this.frameCount === 0) {
            return value;
          }
          returnValue = value;
          this.push(value);
          break;
        }
        case OPCODES.HALT: {
          this.frameCount = 0;
          return returnValue;
        }
        default:
          throw new Error(`unknown opcode ${opcode}`);
      }
    }

    return returnValue;
  }

  readUint16(code, frame) {
    if (frame.ip + 1 >= code.length) {
      throw new Error('unexpected end of bytecode');
    }
    const high = code[frame.ip];
    const low = code[frame.ip + 1];
    frame.ip += 2;
    return decodeUint16(high, low);
  }
}

export default ScenarioVM;
