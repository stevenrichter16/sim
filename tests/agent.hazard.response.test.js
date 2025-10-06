import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSimulation, Agent } from '../src/simulation.js';
import { Mode } from '../src/constants.js';
import { world, idx } from '../src/state.js';
import { initWorld } from './helpers/worldHarness.js';

const hazardSettings = {
  dHeat: 0,
  dO2: 0,
  o2Base: 0.21,
  o2Cut: 0.12,
};

function sumField(field){
  let total = 0;
  for(let i = 0; i < field.length; i++) total += field[i];
  return total;
}

describe('agent hazard responses over time', () => {
  let sim;
  let randomSpy;

  beforeEach(() => {
    initWorld({ o2: 0.21 });
    sim = createSimulation({
      getSettings: () => hazardSettings,
      updateMetrics: () => {},
      draw: () => {},
    });
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.45);
  });

  afterEach(() => {
    if(randomSpy){
      randomSpy.mockRestore();
      randomSpy = undefined;
    }
  });

  it('single agent under sustained heat and hypoxia panics, moves, and leaves panic markers', () => {
    const agent = new Agent(30, 30, Mode.CALM);
    agent.S.amplitude = 0.65;
    agent.S.tension = 0.5;
    world.agents = [agent];

    const hazardTiles = [
      idx(30, 30),
      idx(30, 31),
      idx(31, 30),
      idx(29, 30),
      idx(30, 29),
    ];
    for(const tile of hazardTiles){
      world.heat[tile] = 0.88;
      world.o2[tile] = 0.12;
    }
    for(let dx = 1; dx <= 4; dx++){
      const tile = idx(30 + dx, 30);
      world.heat[tile] = 0.25;
      world.o2[tile] = 0.23;
    }

    const wallTiles = [
      idx(31, 30),
      idx(29, 30),
      idx(30, 31),
      idx(30, 29),
    ];
    for(const tile of wallTiles) world.wall[tile] = 1;
    const releaseTile = idx(31, 30);
    const releaseStep = 90;

    let panicSeen = false;
    for(let step = 0; step < 150; step++){
      if(step === releaseStep){
        world.wall[releaseTile] = 0;
      }
      sim.stepOnce();
      if(agent.S.mode === Mode.PANIC) panicSeen = true;
    }

    const finalTile = idx(agent.x, agent.y);
    const panicTotal = sumField(world.panicField);
    const helpTotal = sumField(world.helpField);

    expect(panicSeen).toBe(true);
    expect(panicTotal).toBeGreaterThan(0);
    expect(helpTotal).toBeGreaterThan(0);
    expect(world.heat[finalTile]).toBeLessThan(0.4);
  });

  it('panic spreads through nearby group under persistent fire heat', () => {
    const leader = new Agent(40, 22, Mode.PANIC);
    leader.S.tension = 0.06;
    leader.S.amplitude = 1.1;
    const companionA = new Agent(41, 22, Mode.CALM);
    const companionB = new Agent(41, 23, Mode.CALM);
    companionA.S.amplitude = 0.6;
    companionA.S.tension = 0.48;
    companionB.S.amplitude = 0.58;
    companionB.S.tension = 0.5;
    world.agents = [leader, companionA, companionB];

    for(let dx = -1; dx <= 1; dx++){
      for(let dy = -1; dy <= 1; dy++){
        const tile = idx(40 + dx, 22 + dy);
        world.heat[tile] = 0.86;
        world.o2[tile] = 0.13;
      }
    }
    for(let dx = 2; dx <= 5; dx++){
      const tile = idx(40 + dx, 22);
      world.heat[tile] = 0.22;
      world.o2[tile] = 0.24;
    }

    const enclosureWalls = [
      idx(39, 22), idx(39, 23),
      idx(40, 21), idx(41, 21),
      idx(42, 22), idx(42, 23),
      idx(40, 24), idx(41, 24),
    ];
    for(const tile of enclosureWalls) world.wall[tile] = 1;
    const releaseTiles = [idx(42, 22), idx(42, 23)];
    const releaseStep = 120;

    let companionsPanicked = false;
    for(let step = 0; step < 180; step++){
      if(step === releaseStep){
        for(const tile of releaseTiles) world.wall[tile] = 0;
      }
      sim.stepOnce();
      if(companionA.S.mode === Mode.PANIC || companionB.S.mode === Mode.PANIC){
        companionsPanicked = true;
      }
    }

    const panicTrail = sumField(world.panicField);
    const helpTrail = sumField(world.helpField);
    const companionMoved = (companionA.x !== 41 || companionA.y !== 22) ||
      (companionB.x !== 41 || companionB.y !== 23);

    expect(companionsPanicked).toBe(true);
    expect(panicTrail).toBeGreaterThan(0);
    expect(helpTrail).toBeGreaterThan(0);
    expect(companionMoved).toBe(true);
  });

  it('agents shed panic pheromones and stabilise after hazard relief', () => {
    const evacA = new Agent(25, 25, Mode.PANIC);
    evacA.S.tension = 0.08;
    evacA.S.amplitude = 1.05;
    const evacB = new Agent(26, 25, Mode.CALM);
    const evacC = new Agent(26, 26, Mode.CALM);
    evacB.S.amplitude = 0.5;
    evacB.S.tension = 0.55;
    evacC.S.amplitude = 0.48;
    evacC.S.tension = 0.58;
    world.agents = [evacA, evacB, evacC];
    const companions = [evacB, evacC];

    const hazardPatch = [];
    for(let dx = -1; dx <= 1; dx++){
      for(let dy = -1; dy <= 1; dy++){
        const tile = idx(25 + dx, 25 + dy);
        hazardPatch.push(tile);
        world.heat[tile] = 0.87;
        world.o2[tile] = 0.13;
      }
    }
    for(let dx = 2; dx <= 4; dx++){
      const tile = idx(25 + dx, 25);
      world.heat[tile] = 0.24;
      world.o2[tile] = 0.24;
    }

    const enclosureWalls = [
      idx(23, 24), idx(23, 25), idx(23, 26),
      idx(24, 23), idx(25, 23), idx(26, 23),
      idx(27, 24), idx(27, 25), idx(27, 26),
      idx(24, 27), idx(25, 27), idx(26, 27),
    ];
    for(const tile of enclosureWalls) world.wall[tile] = 1;

    let recoveryStart = false;
    let companionTensionBefore = [];
    let panicSnapshot = 0;
    for(let step = 0; step < 260; step++){
      if(step === 140 && !recoveryStart){
        recoveryStart = true;
        for(const tile of hazardPatch){
          world.heat[tile] = 0.18;
          world.o2[tile] = 0.24;
        }
      }
      sim.stepOnce();
      if(step === 120){
        panicSnapshot = sumField(world.panicField);
        companionTensionBefore = companions.map(agent => agent.S.tension);
      }
    }

    const panicResidual = sumField(world.panicField);
    const helpResidual = sumField(world.helpField);

    expect(panicSnapshot).toBeGreaterThan(0);
    expect(panicResidual).toBeLessThan(panicSnapshot * 0.4);
    expect(helpResidual).toBeLessThanOrEqual(panicSnapshot);
    for(let i = 0; i < companions.length; i++){
      expect(companions[i].S.tension).toBeGreaterThan(companionTensionBefore[i]);
      expect(companions[i].panicLevel ?? 0).toBeLessThan(0.5);
    }
  });
});
