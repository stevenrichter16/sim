import { describe, it, expect, beforeEach } from 'vitest';
import { Mode } from '../src/constants.js';
import { world, idx } from '../src/state.js';
import { scenarioIgnite } from '../src/simulation.js';
import { initWorld } from './helpers/worldHarness.js';

describe('scenario natives', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
  });

  describe('scenarioIgnite', () => {
    it('ignites an open tile with requested intensity', () => {
      const tile = idx(8, 8);
      world.heat[tile] = 0.05;
      world.o2[tile] = 0.2;

      const res = scenarioIgnite(tile, 1.4);
      expect(res.ok).toBe(true);
      expect(res.tileIdx).toBe(tile);
      expect(res.intensity).toBeCloseTo(1.4, 5);

      const S = world.strings[tile];
      expect(S.mode).toBe(Mode.FIRE);
      expect(S.amplitude).toBeGreaterThanOrEqual(1.4);
      expect(world.fire.has(tile)).toBe(true);
      expect(world.heat[tile]).toBeGreaterThan(0.05);
      expect(world.o2[tile]).toBeLessThan(0.2);
    });

    it('propagates ignite failure for blocked tiles', () => {
      const tile = idx(1, 1);
      world.wall[tile] = 1;
      const res = scenarioIgnite(tile, 1);
      expect(res.ok).toBe(false);
      expect(res.error).toBe('blocked');
      expect(world.fire.has(tile)).toBe(false);
    });
  });
});
