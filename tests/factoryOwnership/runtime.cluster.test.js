import { describe, it, expect, beforeEach } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { createRequire } from 'node:module';
import { idx, world } from '../../src/state.js';
import {
  FactoryKind,
  placeFactoryStructure,
  stepFactory,
  getFactoryOwnership,
} from '../../src/factory.js';
import { initWorld } from '../helpers/worldHarness.js';
import { upsertLink } from '../../src/cloudCluster/domain/cluster.js';

const ajv = new Ajv2020({ strict: false, allErrors: true });
const require = createRequire(import.meta.url);
const contractsSchema = require('../../src/factoryOwnership/model/contracts.schema.json');
const validateBundle = ajv.compile(contractsSchema);

describe('factory ownership runtime diff bundles', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
  });

  it('emits schema-valid diff bundles with version metadata', () => {
    const factionId = 1;
    const nodeTile = idx(8, 8);
    const forgeTile = idx(9, 8);

    expect(placeFactoryStructure(nodeTile, 'factory-node-skin').ok).toBe(true);
    expect(placeFactoryStructure(forgeTile, 'factory-smelter-omni').ok).toBe(true);

    world.dominantFaction[nodeTile] = factionId;
    world.controlLevel[nodeTile] = 0.65;
    world.dominantFaction[forgeTile] = factionId;
    world.controlLevel[forgeTile] = 0.72;

    stepFactory();

    const ownership = getFactoryOwnership();
    expect(Array.isArray(ownership.diffBundles)).toBe(true);
    expect(ownership.diffBundles.length).toBeGreaterThan(0);

    for(const envelope of ownership.diffBundles){
      expect(envelope.bundle?.version).toBe('v1');
      expect(validateBundle(envelope.bundle)).toBe(true);
    }
  });

  it('records manual link warnings when user links are dropped', () => {
    const factionId = 1;
    const nodeTile = idx(10, 6);
    const forgeTile = idx(11, 6);

    expect(placeFactoryStructure(nodeTile, 'factory-node-nerve').ok).toBe(true);
    expect(placeFactoryStructure(forgeTile, 'factory-smelter-omni').ok).toBe(true);

    world.dominantFaction[nodeTile] = factionId;
    world.controlLevel[nodeTile] = 0.7;
    world.dominantFaction[forgeTile] = factionId;
    world.controlLevel[forgeTile] = 0.72;

    stepFactory();

    const clusterId = `faction-${factionId}-cloud`;
    const cluster = world.factory.cloudClusters.byId.get(clusterId);
    expect(cluster).toBeTruthy();
    const nodeObjectId = `node-${FactoryKind.NODE}-${nodeTile}`;
    const smelterObjectId = `structure-${FactoryKind.SMELTER}-${forgeTile}`;

    upsertLink(cluster, {
      id: 'manual:user-link',
      source: { objectId: nodeObjectId, portId: 'out' },
      target: { objectId: smelterObjectId, portId: 'in' },
      metadata: { reason: 'user-defined' },
    });

    // Remove faction influence so the node is dropped from the cluster.
    world.controlLevel[nodeTile] = 0;
    world.dominantFaction[nodeTile] = -1;

    stepFactory();

    const ownership = getFactoryOwnership();
    expect(Array.isArray(ownership.manualLinkWarnings)).toBe(true);
    const warning = ownership.manualLinkWarnings.find((entry) => entry.clusterId === clusterId);
    expect(warning).toBeTruthy();
    expect(warning.droppedLinks.some((link) => link.id === 'manual:user-link')).toBe(true);
  });

  it('exposes manual link reconciliation data alongside diff bundles', () => {
    const factionId = 1;
    const nodeTile = idx(7, 7);
    const forgeTile = idx(8, 7);

    expect(placeFactoryStructure(nodeTile, 'factory-node-nerve').ok).toBe(true);
    expect(placeFactoryStructure(forgeTile, 'factory-smelter-omni').ok).toBe(true);

    world.dominantFaction[nodeTile] = factionId;
    world.controlLevel[nodeTile] = 0.6;
    world.dominantFaction[forgeTile] = factionId;
    world.controlLevel[forgeTile] = 0.7;

    stepFactory();

    const ownership = getFactoryOwnership();
    expect(Array.isArray(ownership.manualLinkReconciliation)).toBe(true);
    const clusterId = `faction-${factionId}-cloud`;
    const reconciliation = ownership.manualLinkReconciliation.find((entry) => entry.clusterId === clusterId);
    expect(reconciliation).toBeTruthy();
    expect(reconciliation.reconciliation).toMatchObject({
      preservedLinks: expect.any(Array),
      droppedLinks: expect.any(Array),
      missingTargets: expect.any(Array),
    });
  });
});
