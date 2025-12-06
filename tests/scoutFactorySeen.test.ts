import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent, worldInit } from '../src/simulation.js';
import { world, idx } from '../src/state.js';
import { Mode } from '../src/constants.js';
import { baseStringFor } from '../src/materials.js';
import * as rng from '../src/rng.js';

function resetWorldSmall(){
  world.W = 8;
  world.H = 6;
  world.cell = 1;
  worldInit(0.21, { seed: 1 });
}

describe('scout factory seen mask', ()=>{
  beforeEach(()=>{
    vi.restoreAllMocks();
    resetWorldSmall();
  });

  it('allows entering factories and disables curiosity on visit', ()=>{
    const scout = new Agent(1, 2, Mode.SCOUT, 'A');
    world.agents = [scout];
    const factoryIdx = idx(2, 2);
    const altIdx = idx(3, 2);
    const fid = scout.factionId ?? 0;

    world.strings[factoryIdx] = baseStringFor(Mode.FACTORY_CONSTRUCTOR);
    world.curiosityField[factoryIdx] = 1;
    world.curiosityField[altIdx] = 0.8;

    vi.spyOn(rng, 'random').mockReturnValue(0.1);
    vi.spyOn(rng, 'randomCentered').mockReturnValue(0);

    scout._doStep(null); // should move onto factory and disable it
    expect(idx(scout.x, scout.y)).toBe(factoryIdx);
    expect(world.factorySeenByFaction[fid][factoryIdx]).toBe(1);

    scout._doStep(null); // should leave toward alternate curiosity (no discovery now)
    expect(idx(scout.x, scout.y)).toBe(altIdx);
  });

  it('allows entering factories even without discovery gating', ()=>{
    const scout = new Agent(1, 2, Mode.SCOUT, 'A');
    world.agents = [scout];
    const factoryIdx = idx(2, 2);
    const altIdx = idx(1, 3);
    const fid = scout.factionId ?? 0;

    world.strings[factoryIdx] = baseStringFor(Mode.FACTORY_SMELTER);
    world.curiosityField[factoryIdx] = 1;
    world.curiosityField[altIdx] = 0.9;

    vi.spyOn(rng, 'random').mockReturnValue(0.1);
    vi.spyOn(rng, 'randomCentered').mockReturnValue(0);

    scout._doStep(null);
    expect(idx(scout.x, scout.y)).toBe(factoryIdx); // can step onto factory
  });
});
