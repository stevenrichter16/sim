import { describe, it, expect, beforeEach } from 'vitest';
import {
  world,
  resetWorld,
  allocateAgentId,
  registerAgentHandle,
  updateAgentIndex,
  unregisterAgentHandle,
  getAgentById,
  getAgentIndex,
  rebuildAgentIndices,
} from '../src/state.js';

beforeEach(() => {
  resetWorld(0.21);
});

describe('agent handle bookkeeping', () => {
  it('allocates monotonically increasing agent ids', () => {
    const first = allocateAgentId();
    const second = allocateAgentId();
    expect(first).toBe(1);
    expect(second).toBe(2);
  });

  it('registers agents and tracks their indices', () => {
    const id = allocateAgentId();
    const agent = { id, name: 'tester' };
    registerAgentHandle(agent, 5);

    expect(getAgentById(id)).toBe(agent);
    expect(getAgentIndex(id)).toBe(5);
  });

  it('updates stored indices when agents move within the list', () => {
    const id = allocateAgentId();
    const agent = { id };
    registerAgentHandle(agent, 0);

    updateAgentIndex(id, 7);
    expect(getAgentIndex(id)).toBe(7);
  });

  it('unregisters agents cleanly', () => {
    const id = allocateAgentId();
    const agent = { id };
    registerAgentHandle(agent, 3);

    unregisterAgentHandle(id);
    expect(getAgentById(id)).toBeNull();
    expect(getAgentIndex(id)).toBe(-1);
  });

  it('rebuilds handle maps from the current agent list', () => {
    const idA = allocateAgentId();
    const idB = allocateAgentId();
    const agentA = { id: idA, tag: 'A' };
    const agentB = { id: idB, tag: 'B' };
    world.agents.push(agentA, agentB);

    world.agentHandles.clear();
    world.agentIndexById.clear();

    rebuildAgentIndices();

    expect(getAgentById(idA)).toBe(agentA);
    expect(getAgentById(idB)).toBe(agentB);
    expect(getAgentIndex(idA)).toBe(0);
    expect(getAgentIndex(idB)).toBe(1);
  });
});
