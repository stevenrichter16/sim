import { describe, it, expect, beforeEach } from 'vitest';
import { initWorld } from './helpers/worldHarness.js';
import {
  resetFactoryState,
  enqueueFactoryJob,
  spawnFactoryWorker,
  getFactoryDiagnostics,
  setFactoryWorkerSpawner,
  FactoryItem,
} from '../src/factory.js';
import { Mode } from '../src/constants.js';
import { idx, world } from '../src/state.js';

describe('factory diagnostics', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
    resetFactoryState();
    setFactoryWorkerSpawner((tileIdx) => ({
      id: `stub-${tileIdx}`,
      tileIdx,
      x: tileIdx % world.W,
      y: (tileIdx / world.W) | 0,
      role: Mode.CALM,
    }));
  });

  it('summarises queue and worker state', () => {
    enqueueFactoryJob({ kind: 'deliver', tileIdx: idx(3, 3), payload: { item: FactoryItem.IRON_ORE } });
    spawnFactoryWorker(idx(1, 1));
    const diagnostics = getFactoryDiagnostics();
    expect(diagnostics.queueLength).toBe(1);
    expect(diagnostics.queue[0]).toEqual(expect.objectContaining({ kind: 'deliver' }));
    expect(diagnostics.workers).toHaveLength(1);
    expect(diagnostics.workers[0]).toEqual(expect.objectContaining({ state: 'idle', carrying: null }));
  });
});
