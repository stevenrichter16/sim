import { describe, it, expect, beforeEach } from 'vitest';
import { idx } from '../src/state.js';
import { placeFactoryStructure, stepFactory, getFactoryStatus, spawnFactoryWorker, setFactoryWorkerSpawner, FactoryItem } from '../src/factory.js';
import { world } from '../src/state.js';
import { initWorld } from './helpers/worldHarness.js';

function buildOrientation(value){
  return { orientation: value };
}

describe('factory logistics loop', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
    setFactoryWorkerSpawner((tileIdx) => {
      if(tileIdx == null) return null;
      const x = tileIdx % world.W;
      const y = (tileIdx / world.W) | 0;
      return { id: `worker-${tileIdx}`, x, y };
    });
  });

  it('requires an ore node before placing a miner', () => {
    const tile = idx(10, 10);
    const result = placeFactoryStructure(tile, 'factory-miner', buildOrientation('east'));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('miner-needs-node');
  });

  it('produces plates when a full chain is assembled', () => {
    const base = idx(20, 20);
    placeFactoryStructure(base, 'factory-node');
    placeFactoryStructure(base, 'factory-miner', buildOrientation('east'));
    placeFactoryStructure(idx(21, 20), 'factory-belt', buildOrientation('east'));
    placeFactoryStructure(idx(22, 20), 'factory-smelter', buildOrientation('east'));
    placeFactoryStructure(idx(23, 20), 'factory-belt', buildOrientation('east'));
    placeFactoryStructure(idx(24, 20), 'factory-constructor', buildOrientation('east'));
    placeFactoryStructure(idx(25, 20), 'factory-belt', buildOrientation('east'));
    placeFactoryStructure(idx(26, 20), 'factory-storage', buildOrientation('east'));

    spawnFactoryWorker(base);
    spawnFactoryWorker(idx(23, 20));

    for(let i = 0; i < 220; i += 1){
      stepFactory();
    }

    const status = getFactoryStatus();
    expect(status.produced.ore).toBeGreaterThan(0);
    expect(status.produced.ingot).toBeGreaterThan(0);
    expect(status.produced.plate).toBeGreaterThan(0);
    expect(status.stored.plate).toBeGreaterThan(0);
  });
});
