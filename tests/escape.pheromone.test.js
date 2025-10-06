import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSimulation, Agent } from '../src/simulation.js';
import { Mode, DIRS4 } from '../src/constants.js';
import { world, idx, inBounds } from '../src/state.js';
import { initWorld } from './helpers/worldHarness.js';

const defaultSettings = {
  dHeat: 0,
  dO2: 0,
  o2Base: 0.21,
  o2Cut: 0.12,
};

describe('escape pheromone deposition', () => {
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

  function forceAgent(x, y, tension, amplitude){
    const agent = new Agent(x, y, Mode.CALM);
    agent.S.tension = tension;
    agent.S.amplitude = amplitude;
    world.agents = [agent];
    return agent;
  }

  it('lays escape pheromone when an overwhelmed agent finds a cooler neighbor', () => {
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const agent = forceAgent(10, 10, 0.35, 0.75);
    const here = idx(10, 10);
    world.heat[here] = 0.9;

    for(const [dx,dy] of DIRS4){
      const nx = 10 + dx;
      const ny = 10 + dy;
      if(!inBounds(nx,ny)) continue;
      const nIdx = idx(nx, ny);
      world.heat[nIdx] = 0.89;
    }
    const coolIdx = idx(11, 10);
    world.heat[coolIdx] = 0.88;
    const twoStepIdx = idx(12, 10);
    world.heat[twoStepIdx] = 0.6;

    const threshold = (function(){
      let min = Infinity;
      for(const [dx,dy] of DIRS4){
        const nx = 10 + dx;
        const ny = 10 + dy;
        if(!inBounds(nx,ny)) continue;
        const nIdx = idx(nx, ny);
        min = Math.min(min, world.heat[nIdx] ?? 1);
      }
      return min;
    })();
    expect(threshold).toBeGreaterThanOrEqual(world.heat[here] - 0.05);
    const overwhelmed = (world.heat[here] > 0.75) &&
      (threshold >= world.heat[here] - 0.05) &&
      (agent.S.amplitude > 0.6) &&
      (agent.S.tension < 0.45);
    expect(overwhelmed).toBe(true);

    expect(world.escapeField[here]).toBe(0);
    expect(world.escapeField[coolIdx]).toBe(0);

    agent._doStep(null);

    expect(idx(agent.x, agent.y)).not.toBe(here);
    let hasEscape = false;
    for(let i=0;i<world.escapeField.length;i++){
      if(world.escapeField[i] > 0){
        hasEscape = true;
        break;
      }
    }
    expect(hasEscape).toBe(true);
  });

  it('does not mark escape field when destination is not cooler', () => {
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const agent = forceAgent(15, 15, 0.35, 0.75);
    const here = idx(15, 15);
    world.heat[here] = 0.9;
    for(const [dx,dy] of DIRS4){
      const nx = 15 + dx;
      const ny = 15 + dy;
      if(!inBounds(nx,ny)) continue;
      const nIdx = idx(nx, ny);
      world.heat[nIdx] = 0.9;
      world.wall[nIdx] = 1;
    }
    agent._doStep(null);

    expect(world.escapeField[here]).toBe(0);
    let zeroEverywhere = true;
    for(let i=0;i<world.escapeField.length;i++){
      if(world.escapeField[i] > 0){
        zeroEverywhere = false;
        break;
      }
    }
    expect(zeroEverywhere).toBe(true);
  });
});
