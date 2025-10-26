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

  it('assembles humans when the biofoundry loop is fed', () => {
    const skinNode = idx(18, 19);
    const bloodNode = idx(19, 19);
    const organNode = idx(20, 19);

    placeFactoryStructure(skinNode, 'factory-node-skin');
    placeFactoryStructure(bloodNode, 'factory-node-blood');
    placeFactoryStructure(organNode, 'factory-node-organ');

    placeFactoryStructure(skinNode, 'factory-miner', buildOrientation('south'));
    placeFactoryStructure(bloodNode, 'factory-miner', buildOrientation('south'));
    placeFactoryStructure(organNode, 'factory-miner', buildOrientation('south'));

    placeFactoryStructure(idx(18, 20), 'factory-belt', buildOrientation('east'));
    placeFactoryStructure(idx(19, 20), 'factory-belt', buildOrientation('east'));
    placeFactoryStructure(idx(20, 20), 'factory-belt', buildOrientation('east'));
    placeFactoryStructure(idx(21, 20), 'factory-belt', buildOrientation('east'));
    placeFactoryStructure(idx(22, 20), 'factory-smelter', buildOrientation('east'));
    placeFactoryStructure(idx(23, 20), 'factory-constructor', buildOrientation('east'));
    placeFactoryStructure(idx(24, 20), 'factory-storage', buildOrientation('east'));

    spawnFactoryWorker(skinNode);
    spawnFactoryWorker(bloodNode);
    spawnFactoryWorker(organNode);
    spawnFactoryWorker(idx(22, 20));
    spawnFactoryWorker(idx(23, 20));

    for(let i = 0; i < 600; i += 1){
      stepFactory();
    }

    const status = getFactoryStatus();
    expect(status.produced.skin).toBeGreaterThan(0);
    expect(status.produced.blood).toBeGreaterThan(0);
    expect(status.produced.organs).toBeGreaterThan(0);
    expect(status.produced.systems).toBeGreaterThan(0);
    expect(status.stored.humans).toBeGreaterThan(0);
  });
});
