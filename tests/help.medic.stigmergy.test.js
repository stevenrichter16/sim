import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSimulation, Agent } from '../src/simulation.js';
import { Mode } from '../src/constants.js';
import { world, idx } from '../src/state.js';
import { initWorld } from './helpers/worldHarness.js';

const defaultSettings = {
  dHeat: 0.08,
  dO2: 0.04,
  o2Base: 0.21,
  o2Cut: 0.12,
};

describe('stigmergic help field & medic behaviour', () => {
  let sim;
  let randomSpy;

  beforeEach(() => {
    initWorld({ o2: 0.21 });
    sim = createSimulation({
      getSettings: () => defaultSettings,
      updateMetrics: () => {},
      draw: () => {},
    });
  });

  afterEach(() => {
    if(randomSpy){
      randomSpy.mockRestore();
      randomSpy = undefined;
    }
  });

  it('panic agents deposit help signals on their tile', () => {
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const panic = new Agent(20, 20, Mode.PANIC);
    panic.S.tension = 0.05;
    panic.S.amplitude = 1.1;
    world.agents = [panic];

    const tile = idx(20, 20);
    expect(world.helpField[tile]).toBe(0);

    sim.stepOnce();

    expect(world.helpField[tile]).toBeGreaterThan(0);
    expect(world.helpField[tile]).toBeLessThanOrEqual(1);
  });

  it('medic moves toward a panic beacon as help diffuses', () => {
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const panic = new Agent(32, 20, Mode.PANIC);
    panic.S.tension = 0.04;
    panic.S.amplitude = 1.2;

    const medic = new Agent(26, 20, Mode.MEDIC);

    world.agents = [panic, medic];

    const startDistance = Math.abs(medic.x - panic.x) + Math.abs(medic.y - panic.y);
    for(let step = 0; step < 12; step++){
      sim.stepOnce();
    }
    const endDistance = Math.abs(medic.x - panic.x) + Math.abs(medic.y - panic.y);

    expect(world.helpField[idx(panic.x, panic.y)]).toBeGreaterThan(0);
    expect(world.helpField[idx(medic.x, medic.y)]).toBeGreaterThan(0);
    expect(endDistance).toBeLessThan(startDistance);
  });

  it('medic wanders when no help signals or targets exist', () => {
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const medic = new Agent(10, 10, Mode.MEDIC);
    medic.medicConfig = { ...medic.medicConfig, searchRadius: 0 };
    world.agents = [medic];

    const startPos = { x: medic.x, y: medic.y };
    for(let step = 0; step < 5; step++){
      sim.stepOnce();
    }

    expect(medic.x !== startPos.x || medic.y !== startPos.y).toBe(true);
  });
});
