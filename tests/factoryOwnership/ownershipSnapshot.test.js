import { describe, it, expect } from 'vitest';
import { computeOwnershipEntries } from '../../src/factoryOwnership/transform/ownershipSnapshot.js';
import {
  makeBasicOwnershipSnapshot,
  makeContestedOwnershipSnapshot,
} from './__fixtures__/ownershipSnapshots.js';

function byFactionToObject(map){
  const result = {};
  for(const [factionId, list] of map.entries()){
    result[factionId] = list.map((entry) => entry.id);
  }
  return result;
}

describe('computeOwnershipEntries', () => {
  it('assigns nodes and structures to factions when influence is above the threshold', () => {
    const snapshot = makeBasicOwnershipSnapshot();
    const result = computeOwnershipEntries(snapshot);

    expect(result.entries.map((entry) => entry.id)).toEqual([
      'node:14:node',
      'structure:26:smelter',
    ]);

    expect(byFactionToObject(result.byFaction)).toEqual({
      1: ['node:14:node', 'structure:26:smelter'],
    });

    const smelter = result.entries.find((entry) => entry.id === 'structure:26:smelter');
    expect(smelter.orientation).toBe('north');
    expect(smelter.control).toBeCloseTo(0.72, 5);
  });

  it('marks nodes without sufficient influence as unassigned while preserving dominant faction info', () => {
    const snapshot = makeContestedOwnershipSnapshot();
    const result = computeOwnershipEntries(snapshot);

    const nodeEntry = result.entries.find((entry) => entry.id === 'node:30:node');
    expect(nodeEntry.factionId).toBeNull();
    expect(nodeEntry.dominantFactionId).toBe(2);

    expect(result.unassigned.map((entry) => entry.id)).toEqual(['node:30:node']);

    const beltEntry = result.entries.find((entry) => entry.type === 'structure');
    expect(beltEntry.factionId).toBe(3);
    expect(beltEntry.orientation).toBe('east');
  });
});
