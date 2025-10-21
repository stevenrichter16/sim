function normaliseInstructions(instructions = []) {
  return instructions.map((instruction) => ({
    op: instruction.op,
    args: Array.isArray(instruction.args) ? instruction.args : [],
    span: instruction.span ?? null,
  }));
}

function serialiseChunk(chunk) {
  return {
    name: chunk.name,
    params: chunk.params ?? 0,
    span: chunk.span ?? null,
    instructions: normaliseInstructions(chunk.instructions ?? []),
  };
}

export function serialiseCompiledProgram(compiled) {
  if (!compiled) {
    throw new Error('Cannot serialise empty compiled program.');
  }
  const chunks = Array.isArray(compiled.chunks) ? compiled.chunks.map(serialiseChunk) : [];
  const constants = Array.isArray(compiled.constants) ? [...compiled.constants] : [];
  const globals = compiled.globals
    ? Array.from(
        compiled.globals instanceof Map
          ? compiled.globals.entries()
          : Object.entries(compiled.globals),
      )
    : [];
  const nativeIds = compiled.nativeIds
    ? Array.from(
        compiled.nativeIds instanceof Map
          ? compiled.nativeIds.entries()
          : Object.entries(compiled.nativeIds),
      )
    : [];

  return {
    chunks,
    constants,
    globals,
    nativeIds,
    entryPoints: compiled.entryPoints ?? {},
  };
}

function asEntryArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return Object.entries(value);
}

export function deserialiseCompiledProgram(serialised) {
  if (!serialised) {
    throw new Error('Cannot deserialise empty bytecode payload.');
  }
  const chunks = Array.isArray(serialised.chunks)
    ? serialised.chunks.map((chunk) => ({
        name: chunk.name,
        params: chunk.params ?? 0,
        span: chunk.span ?? null,
        instructions: normaliseInstructions(chunk.instructions ?? []),
      }))
    : [];
  const constants = Array.isArray(serialised.constants) ? [...serialised.constants] : [];
  const globals = new Map(asEntryArray(serialised.globals));
  const nativeIds = new Map(asEntryArray(serialised.nativeIds));
  return {
    chunks,
    constants,
    globals,
    nativeIds,
    entryPoints: serialised.entryPoints ?? {},
  };
}

export default {
  serialiseCompiledProgram,
  deserialiseCompiledProgram,
};
