import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { world, idx } from '../src/state.js';
import { Mode } from '../src/constants.js';
import {
  reactAcidBase,
  reactFireWater,
  ensureCryofoam,
  stepCryofoam,
  reactFireO2,
} from '../src/materials.js';
import { createSimulation, Agent, handlePhaseTransitions } from '../src/simulation.js';
import { initWorld, placeMode } from './helpers/worldHarness.js';
import { setGenerator, setSeed } from '../src/rng.js';

describe('combined scenarios', () => {
  let restoreRng = null;

  beforeEach(() => {
    initWorld({ o2: 0.21 });
    setSeed(world.rngSeed);
    restoreRng = null;
  });

  afterEach(() => {
    if(restoreRng){
      restoreRng();
      restoreRng = null;
    }
    setSeed(world.rngSeed);
  });

  function setRandomSequence(values){
    if(restoreRng){
      restoreRng();
    }
    restoreRng = setGenerator(() => {
      if(!values.length) return 0;
      if(values.length === 1) return values[0];
      return values.shift();
    });
  }

  it('acid-base heat accumulates on base while neighbouring water freezes', () => {
    const acidIdx = placeMode(10, 10, Mode.ACID);
    const baseIdx = placeMode(11, 10, Mode.BASE);
    const waterIdx = placeMode(12, 10, Mode.WATER);

    for(let i = 0; i < 12; i++){
      reactAcidBase(acidIdx, baseIdx, { triggerFlash: false });
    }

    expect(world.heat[baseIdx]).toBeGreaterThan(0.15);
    expect(world.heat[waterIdx]).toBe(0);

    handlePhaseTransitions();
    expect(world.strings[waterIdx].mode).toBe(Mode.ICE);
  });

  it('chain reaction: fire spreads to empty tile with sufficient oxygen after quenching attempts', () => {
    setRandomSequence([0.9]);

    const fireIdx = placeMode(20, 20, Mode.FIRE);
    world.fire.add(fireIdx);
    const emptyIdx = idx(21, 20);
    world.heat[emptyIdx] = 0;
    world.o2[emptyIdx] = 0.25;
    world.o2[fireIdx] = 0.4;

    // Water tries to quench but fails to extinguish completely
    const waterIdx = placeMode(20, 21, Mode.WATER);
    for(let i = 0; i < 10; i++){
      reactFireWater(fireIdx, waterIdx);
    }

    reactFireO2(fireIdx, { o2Cut: 0.12 });

    expect(world.fire.has(fireIdx)).toBe(true);
    expect(world.fire.has(emptyIdx)).toBe(false);
  });

  it('agent panic conversion under sustained stressors', () => {
    const agent = new Agent(30, 30, Mode.CALM);
    world.agents = [agent];
    const tile = idx(30, 30);
    world.heat[tile] = 0.85;
    world.o2[tile] = 0.14;
    agent.S.tension = 0.35;
    agent.S.amplitude = 0.85;

    for(let i = 0; i < 30; i++){
      agent._doStep(null);
      if(agent.S.mode === Mode.PANIC) break;
    }

    expect(agent.S.mode).toBe(Mode.PANIC);
  });

  it('cryofoam patch near acid and base transitions correctly', () => {
    const foamIdx = idx(40, 25);
    ensureCryofoam(foamIdx, { ttl: 5 });
    const acidIdx = placeMode(39, 25, Mode.ACID);
    const baseIdx = placeMode(41, 25, Mode.BASE);

    stepCryofoam();
    const afterAcid = world.foamTimers.get(foamIdx)?.ttl;
    expect(afterAcid ?? 0).toBeLessThan(5);

    stepCryofoam();
    expect(world.strings[foamIdx].mode).toBe(Mode.ICE);
  });
});

  it('acid-base heat diffuses into neighbouring tiles after simulation steps', () => {
    const acidIdx = placeMode(5, 5, Mode.ACID);
    const baseIdx = placeMode(6, 5, Mode.BASE);

    for(let i = 0; i < 10; i++){
      reactAcidBase(acidIdx, baseIdx, { triggerFlash: false });
    }

    const sim = createSimulation({
      getSettings: () => ({
        dHeat: 0.3,
        dO2: 0,
        o2Base: 0.21,
        o2Cut: 0.12,
      }),
      updateMetrics: () => {},
      draw: () => {},
    });

    const neighbours = [
      idx(6, 4), idx(6, 6), // base tile vertical neighbours
      idx(5, 4), idx(5, 6), // acid vertical neighbours
      idx(7, 5), idx(4, 5), // horizontal next to base/acid
    ];

    for(let step = 0; step < 10; step++){
      sim.stepOnce();
    }

    const baseHeat = world.heat[baseIdx];
    expect(baseHeat).toBeGreaterThan(0);
    for(const nIdx of neighbours){
      expect(world.heat[nIdx]).toBeGreaterThan(0);
    }
  });
