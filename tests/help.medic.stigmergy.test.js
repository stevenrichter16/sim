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

    sim.stepOnce();

    const dropTile = idx(panic.x, panic.y);
    expect(world.helpField[dropTile]).toBeGreaterThan(0);
    expect(world.helpField[dropTile]).toBeLessThanOrEqual(1);
  });

  it('medic moves toward a panic beacon as help diffuses and leaves route trail', () => {
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const panic = new Agent(32, 20, Mode.PANIC);
    panic.S.tension = 0.04;
    panic.S.amplitude = 1.2;

    const medic = new Agent(26, 20, Mode.MEDIC);

    world.agents = [panic, medic];

    const startDistance = Math.abs(medic.x - panic.x) + Math.abs(medic.y - panic.y);
    for(let step = 0; step < 20; step++){
      sim.stepOnce();
    }
    const endDistance = Math.abs(medic.x - panic.x) + Math.abs(medic.y - panic.y);

    expect(world.helpField[idx(panic.x, panic.y)]).toBeGreaterThan(0);
    expect(world.helpField[idx(medic.x, medic.y)]).toBeGreaterThan(0);
    expect(world.routeField[idx(26, 20)]).toBeGreaterThan(0);
    expect(endDistance).toBeLessThanOrEqual(startDistance);
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

  it('route field diffuses and evaporates over time', () => {
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const center = idx(15, 15);
    world.routeField[center] = 1.0;

    sim.stepOnce();

    expect(world.routeField[center]).toBeLessThan(1.0);
    const east = idx(16, 15);
    expect(world.routeField[east]).toBeGreaterThan(0);
  });

  it('medic follows existing route trail when help gradient is flat', () => {
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const medic = new Agent(12, 12, Mode.MEDIC);
    world.agents = [medic];

    world.routeField[idx(12,12)] = 0.05;
    world.routeField[idx(13,12)] = 0.3;

    sim.stepOnce();

    expect(medic.x).toBe(13);
    expect(medic.y).toBe(12);
    expect(world.routeField[idx(12,12)]).toBeGreaterThan(0.05);
  });

  it('medics reinforce and follow shared route deposits', () => {
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const panic = new Agent(18, 18, Mode.PANIC);
    panic.S.tension = 0.05;
    panic.S.amplitude = 1.15;

    const medicA = new Agent(14, 18, Mode.MEDIC);
    const medicB = new Agent(14, 20, Mode.MEDIC);

    world.agents = [panic, medicA, medicB];

    for(let step = 0; step < 12; step++){
      sim.stepOnce();
    }

    const midTrail = [idx(15,18), idx(16,18), idx(17,18)];
    const routeSumMid = midTrail.reduce((sum, tile) => sum + world.routeField[tile], 0);
    expect(routeSumMid).toBeGreaterThan(0);

    const startB = { x: medicB.x, y: medicB.y };

    for(let step = 0; step < 10; step++){
      sim.stepOnce();
    }

    const endB = { x: medicB.x, y: medicB.y };
    expect(endB.x !== startB.x || endB.y !== startB.y).toBe(true);

    const endTrailSum = midTrail.reduce((sum, tile) => sum + world.routeField[tile], 0);
    expect(endTrailSum).toBeGreaterThan(0);
  });
});
