import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { idx, world } from '../src/state.js';
import {
  placeFactoryStructure,
  stepFactory,
} from '../src/factory.js';
import { initWorld } from './helpers/worldHarness.js';

describe('trace:factory-ownership script', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
  });

  it('outputs JSON when invoked with --json flag', () => {
    const nodeTile = idx(5, 5);
    const forgeTile = idx(6, 5);
    expect(placeFactoryStructure(nodeTile, 'factory-node-skin').ok).toBe(true);
    expect(placeFactoryStructure(forgeTile, 'factory-smelter-omni').ok).toBe(true);
    world.dominantFaction[nodeTile] = 1;
    world.controlLevel[nodeTile] = 0.6;
    world.dominantFaction[forgeTile] = 1;
    world.controlLevel[forgeTile] = 0.6;
    stepFactory();

    const result = spawnSync('node', ['scripts/trace-factory-ownership.mjs', '--json'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout.trim());
    expect(Array.isArray(payload.bundles)).toBe(true);
    expect(Array.isArray(payload.manualWarnings)).toBe(true);
  });
});
