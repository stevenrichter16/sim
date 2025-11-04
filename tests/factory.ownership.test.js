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

  it('adds controlled nodes and bioforges to faction cloud clusters with auto links', () => {
    const factionId = 1;
    const skinTile = idx(8, 8);
    const forgeTile = idx(9, 8);

    expect(placeFactoryStructure(skinTile, 'factory-node-skin').ok).toBe(true);
    expect(placeFactoryStructure(forgeTile, 'factory-smelter-omni', orient('north')).ok).toBe(true);

    world.dominantFaction[skinTile] = factionId;
    world.controlLevel[skinTile] = 0.7;
    world.dominantFaction[forgeTile] = factionId;
    world.controlLevel[forgeTile] = 0.72;

    stepFactory();

    const clusterId = `faction-${factionId}-cloud`;
    const registry = world.factory.cloudClusters;
    expect(registry.byId.has(clusterId)).toBe(true);
    expect(registry.order).toContain(clusterId);
    const cluster = registry.byId.get(clusterId);
    const nodeObjectId = `node-${FactoryKind.NODE}-${skinTile}`;
    const smelterObjectId = `structure-${FactoryKind.SMELTER}-${forgeTile}`;
    expect(cluster.objects.has(nodeObjectId)).toBe(true);
    expect(cluster.objects.has(smelterObjectId)).toBe(true);

    const smelter = cluster.objects.get(smelterObjectId);
    const intake = smelter.ports.find((port) => port.id === 'in');
    expect(intake).toBeTruthy();
    expect(intake.itemKeys).toEqual(expect.arrayContaining([
      FactoryItem.SKIN_PATCH,
      FactoryItem.BLOOD_VIAL,
      FactoryItem.ORGAN_MASS,
    ]));

    const linkId = `auto:faction:${clusterId}:${nodeObjectId}->${smelterObjectId}:${FactoryItem.SKIN_PATCH}`;
    expect(cluster.links.has(linkId)).toBe(true);
    expect(cluster.links.get(linkId)?.metadata?.auto).toBe(true);
  });

  it('links multiple resource providers required by a bioforge recipe', () => {
    const factionId = 1;
    const nerveTiles = [idx(14, 6), idx(15, 6)];
    const bloodTile = idx(16, 6);
    const forgeTile = idx(17, 6);

    expect(placeFactoryStructure(nerveTiles[0], 'factory-node-nerve').ok).toBe(true);
    expect(placeFactoryStructure(nerveTiles[1], 'factory-node-nerve').ok).toBe(true);
    expect(placeFactoryStructure(bloodTile, 'factory-node-blood').ok).toBe(true);
    expect(placeFactoryStructure(forgeTile, 'factory-smelter-omni', orient('east')).ok).toBe(true);

    for(const tile of [...nerveTiles, bloodTile, forgeTile]){
      world.dominantFaction[tile] = factionId;
      world.controlLevel[tile] = 0.6;
    }

    stepFactory();

    const clusterId = `faction-${factionId}-cloud`;
    const registry = world.factory.cloudClusters;
    const cluster = registry.byId.get(clusterId);
    expect(cluster).toBeTruthy();

    const smelterObjectId = `structure-${FactoryKind.SMELTER}-${forgeTile}`;
    const autoLinks = Array.from(cluster.links.values()).filter((link) => link?.metadata?.auto && link?.target?.objectId === smelterObjectId);

    const nerveLinks = autoLinks.filter((link) => link.metadata?.item === FactoryItem.NERVE_THREAD);
    const bloodLinks = autoLinks.filter((link) => link.metadata?.item === FactoryItem.BLOOD_VIAL);

    const expectedNerveSources = new Set(nerveTiles.map((tile) => `node-${FactoryKind.NODE}-${tile}`));
    expect(new Set(nerveLinks.map((link) => link.source.objectId))).toEqual(expectedNerveSources);

    const expectedBloodSource = `node-${FactoryKind.NODE}-${bloodTile}`;
    expect(bloodLinks.some((link) => link.source.objectId === expectedBloodSource)).toBe(true);
  });

  it('removes objects from faction cloud clusters when influence is lost', () => {
    const factionId = 2;
    const nodeTile = idx(11, 5);
    expect(placeFactoryStructure(nodeTile, 'factory-node-blood').ok).toBe(true);
    world.dominantFaction[nodeTile] = factionId;
    world.controlLevel[nodeTile] = 0.51;
    stepFactory();

    const clusterId = `faction-${factionId}-cloud`;
    const registry = world.factory.cloudClusters;
    let cluster = registry.byId.get(clusterId);
    const nodeObjectId = `node-${FactoryKind.NODE}-${nodeTile}`;
    expect(cluster?.objects.has(nodeObjectId)).toBe(true);

    world.controlLevel[nodeTile] = 0.01;
    stepFactory();

    cluster = registry.byId.get(clusterId);
    expect(cluster).toBeUndefined();
    expect(registry.order.includes(clusterId)).toBe(false);
  });
});
