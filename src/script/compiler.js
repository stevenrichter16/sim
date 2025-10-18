export const OPCODES = {
  PUSH_CONST: 'PUSH_CONST',
  LOAD_GLOBAL: 'LOAD_GLOBAL',
  STORE_GLOBAL: 'STORE_GLOBAL',
  LOAD_LOCAL: 'LOAD_LOCAL',
  STORE_LOCAL: 'STORE_LOCAL',
  CALL_NATIVE: 'CALL_NATIVE',
  POP: 'POP',
  ADD: 'ADD',
  SUB: 'SUB',
  MUL: 'MUL',
  DIV: 'DIV',
  MOD: 'MOD',
  CMP_EQ: 'CMP_EQ',
  CMP_NE: 'CMP_NE',
  CMP_LT: 'CMP_LT',
  CMP_LE: 'CMP_LE',
  CMP_GT: 'CMP_GT',
  CMP_GE: 'CMP_GE',
  NEG: 'NEG',
  NOT: 'NOT',
  JMP: 'JMP',
  JMPF: 'JMPF',
  RET: 'RET',
  HALT: 'HALT',
};

class Chunk {
  constructor(name, params, span) {
    this.name = name;
    this.params = params;
    this.span = span;
    this.instructions = [];
  }
}

class Scope {
  constructor(chunk, parent = null) {
    this.chunk = chunk;
    this.parent = parent;
    this.locals = new Map();
    this.root = parent ? parent.root : this;
    if (this.root.totalSlots === undefined) {
      this.root.totalSlots = 0;
    }
  }

  defineFixed(name, slot) {
    this.locals.set(name, slot);
    if (slot >= this.root.totalSlots) {
      this.root.totalSlots = slot + 1;
    }
  }

  allocate(name) {
    const slot = this.root.totalSlots;
    this.root.totalSlots += 1;
    this.locals.set(name, slot);
    return slot;
  }

  resolve(name) {
    if (this.locals.has(name)) {
      return { slot: this.locals.get(name) };
    }
    if (this.parent) {
      return this.parent.resolve(name);
    }
    return null;
  }

  hasLocalHere(name) {
    return this.locals.has(name);
  }
}

class Compiler {
  constructor(ast, options = {}) {
    this.ast = ast;
    this.options = options;
    this.diagnostics = [];
    this.constants = [];
    this.globals = new Map();
    this.nativeIds = new Map();
    this.nextNativeId = 0;
    this.chunks = [];
    this.entryPoints = {};
    this.initOptions();
  }

  initOptions() {
    const providedNatives = this.options.nativeIds ?? {};
    for (const [name, id] of Object.entries(providedNatives)) {
      this.nativeIds.set(name, id);
      if (id >= this.nextNativeId) {
        this.nextNativeId = id + 1;
      }
    }
  }

  compile() {
    const initChunk = new Chunk('<init>', 0, this.ast.span);
    this.chunks.push(initChunk);
    const initContext = { chunk: initChunk, scope: null };

    for (const statement of this.ast.body) {
      this.compileTopLevel(statement, initContext);
    }

    this.ensureHalts(initChunk);

    return {
      chunks: this.chunks,
      globals: this.globals,
      constants: this.constants,
      nativeIds: this.nativeIds,
      entryPoints: this.entryPoints,
      diagnostics: this.diagnostics,
    };
  }

  compileTopLevel(node, context) {
    switch (node.type) {
      case 'LetStatement':
        if (!node.isGlobal) {
          this.diagnostics.push({
            message: `Top-level let expected to be global.`,
            span: node.span,
          });
          break;
        }
        this.compileGlobalLet(node, context);
        break;
      case 'FunctionDeclaration':
      case 'OnInitDeclaration':
      case 'OnTickDeclaration':
        this.compileFunction(node);
        break;
      case 'ScheduleStatement':
      case 'ExpressionStatement':
      case 'ReturnStatement':
      case 'IfStatement':
      case 'WhileStatement':
      case 'BlockStatement':
        this.compileStatement(node, context);
        break;
      default:
        this.diagnostics.push({
          message: `Unsupported top-level node ${node.type}.`,
          span: node.span,
        });
        break;
    }
  }

