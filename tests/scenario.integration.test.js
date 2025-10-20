import { describe, it, expect, beforeEach } from 'vitest';
import { compileSource } from '../src/script/compiler.js';
import {
  createSimulation,
  scenarioIgnite,
  spawnNPC,
} from '../src/simulation.js';
import { world } from '../src/state.js';
import { initWorld, tileIndex } from './helpers/worldHarness.js';

async function compileScenarioSource(source) {
  const { diagnostics, ...compiled } = await compileSource(source);
  if (diagnostics.length > 0) {
    throw new Error(diagnostics.map((d) => d.message).join(', '));
  }
  return compiled;
}

describe('Scenario runtime integration', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
    world.scenarioAgents.clear();
    world.scenarioFires.clear();
  });

  it('invokes scenario natives during simulation ticks', async () => {
    const igniteTile = tileIndex(5, 5);
    const tickIgniteTile = tileIndex(5, 6);
    const spawnTile = tileIndex(6, 5);

    const compiled = await compileScenarioSource(`
      fn onInit(seed) {
        call ignite(${igniteTile}, 0.6);
        call spawnAgent(0, 101, ${spawnTile});
      }
      fn onTick(frame, dt) {
        if (frame == 0) {
          call ignite(${tickIgniteTile}, 0.4);
        }
      }
    `);

    const igniteCalls = [];
    const spawnCalls = [];

    const sim = createSimulation({
      getSettings: () => ({
        dHeat: 0.2,
        dO2: 0.2,
        o2Base: 0.21,
        o2Cut: 0.12,
        dt: 1,
      }),
      updateMetrics: () => {},
      draw: () => {},
    });

    const loadResult = sim.loadScenarioRuntime({
      compiled,
      seed: 1234,
      host: {
        ignite(tileIdx, intensity, meta) {
          igniteCalls.push({ tileIdx, intensity, tick: meta?.tick ?? null });
          return scenarioIgnite(tileIdx, intensity);
        },
        spawnAgent(factionId, mode, tileIdx, meta) {
          spawnCalls.push({ factionId, mode, tileIdx, tick: meta?.tick ?? null });
          return spawnNPC(mode, factionId, { tileIdx, scenarioOwned: true });
        },
      },
    });

    expect(loadResult.status).toBe('ok');
    expect(igniteCalls).toHaveLength(1);
    expect(igniteCalls[0]).toMatchObject({ tileIdx: igniteTile, tick: 0 });
    expect(spawnCalls).toHaveLength(1);

    sim.stepOnce();

    expect(igniteCalls).toHaveLength(2);
    expect(igniteCalls[1]).toMatchObject({ tileIdx: tickIgniteTile, tick: 0 });
    expect(world.scenarioAgents.size).toBe(1);
  });
});
