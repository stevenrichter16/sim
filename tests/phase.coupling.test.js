import { describe, it, expect, beforeEach } from 'vitest';
import { world } from '../src/state.js';
import { Mode, TAU } from '../src/constants.js';
import { couple } from '../src/materials.js';
import { reactFireWater } from '../src/materials.js';
import { initWorld, placeMode } from './helpers/worldHarness.js';

describe('phase and coupling behaviour', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
  });

  it('couple() gives larger gain when phases align', () => {
    const A = { phase: 0, amplitude: 0.8, tension: 0.2 };
    const B = { phase: 0, amplitude: 0.8, tension: 0.2 };
    const C = { phase: TAU / 2, amplitude: 0.8, tension: 0.2 };

    const aligned = couple(A, B, 1.0);
    const opposite = couple(A, C, 1.0);

    expect(aligned).toBeGreaterThan(opposite);
    expect(opposite).toBeGreaterThanOrEqual(0);
  });

  it('couple() dampens gain when participants are tense', () => {
    const loose = { phase: 0, amplitude: 0.7, tension: 0.1 };
    const tense = { phase: 0, amplitude: 0.7, tension: 0.9 };

    const loosePair = couple(loose, loose, 1.0);
    const tensePair = couple(loose, tense, 1.0);

    expect(loosePair).toBeGreaterThan(tensePair);
  });

  it('reactFireWater rotates fire phase forward', () => {
    const fireIdx = placeMode(20, 20, Mode.FIRE);
    const waterIdx = placeMode(21, 20, Mode.WATER);
    world.fire.add(fireIdx);
    const initialPhase = world.strings[fireIdx].phase;

    reactFireWater(fireIdx, waterIdx);

    const updatedPhase = world.strings[fireIdx].phase;
    expect(updatedPhase).not.toBe(initialPhase);
  });
});
