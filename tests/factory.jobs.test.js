import { describe, it, expect, beforeEach } from 'vitest';
import { initWorld } from './helpers/worldHarness.js';
import {
  resetFactoryState,
  enqueueFactoryJob,
  getFactoryJobQueue,
  popFactoryJob,
  peekFactoryJob,
} from '../src/factory.js';

describe('factory job queue', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
    resetFactoryState();
  });

  it('starts with an empty queue', () => {
    const queue = getFactoryJobQueue();
    expect(Array.isArray(queue)).toBe(true);
    expect(queue.length).toBe(0);
    expect(peekFactoryJob()).toBeNull();
  });

  it('enqueues and pops jobs FIFO', () => {
    enqueueFactoryJob({ kind: 'mine', tileIdx: 1 });
    enqueueFactoryJob({ kind: 'deliver', tileIdx: 2 });
    expect(getFactoryJobQueue()).toHaveLength(2);
    expect(peekFactoryJob()).toEqual(expect.objectContaining({ kind: 'mine' }));
    const first = popFactoryJob();
    expect(first.kind).toBe('mine');
    const second = popFactoryJob();
    expect(second.kind).toBe('deliver');
    expect(popFactoryJob()).toBeNull();
  });

  it('ignores invalid job payloads', () => {
    enqueueFactoryJob(null);
    enqueueFactoryJob({});
    expect(getFactoryJobQueue()).toHaveLength(0);
  });
});
