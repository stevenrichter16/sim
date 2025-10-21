import { random as globalRandom } from '../rng.js';
import { createScenarioVM } from './vm.js';

const noop = () => {};

export const DEFAULT_CAPABILITIES = [
  'fire.write',
  'agent.spawn',
  'agent.switch',
  'field.read',
  'field.write',
  'rng.use',
  'runtime.schedule',
  'diag.write',
];

function toArray(value) {
  if (!value) return undefined;
  if (Array.isArray(value)) return [...value];
  if (value instanceof Set) return Array.from(value);
  return Array.from(value);
}

function normaliseDiagnostics(diagnostics) {
  if (!diagnostics || typeof diagnostics.log !== 'function') {
    return { log: noop };
  }
  return diagnostics;
}

function logRuntimeEvent(logger, baseEvent, override = {}) {
  const event = {
    type: 'info',
    message: '',
    chunk: null,
    span: null,
    tick: null,
    native: null,
    data: null,
    ...baseEvent,
    ...override,
  };
  logger.log(event);
}

function describeError(error) {
  if (!error || typeof error !== 'object') {
    return null;
  }
  return {
    message: error.message ?? String(error),
    chunk: error.chunk ?? null,
    span: error.span ?? null,
    tick: error.tick ?? null,
    native: error.native ?? null,
    blocking: !!error.blocking,
  };
}

function normaliseNativeResult(result) {
  if (result && typeof result === 'object') {
    if ('ok' in result) {
      if (result.ok === false) {
        return { ok: false, error: result.error ?? 'Native failed.' };
      }
      if ('value' in result) {
        return { ok: true, value: result.value };
      }
      const { ok, error, ...rest } = result;
      const payload = Object.keys(rest).length > 0 ? rest : null;
      return { ok: true, value: payload };
    }
    return { ok: true, value: result };
  }
  if (result === undefined) {
    return { ok: true, value: null };
  }
  return { ok: true, value: result };
}