  compileFunction(node) {
    const chunk = new Chunk(node.name, node.params.length, node.span);
    this.chunks.push(chunk);
    const rootScope = new Scope(chunk, null);
    for (let i = 0; i < node.params.length; i += 1) {
      const param = node.params[i];
      if (rootScope.hasLocalHere(param.name)) {
        this.diagnostics.push({
          message: `Duplicate parameter '${param.name}'.`,
          span: param.span,
        });
      }
      rootScope.defineFixed(param.name, i);
    }
    if (node.body) {
      this.compileBlock(node.body, rootScope, chunk);
    }
    this.ensureHalts(chunk);
    if (node.type === 'OnInitDeclaration') {
      this.entryPoints.onInit = chunk.name;
    } else if (node.type === 'OnTickDeclaration') {
      this.entryPoints.onTick = chunk.name;
    }
  }

  compileBlock(blockNode, scope, chunk) {
    const blockScope = scope ? new Scope(chunk, scope) : scope;
    for (const statement of blockNode.body) {
      this.compileStatement(statement, { chunk, scope: blockScope ?? scope });
    }
  }

  compileStatement(node, context) {
    switch (node.type) {
      case 'LetStatement':
        if (node.isGlobal && !context.scope) {
          this.compileGlobalLet(node, context);
        } else {
          this.compileLocalLet(node, context);
        }
        break;
      case 'ReturnStatement':
        this.compileReturn(node, context);
        break;
      case 'ExpressionStatement':
        this.compileExpression(node.expression, context);
        this.emit(context.chunk, OPCODES.POP, [], node.span);
        break;
      case 'ScheduleStatement':
        this.compileExpression(node.delay, context);
        this.compileExpression(node.task, context);
        this.emitCallNative('schedule', 2, context.chunk, node.span);
        this.emit(context.chunk, OPCODES.POP, [], node.span);
        break;
      case 'IfStatement':
        this.compileIf(node, context);
        break;
      case 'WhileStatement':
        this.compileWhile(node, context);
        break;
      case 'BlockStatement':
        this.compileBlock(node, context.scope, context.chunk);
        break;
      default:
        this.diagnostics.push({ message: `Unsupported statement '${node.type}'.`, span: node.span });
        break;
    }
  }

  compileGlobalLet(node, context) {
    const name = node.name.name;
    let slot = this.globals.get(name);
    if (slot === undefined) {
      slot = this.globals.size;
      this.globals.set(name, slot);
    }
    if (node.initializer) {
      this.compileExpression(node.initializer, context);
    } else {
      this.emitPushConst(null, context.chunk, node.span);
    }
    this.emit(context.chunk, OPCODES.STORE_GLOBAL, [slot], node.span);
    this.emit(context.chunk, OPCODES.POP, [], node.span);
  }

  compileLocalLet(node, context) {
    if (!context.scope) {
      this.diagnostics.push({ message: 'Local declaration without scope.', span: node.span });
      return;
    }
    const scope = context.scope;
    const name = node.name.name;
    if (scope.hasLocalHere(name)) {
      this.diagnostics.push({ message: `Duplicate local '${name}'.`, span: node.name.span });
      return;
    }
    const slot = scope.allocate(name);
    if (node.initializer) {
      this.compileExpression(node.initializer, context);
    } else {
      this.emitPushConst(null, context.chunk, node.span);
    }
    this.emit(context.chunk, OPCODES.STORE_LOCAL, [slot], node.span);
    this.emit(context.chunk, OPCODES.POP, [], node.span);
  }

