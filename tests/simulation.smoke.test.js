import { describe, it, expect, beforeEach } from 'vitest';
import { createSimulation, Agent } from '../src/simulation.js';
import { world, idx } from '../src/state.js';
import { Mode } from '../src/constants.js';
import { initWorld, placeMode } from './helpers/worldHarness.js';

describe('simulation smoke tests', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
  });

  it('runs multiple steps without NaNs and respects heat bounds', () => {
    const sim = createSimulation({
      getSettings: () => ({
        dHeat: 0.3,
        dO2: 0.2,
        o2Base: 0.21,
        o2Cut: 0.12,
      }),
      updateMetrics: () => {},
      draw: () => {},
    });

    const fireIdx = placeMode(20, 20, Mode.FIRE);
    const waterIdx = placeMode(21, 20, Mode.WATER);
    world.fire.add(fireIdx);
    world.agents = [new Agent(22, 20, Mode.CALM)];

    for(let step = 0; step < 30; step++){
      sim.stepOnce();
    }

    for(let i = 0; i < world.heat.length; i++){
      expect(Number.isNaN(world.heat[i])).toBe(false);
      expect(world.heat[i]).toBeGreaterThanOrEqual(0);
      expect(world.heat[i]).toBeLessThanOrEqual(1);
    }
    expect(world.heat[waterIdx]).toBeGreaterThanOrEqual(0);
  });

  it('maintains agent count and modes remain defined during simulation', () => {
    const sim = createSimulation({
      getSettings: () => ({
        dHeat: 0.2,
        dO2: 0.2,
        o2Base: 0.21,
        o2Cut: 0.12,
      }),
      updateMetrics: () => {},
      draw: () => {},
    });

    world.agents = [
      new Agent(10, 10, Mode.CALM),
      new Agent(12, 10, Mode.PANIC),
    ];

    const initialCount = world.agents.length;

    for(let step = 0; step < 20; step++){
      sim.stepOnce();
    }

    expect(world.agents.length).toBe(initialCount);
    for(const agent of world.agents){
      expect(agent.S.mode).toBeDefined();
    }
  });
});
