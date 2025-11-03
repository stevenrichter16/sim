import { describe, it, expect, beforeEach } from 'vitest';
import { idx, world } from '../src/state.js';
import {
  FactoryKind,
  FactoryItem,
  placeFactoryStructure,
  stepFactory,
  getFactoryOwnership,
} from '../src/factory.js';
import { initWorld } from './helpers/worldHarness.js';

function orient(value){
  return { orientation: value };
}

describe('factory ownership influence tracking', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
  });

  it('assigns nodes and structures to the dominant faction within influence', () => {
    const tile = idx(12, 12);

    const nodeResult = placeFactoryStructure(tile, 'factory-node-skin');
    expect(nodeResult.ok).toBe(true);

    const minerResult = placeFactoryStructure(tile, 'factory-miner', orient('south'));
    expect(minerResult.ok).toBe(true);

    world.dominantFaction[tile] = 1;
    world.controlLevel[tile] = 0.6;

    stepFactory();

    const ownership = getFactoryOwnership();
    const factionRecord = ownership.byFaction.find((entry) => entry.factionId === 1);
    expect(factionRecord).toBeTruthy();
    expect(factionRecord.objects.some((entry) => entry.type === 'structure' && entry.kind === FactoryKind.MINER && entry.tileIdx === tile)).toBe(true);
    expect(factionRecord.objects.some((entry) => entry.type === 'node' && entry.resource === FactoryItem.SKIN_PATCH && entry.tileIdx === tile)).toBe(true);
    const minerEntry = factionRecord.objects.find((entry) => entry.kind === FactoryKind.MINER && entry.tileIdx === tile);
    expect(minerEntry?.control).toBeCloseTo(0.6, 2);
  });

  it('moves structures from unassigned to faction ownership as influence grows', () => {
    const tile = idx(18, 9);
    const beltResult = placeFactoryStructure(tile, 'factory-belt', orient('east'));
    expect(beltResult.ok).toBe(true);

    world.dominantFaction[tile] = 2;
    world.controlLevel[tile] = 0.02;

    stepFactory();

    let ownership = getFactoryOwnership();
    let unassigned = ownership.unassigned.find((entry) => entry.tileIdx === tile && entry.kind === FactoryKind.BELT);
    expect(unassigned).toBeTruthy();
    expect(unassigned.dominantFactionId).toBe(2);

    world.controlLevel[tile] = 0.5;

    stepFactory();

    ownership = getFactoryOwnership();
    const factionC = ownership.byFaction.find((entry) => entry.factionId === 2);
    expect(factionC.objects.some((entry) => entry.tileIdx === tile && entry.kind === FactoryKind.BELT)).toBe(true);
    unassigned = ownership.unassigned.find((entry) => entry.tileIdx === tile && entry.kind === FactoryKind.BELT);
    expect(unassigned).toBeUndefined();
  });
});
