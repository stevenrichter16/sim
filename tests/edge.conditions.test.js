import { describe, it, expect, beforeEach } from 'vitest';
import { world, idx, resetWorld } from '../src/state.js';
import { Mode } from '../src/constants.js';
import { couple, reactFireO2 } from '../src/materials.js';
import { handlePhaseTransitions } from '../src/simulation.js';

function initBareWorld(){
  resetWorld(0.21);
}

describe('edge conditions', () => {
  beforeEach(() => {
    initBareWorld();
  });

  it('couple returns 0 when amplitudes are zero', () => {
    const A = { phase: 0, amplitude: 0, tension: 0.1 };
    const B = { phase: 0, amplitude: 0, tension: 0.1 };
    expect(couple(A, B, 1)).toBe(0);
  });

  it('handlePhaseTransitions ignores walls/out-of-bounds gracefully', () => {
    world.wall[idx(0, 0)] = 1;
    expect(() => handlePhaseTransitions()).not.toThrow();
  });

  it('reactFireO2 on non-fire tile does nothing harmful', () => {
    const tileIdx = idx(10, 10);
    world.strings[tileIdx] = { mode: Mode.WATER, amplitude: 0.1, tension: 0.8, phase: 0 };
    world.fire.delete(tileIdx);
    expect(() => reactFireO2(tileIdx, { o2Cut: 0.12 })).not.toThrow();
    expect(world.strings[tileIdx].mode).toBe(Mode.WATER);
  });
});
