import { describe, it, expect, beforeEach } from 'vitest';
import { Mode } from '../src/constants.js';
import { world, idx } from '../src/state.js';
import { igniteTile } from '../src/simulation.js';
import { initWorld } from './helpers/worldHarness.js';

describe('igniteTile intensity handling', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
  });

  it('raises amplitude and heat according to intensity', () => {
    const tile = idx(10, 10);
    world.heat[tile] = 0.1;
    world.o2[tile] = 0.2;

    const result = igniteTile(tile, 0.6);
    expect(result.ok).toBe(true);
    expect(result.intensity).toBeCloseTo(0.6, 5);

    const S = world.strings[tile];
    expect(S.mode).toBe(Mode.FIRE);
    expect(S.amplitude).toBeGreaterThanOrEqual(0.6);
    expect(world.heat[tile]).toBeGreaterThan(0.1);
    expect(world.o2[tile]).toBeLessThan(0.2);
  });

  it('clamps intensity to safe range', () => {
    const tile = idx(12, 12);
    const result = igniteTile(tile, 5);
    expect(result.ok).toBe(true);
    expect(result.intensity).toBeLessThanOrEqual(2);
    const S = world.strings[tile];
    expect(S.amplitude).toBeLessThanOrEqual(2);
  });

  it('does not overwrite higher existing amplitude with lower intensity', () => {
    const tile = idx(14, 14);
    igniteTile(tile, 1.5);
    const ampBefore = world.strings[tile].amplitude;
    igniteTile(tile, 0.5);
    const S = world.strings[tile];
    expect(S.amplitude).toBeCloseTo(ampBefore, 5);
  });

  it('fails on blocked tiles', () => {
    const tile = idx(1, 1);
    world.wall[tile] = 1;
    const result = igniteTile(tile, 1);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('blocked');
  });
});