function callHostNative(name, hostFn, args, meta = {}) {
  if (typeof hostFn !== 'function') {
    return { ok: false, error: `Native '${name}' is unavailable.` };
  }
  try {
    const result = hostFn(...args, meta);
    return normaliseNativeResult(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

function resolveRng(rngOption) {
  if (!rngOption) {
    return {
      random: () => globalRandom(),
      range: (min, max) => min + (max - min) * globalRandom(),
    };
  }
  const randomFn = typeof rngOption.random === 'function' ? rngOption.random : () => globalRandom();
  const rangeFn =
    typeof rngOption.range === 'function'
      ? rngOption.range
      : (min, max) => min + (max - min) * randomFn();
  return { random: randomFn, range: rangeFn };
}

function makeHostNative(name, capability, handler) {
  return {
    name,
    capability,
    fn: handler,
  };
}

function createDefaultNatives(host, logger, rngApi) {
  const safeHost = host ?? {};
  const igniteFn = safeHost.ignite ?? safeHost.scenarioIgnite ?? null;
  const spawnFn = safeHost.spawnAgent ?? safeHost.spawnNPC ?? null;
  const switchFactionFn = safeHost.switchFaction ?? null;
  const fieldReadFn = safeHost.field ?? safeHost.fieldRead ?? null;
  const fieldWriteFn = safeHost.fieldWrite ?? null;
  const randTileFn = safeHost.randTile ?? null;

  const { random, range } = resolveRng(rngApi);

  return {
    ignite: makeHostNative('ignite', 'fire.write', ({ args, tick }) =>
      callHostNative('ignite', igniteFn, args, { tick }),
    ),
    spawnAgent: makeHostNative('spawnAgent', 'agent.spawn', ({ args, tick }) =>
      callHostNative('spawnAgent', spawnFn, args, { tick }),
    ),
    switchFaction: makeHostNative('switchFaction', 'agent.switch', ({ args, tick }) =>
      callHostNative('switchFaction', switchFactionFn, args, { tick }),
    ),
    field: makeHostNative('field', 'field.read', ({ args, tick }) =>
      callHostNative('field', fieldReadFn, args, { tick }),
    ),
    fieldWrite: makeHostNative('fieldWrite', 'field.write', ({ args, tick }) =>
      callHostNative('fieldWrite', fieldWriteFn, args, { tick }),
    ),
    rand: makeHostNative('rand', 'rng.use', () => ({ ok: true, value: random() })),
    randRange: makeHostNative('randRange', 'rng.use', ({ args }) => {
      const [min = 0, max = 1] = args;
      return { ok: true, value: range(min, max) };
    }),
    randTile: makeHostNative('randTile', 'rng.use', ({ args, tick }) =>
      callHostNative('randTile', randTileFn, args, { tick }),
    ),
    logDebug: makeHostNative('logDebug', 'diag.write', ({ args, tick, span, chunk }) => {
      const [tag, value] = args;
      logRuntimeEvent(logger, {
        type: 'info',
        message: `logDebug:${tag ?? ''}`,
        tick,
        span,
        chunk: chunk?.name ?? null,
        data: { value },
      });
      return { ok: true, value: null };
    }),
  };
}

function normaliseNativeBinding(name, binding) {
  if (!binding) {
    return {
      name,
      capability: null,
      fn: () => ({ ok: false, error: `Native '${name}' is unavailable.` }),
    };
  }
  if (typeof binding === 'function') {
    return { name, capability: null, fn: binding };
  }
  const { fn, capability = null } = binding;
  if (typeof fn !== 'function') {
    return {
      name,
      capability: null,
      fn: () => ({ ok: false, error: `Invalid native binding for '${name}'.` }),
    };
  }
  return { name: binding.name ?? name, capability, fn };
}

export function createScenarioRuntime(options) {
  const { compiled, capabilities, diagnostics, natives = {}, host, rng } = options ?? {};
  if (!compiled) {
    throw new Error('createScenarioRuntime requires compiled scenario bytecode.');
  }

  const logger = normaliseDiagnostics(diagnostics);
  const capabilityList = toArray(capabilities) ?? [...DEFAULT_CAPABILITIES];

  const defaultNatives = createDefaultNatives(host, logger, rng ?? host?.rng);

  const nativeEntries = new Map();

  for (const [name, binding] of Object.entries(defaultNatives)) {
    nativeEntries.set(name, normaliseNativeBinding(name, binding));
  }

  for (const [name, binding] of Object.entries(natives)) {
    nativeEntries.set(name, normaliseNativeBinding(name, binding));
  }

  const vmNatives = {};
  for (const [name, binding] of nativeEntries.entries()) {
    vmNatives[name] = binding;
  }

  const vm = createScenarioVM(compiled, {
    capabilities: capabilityList,
    natives: vmNatives,
  });

  const status = {
    healthy: vm.bootstrapError ? false : true,
    lastError: vm.bootstrapError ? describeError(vm.bootstrapError) : null,
  };

  if (vm.bootstrapError) {
    logRuntimeEvent(logger, {
      type: 'error',
      message: status.lastError?.message ?? 'Scenario bootstrap error.',
      chunk: status.lastError?.chunk ?? null,
      span: status.lastError?.span ?? null,
      tick: status.lastError?.tick ?? null,
      native: status.lastError?.native ?? null,
      data: { phase: 'bootstrap' },
    });
  }

  const handleResult = (phase, result) => {
    if (!result || typeof result !== 'object') {
      const invalid = { status: 'error', error: { message: 'Invalid VM result.' } };
      status.healthy = false;
      status.lastError = describeError(invalid.error);
      logRuntimeEvent(logger, {
        type: 'error',
        message: 'Invalid VM result.',
        data: { phase },
      });
      return invalid;
    }
    if (result.status === 'error') {
      const errorDescription = describeError(result.error);
      status.healthy = false;
      status.lastError = errorDescription;
      logRuntimeEvent(logger, {
        type: errorDescription?.blocking ? 'watchdog' : 'error',
        message: errorDescription?.message ?? 'Scenario runtime error.',
        chunk: errorDescription?.chunk ?? null,
        span: errorDescription?.span ?? null,
        tick: errorDescription?.tick ?? null,
        native: errorDescription?.native ?? null,
        data: { phase },
      });
    }
    return result;
  };

  return {
    runInit(seed, ...rest) {
      const result = vm.runInit ? vm.runInit(seed, ...rest) : { status: 'ok' };
      return handleResult('init', result);
    },
    tick(frame, dt, ...rest) {
      const result = vm.tick ? vm.tick(frame, dt, ...rest) : { status: 'ok' };
      return handleResult('tick', result);
    },
    dispose() {
      status.healthy = false;
      status.lastError = null;
    },
    getStatus() {
      return { ...status };
    },
    get vm() {
      return vm;
    },
  };
}

export default createScenarioRuntime;
