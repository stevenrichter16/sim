import { describe, it, expect, beforeEach } from 'vitest';
import { world } from '../src/state.js';
import { Mode } from '../src/constants.js';
import { handlePhaseTransitions } from '../src/simulation.js';
import { initWorld, placeMode, tileIndex } from './helpers/worldHarness.js';

describe('phase transitions', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
  });

  it('freezes water to ice when heat drops below freeze point', () => {
    const idx = placeMode(8, 8, Mode.WATER);
    world.heat[idx] = 0.1; // below FREEZE_POINT 0.15

    handlePhaseTransitions();

    expect(world.strings[idx].mode).toBe(Mode.ICE);
    expect(world.heat[idx]).toBeGreaterThan(0.1);
  });

  it('melts ice back to water when heat exceeds melt point', () => {
    const idx = placeMode(12, 12, Mode.ICE);
    world.heat[idx] = 0.25; // above MELT_POINT 0.20

    handlePhaseTransitions();

    expect(world.strings[idx].mode).toBe(Mode.WATER);
    expect(world.heat[idx]).toBeLessThan(0.25);
  });
});
