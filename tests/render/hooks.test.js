import { describe, it, expect, beforeEach } from 'vitest';
import { emitParticleBurst, drainParticleBursts, emitFlash, drainFlashes } from '../../src/effects.js';
import { reactAcidBase } from '../../src/materials.js';
import { initWorld, placeMode } from '../helpers/worldHarness.js';
import { Mode } from '../../src/constants.js';

describe('render/particle hooks', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
    // empty any queued effects
    drainParticleBursts();
    drainFlashes();
  });

  it('explicit emitParticleBurst queues bursts with correct metadata', () => {
    emitParticleBurst(10, 12, { type: 'steam', intensity: 0.5 });
    const bursts = drainParticleBursts();
    expect(bursts.length).toBe(1);
    expect(bursts[0]).toEqual({ x: 10, y: 12, type: 'steam', intensity: 0.5 });
  });

  it('acid/base first encounter emits a flash once', () => {
    const acidIdx = placeMode(5, 5, Mode.ACID);
    const baseIdx = placeMode(6, 5, Mode.BASE);

    reactAcidBase(acidIdx, baseIdx, { triggerFlash: true });
    const flashesFirst = drainFlashes();
    expect(flashesFirst.length).toBeGreaterThan(0);

    // Subsequent reaction should not emit new flash when triggerFlash=false
    reactAcidBase(acidIdx, baseIdx, { triggerFlash: false });
    const flashesSecond = drainFlashes();
    expect(flashesSecond.length).toBe(0);
  });
});
