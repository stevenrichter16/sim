import { describe, expect, it, vi } from 'vitest';
import { compileSource } from '../src/script/compiler.js';
import { createScenarioRuntime } from '../src/script/runtime.js';

async function compileScenario(source) {
  const { diagnostics, ...compiled } = await compileSource(source);
  if (diagnostics.length > 0) {
    throw new Error(`Compilation diagnostics: ${diagnostics.map((d) => d.message).join(', ')}`);
  }
  return compiled;
}

describe('Scenario Runtime Integration Module', () => {
  it('runs onInit and onTick entry points and dispatches natives', async () => {
    const compiled = await compileScenario(`
      let initSeed = 0;
      fn onInit(seed) {
        initSeed = seed;
        call testNative(seed);
      }
      fn onTick(frame, dt) {
        initSeed = initSeed + 1;
        call testNative(frame);
      }
    `);

    const signals = [];
    const runtime = createScenarioRuntime({
      compiled,
      natives: {
        testNative: ({ args }) => {
          signals.push([...args]);
          return { ok: true, value: null };
        },
      },
    });

    const initResult = runtime.runInit(1234);
    expect(initResult.status).toBe('ok');
    expect(signals).toHaveLength(1);
    expect(signals[0]).toEqual([1234]);

    const tickResult = runtime.tick(10, 0.16);
    expect(tickResult.status).toBe('ok');
    expect(signals).toHaveLength(2);
    expect(signals[1]).toEqual([10]);
  });

  it('captures runtime errors from native failures and surfaces diagnostics', async () => {
    const compiled = await compileScenario(`
      fn onTick(frame, dt) {
        call failNative();
      }
    `);

    const diagnostics = [];
    const runtime = createScenarioRuntime({
      compiled,
      diagnostics: {
        log: (event) => diagnostics.push(event),
      },
      natives: {
        failNative: () => ({ ok: false, error: 'boom' }),
      },
    });

    const result = runtime.tick(42, 0.2);

    expect(result.status).toBe('error');
    expect(result.error).toBeTruthy();
    expect(result.error.message).toContain('boom');
    expect(diagnostics).not.toHaveLength(0);
    const last = diagnostics[diagnostics.length - 1];
    expect(last.type).toBe('error');
    expect(last.message).toContain('boom');
  });

  it('delegates built-in ignite native to host bindings', async () => {
    const compiled = await compileScenario(`
      fn onTick(frame, dt) {
        call ignite(5, 0.75);
      }
    `);

    const ignite = vi.fn(() => ({ ok: true, tileIdx: 5, intensity: 0.75 }));

    const runtime = createScenarioRuntime({
      compiled,
      host: {
        ignite,
      },
    });

    const result = runtime.tick(12, 0.16);

    expect(result.status).toBe('ok');
    expect(ignite).toHaveBeenCalledTimes(1);
    expect(ignite).toHaveBeenCalledWith(5, 0.75, expect.objectContaining({ tick: 12 }));
  });

  it('enforces native capabilities and surfaces watchdog diagnostics on denial', async () => {
    const compiled = await compileScenario(`
      fn onTick(frame, dt) {
        call restricted();
      }
    `);

    const diagnostics = [];
    const runtime = createScenarioRuntime({
      compiled,
      diagnostics: { log: (event) => diagnostics.push(event) },
      natives: {
        restricted: {
          capability: 'restricted.cap',
          fn: () => ({ ok: true, value: null }),
        },
      },
      capabilities: [],
    });

    const result = runtime.tick(1, 0.1);

    expect(result.status).toBe('error');
    expect(diagnostics).not.toHaveLength(0);
    const last = diagnostics[diagnostics.length - 1];
    expect(last.type).toBe('watchdog');
    expect(last.message).toContain('Missing capability');
    expect(runtime.getStatus().healthy).toBe(false);
  });

  it('provides deterministic rng via rand native', async () => {
    const compiled = await compileScenario(`
      fn onTick(frame, dt) {
        let value = call rand();
        call capture(value);
      }
    `);

    const captured = [];

    const runtime = createScenarioRuntime({
      compiled,
      rng: {
        random: () => 0.42,
      },
      natives: {
        capture: ({ args }) => {
          captured.push(args[0]);
          return { ok: true, value: null };
        },
      },
    });

    const result = runtime.tick(2, 0.1);

    expect(result.status).toBe('ok');
    expect(captured).toHaveLength(1);
    expect(captured[0]).toBeCloseTo(0.42);
  });
});