  compileReturn(node, context) {
    if (!context.scope) {
      this.diagnostics.push({ message: 'Return statement outside function.', span: node.span });
      return;
    }
    if (node.argument) {
      this.compileExpression(node.argument, context);
    }
    this.emit(context.chunk, OPCODES.RET, [], node.span);
  }

  compileIf(node, context) {
    this.compileExpression(node.test, context);
    const jumpIndex = this.emitJump(context.chunk, OPCODES.JMPF, node.test.span);
    this.compileStatement(node.consequent, context);
    if (node.alternate) {
      const exitJump = this.emitJump(context.chunk, OPCODES.JMP, node.span);
      this.patchJump(context.chunk, jumpIndex);
      this.compileStatement(node.alternate, context);
      this.patchJump(context.chunk, exitJump);
    } else {
      this.patchJump(context.chunk, jumpIndex);
    }
  }

  compileWhile(node, context) {
    const loopStart = context.chunk.instructions.length;
    this.compileExpression(node.test, context);
    const exitJump = this.emitJump(context.chunk, OPCODES.JMPF, node.test.span);
    this.compileStatement(node.body, context);
    this.emit(context.chunk, OPCODES.JMP, [loopStart], node.span);
    this.patchJump(context.chunk, exitJump);
  }

  compileExpression(node, context) {
    switch (node.type) {
      case 'NumberLiteral':
        this.emitPushConst(node.value, context.chunk, node.span);
        break;
      case 'StringLiteral':
        this.emitPushConst(node.value, context.chunk, node.span);
        break;
      case 'BooleanLiteral':
        this.emitPushConst(node.value, context.chunk, node.span);
        break;
      case 'NullLiteral':
        this.emitPushConst(null, context.chunk, node.span);
        break;
      case 'Identifier':
        this.compileIdentifier(node, context);
        break;
      case 'BinaryExpression':
        this.compileBinary(node, context);
        break;
      case 'UnaryExpression':
        this.compileUnary(node, context);
        break;
      case 'GroupingExpression':
        this.compileExpression(node.expression, context);
        break;
      case 'AssignmentExpression':
        this.compileAssignment(node, context);
        break;
      case 'NativeCallExpression':
        this.compileNativeCall(node, context);
        break;
      case 'CallExpression':
        this.diagnostics.push({ message: 'User-defined calls not yet supported.', span: node.span });
        this.emitPushConst(null, context.chunk, node.span);
        break;
      default:
        this.diagnostics.push({ message: `Unsupported expression '${node.type}'.`, span: node.span });
        this.emitPushConst(null, context.chunk, node.span);
        break;
    }
  }

  compileIdentifier(node, context) {
    const name = node.name;
    if (context.scope) {
      const resolved = context.scope.resolve(name);
      if (resolved) {
        this.emit(context.chunk, OPCODES.LOAD_LOCAL, [resolved.slot], node.span);
        return;
      }
    }
    if (this.globals.has(name)) {
      const slot = this.globals.get(name);
      this.emit(context.chunk, OPCODES.LOAD_GLOBAL, [slot], node.span);
      return;
    }
    this.diagnostics.push({ message: `Unknown identifier '${name}'.`, span: node.span });
    this.emitPushConst(null, context.chunk, node.span);
  }

  compileBinary(node, context) {
    this.compileExpression(node.left, context);
    this.compileExpression(node.right, context);
    const opcode = this.binaryOpcode(node.operator);
    if (opcode) {
      this.emit(context.chunk, opcode, [], node.span);
    } else {
      this.diagnostics.push({ message: `Unsupported operator '${node.operator}'.`, span: node.span });
      this.emit(context.chunk, OPCODES.POP, [], node.span);
      this.emit(context.chunk, OPCODES.POP, [], node.span);
      this.emitPushConst(null, context.chunk, node.span);
    }
  }

