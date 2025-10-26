import { describe, it, expect, beforeEach } from 'vitest';
import { idx, world } from '../src/state.js';
import { initWorld } from './helpers/worldHarness.js';
import {
  resetFactoryState,
  enqueueFactoryJob,
  getFactoryJobQueue,
  spawnFactoryWorker,
  getFactoryWorkers,
  stepFactoryWorkers,
  setFactoryWorkerSpawner,
  FactoryItem,
} from '../src/factory.js';

describe('factory workers', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
    resetFactoryState();
    setFactoryWorkerSpawner((tileIdx) => {
      if(tileIdx == null) return null;
      return {
        id: `stub-${tileIdx}`,
        tileIdx,
        x: tileIdx % world.W,
        y: Math.floor(tileIdx / world.W),
      };
    });
  });

  it('spawns workers in idle state', () => {
    const tile = idx(5, 5);
    const result = spawnFactoryWorker(tile);
    expect(result.ok).toBe(true);
    const { workers, agents } = getFactoryWorkers();
    expect(workers).toHaveLength(1);
    expect(agents).toHaveLength(1);
    expect(workers[0]).toEqual(expect.objectContaining({
      state: 'idle',
      tileIdx: tile,
      job: null,
    }));
    expect(agents[0]).toEqual(expect.objectContaining({ workerId: workers[0].id }));
  });

  it('assigns jobs FIFO and completes them after dwell duration', () => {
    spawnFactoryWorker(idx(6, 6));
    enqueueFactoryJob({ kind: 'mine', tileIdx: idx(6, 6), payload: { duration: 2 } });
    enqueueFactoryJob({ kind: 'deliver', tileIdx: idx(7, 6), payload: { duration: 1, item: FactoryItem.SKIN_PATCH } });

    // Initial step: worker should claim the first job.
    stepFactoryWorkers();
    let { workers } = getFactoryWorkers();
    expect(getFactoryJobQueue()).toHaveLength(1);
    expect(['working', 'moving']).toContain(workers[0].state);
    expect(workers[0].job?.kind).toBe('mine');

    // Second step: first job should still be in progress (duration 2 -> completes now).
    stepFactoryWorkers();
    workers = getFactoryWorkers().workers;
    expect(workers[0].state).toBe('idle');
    expect(workers[0].job).toBeNull();

    // Third step: worker picks up output job, queue still has delivery pending.
    stepFactoryWorkers();
    workers = getFactoryWorkers().workers;
    expect(getFactoryJobQueue()).toHaveLength(1);
    // Fourth step: delivery job completes.
    stepFactoryWorkers();
    workers = getFactoryWorkers().workers;
    expect(getFactoryJobQueue()).toHaveLength(1);
    expect(workers[0].state).toBe('idle');
    expect(workers[0].job).toBeNull();
  });
});
