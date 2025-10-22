import { describe, it, expect, beforeEach } from 'vitest';
import { compileSource } from '../src/script/compiler.js';
import { serialiseCompiledProgram } from '../src/script/bytecode.js';
import { createSimulation } from '../src/simulation.js';
import { initWorld } from './helpers/worldHarness.js';

describe('scenario asset loading', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
  });

  it('fails when schedule capability is missing', async () => {
    const source = `
      fn onTick(frame, dt) {
        schedule(1, "onTick");
      }
    `;
    const compiled = await compileSource(source);
    if (compiled.diagnostics.length > 0) {
      throw new Error(compiled.diagnostics.map((d) => d.message).join(', '));
    }
    const asset = {
      name: 'missing-schedule',
      capabilities: [],
      bytecode: serialiseCompiledProgram(compiled),
    };

    const sim = createSimulation({
      getSettings: () => ({ dHeat: 0.2, dO2: 0.2, o2Base: 0.21, o2Cut: 0.12, dt: 1 }),
      updateMetrics: () => {},
      draw: () => {},
    });

    const loadResult = sim.loadScenarioAsset(asset);
    expect(loadResult.status).toBe('ok');

    sim.stepOnce();
    const status = sim.getScenarioStatus();
    expect(status?.healthy).toBe(false);
    expect(status?.lastError?.message).toContain('Missing capability');
  });

  it('allows schedule when capability is provided', async () => {
    const source = `
      fn onTick(frame, dt) {
        schedule(1, "onTick");
      }
    `;
    const compiled = await compileSource(source);
    if (compiled.diagnostics.length > 0) {
      throw new Error(compiled.diagnostics.map((d) => d.message).join(', '));
    }
    const asset = {
      name: 'schedule-ok',
      capabilities: ['runtime.schedule'],
      bytecode: serialiseCompiledProgram(compiled),
    };

    const sim = createSimulation({
      getSettings: () => ({ dHeat: 0.2, dO2: 0.2, o2Base: 0.21, o2Cut: 0.12, dt: 1 }),
      updateMetrics: () => {},
      draw: () => {},
    });

    const loadResult = sim.loadScenarioAsset(asset);
    expect(loadResult.status).toBe('ok');

    sim.stepOnce();
    const status = sim.getScenarioStatus();
    expect(status?.healthy).toBe(true);
  });

  it('requires effects.emit to emit visual effects', async () => {
    const source = `
      fn onTick(frame, dt) {
        call emitEffect("flash", 4, 4);
      }
    `;
    const compiled = await compileSource(source);
    if (compiled.diagnostics.length > 0) {
      throw new Error(compiled.diagnostics.map((d) => d.message).join(', '));
    }
    const asset = {
      name: 'missing-effects',
      capabilities: ['agent.read'],
      bytecode: serialiseCompiledProgram(compiled),
    };

    const sim = createSimulation({
      getSettings: () => ({ dHeat: 0.2, dO2: 0.2, o2Base: 0.21, o2Cut: 0.12, dt: 1 }),
      updateMetrics: () => {},
      draw: () => {},
    });

    sim.loadScenarioAsset(asset);
    sim.stepOnce();
    const status = sim.getScenarioStatus();
    expect(status?.healthy).toBe(false);
    expect(status?.lastError?.message).toContain('effects.emit');

    const okAsset = {
      name: 'effects-ok',
      capabilities: ['effects.emit'],
      bytecode: serialiseCompiledProgram(compiled),
    };
    sim.loadScenarioAsset(okAsset);
    sim.stepOnce();
    const okStatus = sim.getScenarioStatus();
    expect(okStatus?.healthy).toBe(true);
  });
});