  compileUnary(node, context) {
    this.compileExpression(node.argument, context);
    const opcode = node.operator === 'MINUS' ? OPCODES.NEG : node.operator === 'BANG' ? OPCODES.NOT : null;
    if (opcode) {
      this.emit(context.chunk, opcode, [], node.span);
    } else {
      this.diagnostics.push({ message: `Unsupported unary operator '${node.operator}'.`, span: node.span });
    }
  }

  compileAssignment(node, context) {
    this.compileExpression(node.value, context);
    const target = node.target;
    if (target.type !== 'Identifier') {
      this.diagnostics.push({ message: 'Invalid assignment target.', span: node.span });
      return;
    }
    const name = target.name;
    if (context.scope) {
      const resolved = context.scope.resolve(name);
      if (resolved) {
        this.emit(context.chunk, OPCODES.STORE_LOCAL, [resolved.slot], node.span);
        return;
      }
    }
    if (this.globals.has(name)) {
      const slot = this.globals.get(name);
      this.emit(context.chunk, OPCODES.STORE_GLOBAL, [slot], node.span);
      return;
    }
    this.diagnostics.push({ message: `Unknown assignment target '${name}'.`, span: node.span });
  }

  compileNativeCall(node, context) {
    for (const arg of node.arguments) {
      this.compileExpression(arg, context);
    }
    this.emitCallNative(node.name, node.arguments.length, context.chunk, node.span);
  }

  binaryOpcode(operator) {
    switch (operator) {
      case 'PLUS':
        return OPCODES.ADD;
      case 'MINUS':
        return OPCODES.SUB;
      case 'STAR':
        return OPCODES.MUL;
      case 'SLASH':
        return OPCODES.DIV;
      case 'PERCENT':
        return OPCODES.MOD;
      case 'EQUAL_EQUAL':
        return OPCODES.CMP_EQ;
      case 'BANG_EQUAL':
        return OPCODES.CMP_NE;
      case 'LESS':
        return OPCODES.CMP_LT;
      case 'LESS_EQUAL':
        return OPCODES.CMP_LE;
      case 'GREATER':
        return OPCODES.CMP_GT;
      case 'GREATER_EQUAL':
        return OPCODES.CMP_GE;
      default:
        return null;
    }
  }

  emitCallNative(name, argc, chunk, span) {
    const id = this.getNativeId(name);
    this.emit(chunk, OPCODES.CALL_NATIVE, [id, argc], span);
  }

  getNativeId(name) {
    if (!this.nativeIds.has(name)) {
      const id = this.nextNativeId;
      this.nativeIds.set(name, id);
      this.nextNativeId += 1;
    }
    return this.nativeIds.get(name);
  }

  emitPushConst(value, chunk, span) {
    const index = this.addConstant(value);
    this.emit(chunk, OPCODES.PUSH_CONST, [index], span);
  }

  addConstant(value) {
    this.constants.push(value);
    return this.constants.length - 1;
  }

  emit(chunk, op, args = [], span) {
    chunk.instructions.push({ op, args, span });
  }

  emitJump(chunk, op, span) {
    const instruction = { op, args: [null], span };
    chunk.instructions.push(instruction);
    return chunk.instructions.length - 1;
  }

  patchJump(chunk, index) {
    const target = chunk.instructions.length;
    chunk.instructions[index].args[0] = target;
  }

  ensureHalts(chunk) {
    const last = chunk.instructions[chunk.instructions.length - 1];
    if (!last || (last.op !== OPCODES.HALT && last.op !== OPCODES.RET)) {
      this.emit(chunk, OPCODES.HALT, [], chunk.span);
    }
  }
}

export function compileProgram(ast, options = {}) {
  const compiler = new Compiler(ast, options);
  return compiler.compile();
}

export async function compileSource(source, options = {}) {
  const { parseSource } = await import('./parser.js');
  const { ast, diagnostics } = parseSource(source);
  const compiled = compileProgram(ast, options);
  return { ...compiled, diagnostics: [...diagnostics, ...compiled.diagnostics] };
}
