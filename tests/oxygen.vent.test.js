import { describe, it, expect, beforeEach } from 'vitest';
import { world, idx } from '../src/state.js';
import { Mode } from '../src/constants.js';
import { createSimulation, Agent } from '../src/simulation.js';
import { initWorld, placeMode } from './helpers/worldHarness.js';

describe('oxygen and vent behaviour', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
  });

  it('diffusion smooths oxygen differences between neighbour tiles', () => {
    const left = idx(10, 10);
    const right = idx(11, 10);
    world.o2[left] = 0.30;
    world.o2[right] = 0.05;

    const sim = createSimulation({
      getSettings: () => ({
        dHeat: 0,
        dO2: 0.4,
        o2Base: 0.21,
        o2Cut: 0.12,
      }),
      updateMetrics: () => {},
      draw: () => {},
    });

    sim.stepOnce();

    const diffBefore = 0.30 - 0.05;
    const diffAfter = Math.abs(world.o2[left] - world.o2[right]);
    expect(diffAfter).toBeLessThan(diffBefore);
  });

  it('vents pull oxygen toward the base value', () => {
    const ventIdx = idx(15, 15);
    world.vent[ventIdx] = 1;
    world.o2[ventIdx] = 0.02;

    const sim = createSimulation({
      getSettings: () => ({
        dHeat: 0,
        dO2: 0.1,
        o2Base: 0.19,
        o2Cut: 0.12,
      }),
      updateMetrics: () => {},
      draw: () => {},
    });

    sim.stepOnce();

    expect(world.o2[ventIdx]).toBeLessThanOrEqual(0.19);
    expect(world.o2[ventIdx]).toBeGreaterThan(0.02);
  });

  it('low oxygen reduces agent tension over successive steps', () => {
    const agent = new Agent(20, 20, Mode.CALM);
    world.agents = [agent];
    const tile = idx(20, 20);
    const lowO2 = 0.14;
    world.o2[tile] = lowO2;
    world.heat[tile] = 0.5;
    const neighbors = [idx(19,20), idx(21,20), idx(20,19), idx(20,21)];
    for(const n of neighbors){
      world.o2[n] = lowO2;
      world.wall[n] = 1;
    }
    const initialTension = agent.S.tension;

    for(let i = 0; i < 5; i++){
      agent._doStep(null);
    }

    expect(agent.S.tension).toBeLessThan(initialTension);
    expect(agent.S.amplitude).toBeGreaterThan(0);
  });

  it('high oxygen lets agents recover tension', () => {
    const agent = new Agent(25, 25, Mode.CALM);
    agent.S.tension = 0.4;
    world.agents = [agent];
    const tile = idx(25, 25);
    const highO2 = 0.22;
    world.o2[tile] = highO2;
    world.heat[tile] = 0.5;
    const neighbors = [idx(24,25), idx(26,25), idx(25,24), idx(25,26)];
    for(const n of neighbors){
      world.o2[n] = highO2;
      world.wall[n] = 1;
    }
    const initialTension = agent.S.tension;

    for(let i = 0; i < 5; i++){
      agent._doStep(null);
    }

    expect(agent.S.tension).toBeGreaterThan(initialTension);
  });
});
