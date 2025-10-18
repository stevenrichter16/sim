import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Agent } from '../src/simulation.js';
import { Mode } from '../src/constants.js';
import { world, idx } from '../src/state.js';
import { initWorld } from './helpers/worldHarness.js';
import { setGenerator, setSeed } from '../src/rng.js';

function mockRandomSequence(values){
  let i = 0;
  return () => {
    const v = values[i] ?? values[values.length - 1] ?? 0;
    if(i < values.length - 1) i += 1; else if(values.length) i = values.length - 1;
    return v;
  };
}

describe('agent curiosity exploration', () => {
  let restoreRng = null;

  beforeEach(() => {
    initWorld({ o2: 0.24 });
    setSeed(world.rngSeed);
  });

  afterEach(() => {
    if(restoreRng){
      restoreRng();
      restoreRng = null;
    }
    setSeed(world.rngSeed);
  });

  function setRandom(values){
    if(restoreRng){
      restoreRng();
    }
    restoreRng = setGenerator(mockRandomSequence(values));
  }

  it('nudges a calm agent outward along a safe gradient when surroundings are low hazard', () => {
    setRandom([0.0, 0.5, 0.5, 0.5]);

    const agent = new Agent(20, 20, Mode.CALM);
    agent.S.tension = 0.82;
    agent.S.amplitude = 0.18;
    world.agents = [agent];

    const center = idx(20, 20);
    world.safeField[center] = 0.95;
    world.safeField[idx(21, 20)] = 0.55;
    world.safeField[idx(19, 20)] = 0.95;
    world.safeField[idx(20, 19)] = 0.95;
    world.safeField[idx(20, 21)] = 0.95;

    agent._doStep(null);

    expect(agent.x).toBe(21);
    expect(agent.y).toBe(20);
  });

  it('refuses to step into high hazard even with strong curiosity', () => {
    setRandom([0.0, 0.5, 1.0, 1.0]);

    const agent = new Agent(30, 30, Mode.CALM);
    agent.S.tension = 0.83;
    agent.S.amplitude = 0.16;
    world.agents = [agent];

    const here = idx(30, 30);
    const east = idx(31, 30);
    world.safeField[here] = 0.95;
    world.safeField[east] = 0.45;
    world.safeField[idx(29, 30)] = 0.95;
    world.safeField[idx(30, 29)] = 0.95;
    world.safeField[idx(30, 31)] = 0.95;
    world.heat[east] = 0.8;

    agent._doStep(null);

    expect(world.heat[idx(agent.x, agent.y)]).toBeLessThanOrEqual(0.4);
  });

  it('increments visited field as agents move', () => {
    setRandom([1]);

    const agent = new Agent(12, 12, Mode.CALM);
    agent.S.tension = 0.8;
    agent.S.amplitude = 0.1;
    world.agents = [agent];

    const here = idx(12, 12);
    world.safeField[here] = 0.9;
    world.safeField[idx(13, 12)] = 0.9;
    world.safeField[idx(11, 12)] = 0.9;
    world.safeField[idx(12, 11)] = 0.9;
    world.safeField[idx(12, 13)] = 0.9;
    world.visited[here] = 0;

    agent._doStep(null);

    const visitedIdx = idx(agent.x, agent.y);
    expect(world.visited[visitedIdx]).toBeGreaterThan(0);
  });

  it('prefers novel edge tiles over previously visited ones', () => {
    setRandom([0.0, 0.5, 0.5, 0.5]);

    const agent = new Agent(40, 40, Mode.CALM);
    agent.S.tension = 0.82;
    agent.S.amplitude = 0.18;
    world.agents = [agent];

    const center = idx(40, 40);
    const west = idx(39, 40);
    const east = idx(41, 40);
    world.safeField[center] = 0.95;
    world.safeField[west] = 0.55;
    world.safeField[east] = 0.55;
    world.safeField[idx(40, 39)] = 0.95;
    world.safeField[idx(40, 41)] = 0.95;
    world.visited[west] = 0;
    world.visited[east] = 0.9;

    agent._doStep(null);

    expect(agent.x).toBe(39);
    expect(agent.y).toBe(40);
  });
});
