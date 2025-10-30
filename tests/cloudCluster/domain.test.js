import { describe, it, expect } from 'vitest';
import { FactoryKind } from '../../src/factory.js';
import {
  createFactoryObject,
  createCluster,
  serialiseCluster,
  cloneCluster,
  deserialiseCloudClusters,
  serialiseCloudClusters,
  hydrateRegistryFromPayload,
  createCloudClusterRegistry,
  loadCloudClustersIntoFactory,
  exportCloudClustersFromFactory,
} from '../../src/cloudCluster/index.js';

function sampleClusterPayload(){
  return {
    id: 'alpha',
    name: 'Alpha Cluster',
    description: 'Test cluster',
    objects: [
      {
        id: 'miner-1',
        kind: FactoryKind.MINER,
        ports: [
          { id: 'ore-out', direction: 'output', label: 'Ore Output' },
        ],
      },
      {
        id: 'smelter-1',
        kind: FactoryKind.SMELTER,
        ports: [
          { id: 'ore-in', direction: 'input', label: 'Ore Input' },
        ],
      },
    ],
    links: [
      {
        id: 'ore-flow',
        source: { objectId: 'miner-1', portId: 'ore-out' },
        target: { objectId: 'smelter-1', portId: 'ore-in' },
      },
    ],
  };
}

describe('cloud cluster domain', () => {
  it('creates factory objects with validated kinds and ports', () => {
    const object = createFactoryObject({
      id: 'miner-1',
      kind: FactoryKind.MINER,
      ports: [{ id: 'ore-out', direction: 'output' }],
    });
    expect(object.kind).toBe(FactoryKind.MINER);
    expect(object.ports).toHaveLength(1);
    expect(object.ports[0].direction).toBe('output');
  });

  it('creates clusters and validates link directions', () => {
    const cluster = createCluster(sampleClusterPayload());
    expect(cluster.objects.size).toBe(2);
    expect(cluster.links.size).toBe(1);
  });

  it('rejects links that connect invalid port directions', () => {
    const payload = sampleClusterPayload();
    payload.links[0].target = { objectId: 'miner-1', portId: 'ore-out' };
    expect(() => createCluster(payload)).toThrow(/target must be an input port/i);
  });

  it('serialises and clones clusters consistently', () => {
    const cluster = createCluster(sampleClusterPayload());
    const serialised = serialiseCluster(cluster);
    expect(serialised.objects).toHaveLength(2);
    const clone = cloneCluster(cluster);
    expect(clone).not.toBe(cluster);
    expect(clone.objects.size).toBe(cluster.objects.size);
  });
});

describe('cloud cluster registry and factory integration', () => {
  it('hydrated registry preserves cluster ordering', () => {
    const registry = deserialiseCloudClusters([
      sampleClusterPayload(),
      { ...sampleClusterPayload(), id: 'beta', name: 'Beta Cluster' },
    ]);
    expect(registry.order).toEqual(['alpha', 'beta']);
    const output = serialiseCloudClusters(registry);
    expect(output).toHaveLength(2);
  });

  it('hydrates an existing registry instance', () => {
    const registry = createCloudClusterRegistry();
    hydrateRegistryFromPayload(registry, [sampleClusterPayload()]);
    expect(registry.byId.has('alpha')).toBe(true);
  });

  it('loads and exports clusters via factory adapter', () => {
    const factoryState = { cloudClusters: createCloudClusterRegistry() };
    loadCloudClustersIntoFactory(factoryState, [sampleClusterPayload()]);
    expect(factoryState.cloudClusters.byId.has('alpha')).toBe(true);
    const serialised = exportCloudClustersFromFactory(factoryState);
    expect(serialised).toHaveLength(1);
    expect(serialised[0].id).toBe('alpha');
  });
});
