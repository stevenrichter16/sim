import { describe, it, expect, beforeEach } from 'vitest';
import { world, idx } from '../src/state.js';
import { Mode } from '../src/constants.js';
import { reactFireWater, ensureCryofoam, reactAcidBase, stepCryofoam } from '../src/materials.js';
import { handlePhaseTransitions } from '../src/simulation.js';
import { initWorld, placeMode } from './helpers/worldHarness.js';

describe('mode-specific behaviours', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
  });

  it('water repeatedly quenches fire and drags amplitude down', () => {
    const fireIdx = placeMode(12, 12, Mode.FIRE);
    const waterIdx = placeMode(13, 12, Mode.WATER);
    world.fire.add(fireIdx);
    const beforeAmp = world.strings[fireIdx].amplitude;

    for(let i = 0; i < 40; i++){
      reactFireWater(fireIdx, waterIdx);
    }

    expect(world.fire.has(fireIdx)).toBe(true);
    expect(world.strings[fireIdx].amplitude).toBeLessThan(beforeAmp);
    expect(world.heat[waterIdx]).toBeGreaterThan(0);
  });

  it('ice stays solid under freeze threshold', () => {
    const waterIdx = placeMode(20, 20, Mode.WATER);
    world.heat[waterIdx] = 0.1;
    handlePhaseTransitions();
    expect(world.strings[waterIdx].mode).toBe(Mode.ICE);
  });

  it('cryofoam TTL falls near acid and converts to ice near base', () => {
    const foamIdx = idx(25, 25);
    ensureCryofoam(foamIdx, { ttl: 6 });
    const initialEntry = world.foamTimers.get(foamIdx);

    placeMode(24, 25, Mode.ACID);
    stepCryofoam();
    const postAcidEntry = world.foamTimers.get(foamIdx);
    expect(postAcidEntry.ttl).toBeLessThan(initialEntry.ttl);

    placeMode(26, 25, Mode.BASE);
    stepCryofoam();
    expect(world.strings[foamIdx].mode).toBe(Mode.ICE);
  });

  it('acid meeting base triggers heat spike only on base tile', () => {
    const acidIdx = placeMode(30, 30, Mode.ACID);
    const baseIdx = placeMode(31, 30, Mode.BASE);
    reactAcidBase(acidIdx, baseIdx, { triggerFlash: false });

    expect(world.heat[acidIdx]).toBe(0);
    expect(world.heat[baseIdx]).toBeGreaterThan(0);
  });
});
