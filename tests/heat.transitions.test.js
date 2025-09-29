import { describe, it, expect, beforeEach } from 'vitest';
import { world, idx } from '../src/state.js';
import { Mode } from '../src/constants.js';
import { handlePhaseTransitions } from '../src/simulation.js';
import { ensureCryofoam, stepCryofoam, reactFireO2 } from '../src/materials.js';
import { initWorld, placeMode } from './helpers/worldHarness.js';
import { thresholds } from '../src/config.js';

const { freezePoint, meltPoint, cryofoam } = thresholds;

describe('heat-driven transitions', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
  });

  it('water/ice tiles respect freeze and melt thresholds across the grid', () => {
    const justWarm = placeMode(5, 5, Mode.WATER);
    world.heat[justWarm] = freezePoint + 0.01;

    const freezing = placeMode(6, 5, Mode.WATER);
    world.heat[freezing] = freezePoint - 0.02;

    const warmIce = placeMode(7, 5, Mode.ICE);
    world.heat[warmIce] = meltPoint + 0.03;

    const coldIce = placeMode(8, 5, Mode.ICE);
    world.heat[coldIce] = meltPoint - 0.03;

    handlePhaseTransitions();

    expect(world.strings[justWarm].mode).toBe(Mode.WATER);
    expect(world.strings[freezing].mode).toBe(Mode.ICE);
    expect(world.heat[freezing]).toBeGreaterThan(freezePoint - 0.02);
    expect(world.strings[warmIce].mode).toBe(Mode.WATER);
    expect(world.heat[warmIce]).toBeLessThan(meltPoint + 0.03);
    expect(world.strings[coldIce].mode).toBe(Mode.ICE);
  });

  it('cryofoam clamps heat and slowly drops amplitude when stepped', () => {
    const tileIdx = idx(10, 10);
    ensureCryofoam(tileIdx, { ttl: 6 });
    const foamState = world.strings[tileIdx];
    foamState.amplitude = 0.6;
    world.heat[tileIdx] = 0.45;

    for(let i = 0; i < 3; i++){
      stepCryofoam();
    }

    const postState = world.strings[tileIdx];
    expect(postState?.mode).toBe(Mode.CRYOFOAM);
    expect(world.heat[tileIdx]).toBeLessThanOrEqual(cryofoam.heatCap + 1e-6);
    expect(postState.amplitude).toBeLessThan(0.6);
  });

  it('fire in low oxygen self-extinguishes while high oxygen boosts heat', () => {
    const fireIdx = placeMode(20, 20, Mode.FIRE);
    world.fire.add(fireIdx);

    // High oxygen scenario
    world.o2[fireIdx] = 0.28;
    const settings = { o2Cut: 0.12 };
    reactFireO2(fireIdx, settings);
    expect(world.heat[fireIdx]).toBeGreaterThan(0);
    const boostedAmplitude = world.strings[fireIdx].amplitude;
    expect(boostedAmplitude).toBeGreaterThan(1);

    // Low oxygen scenario triggers extinguish
    world.o2[fireIdx] = 0.05;
    reactFireO2(fireIdx, settings);
    expect(world.fire.has(fireIdx)).toBe(false);
    expect(world.strings[fireIdx].amplitude).toBeLessThan(boostedAmplitude);
  });
});
