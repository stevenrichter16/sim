import { describe, it, expect, beforeEach } from 'vitest';
import {
  FactoryKind,
  FactoryItem,
  getBioforgeRecipeDefinition,
  getMinerExtractionRate,
} from '../../src/factory.js';
import {
  createCluster,
  validateClusterRouting,
  calculateClusterThroughput,
  createClusterTelemetry,
  stepCloudClusterSimulation,
  resetCloudClusterState,
  setCloudClusterRegistry,
  getCloudClusterTelemetry,
  getClusterValidationReport,
  getClusterThroughput,
  createCloudClusterRegistry,
} from '../../src/cloudCluster/index.js';

function createCycleCluster(){
  return createCluster({
    id: 'cycle',
    name: 'Cycle Cluster',
    objects: [
      {
        id: 'smelter-a',
        kind: FactoryKind.SMELTER,
        metadata: { recipeKey: 'body_system' },
        ports: [
          { id: 'in-a', direction: 'input', label: 'A In' },
          { id: 'out-a', direction: 'output', label: 'A Out' },
        ],
      },
      {
        id: 'smelter-b',
        kind: FactoryKind.SMELTER,
        metadata: { recipeKey: 'neural_weave' },
        ports: [
          { id: 'in-b', direction: 'input', label: 'B In' },
          { id: 'out-b', direction: 'output', label: 'B Out' },
        ],
      },
    ],
    links: [
      {
        id: 'a-to-b',
        source: { objectId: 'smelter-a', portId: 'out-a' },
        target: { objectId: 'smelter-b', portId: 'in-b' },
      },
      {
        id: 'b-to-a',
        source: { objectId: 'smelter-b', portId: 'out-b' },
        target: { objectId: 'smelter-a', portId: 'in-a' },
      },
    ],
  });
}

function createThroughputCluster(){
  return createCluster({
    id: 'throughput',
    name: 'Throughput Cluster',
    objects: [
      {
        id: 'miner-1',
        kind: FactoryKind.MINER,
        metadata: { resource: FactoryItem.BONE_FRAGMENT },
        ports: [
          {
            id: 'ore-out',
            direction: 'output',
            label: 'Ore Output',
            itemKeys: [FactoryItem.BONE_FRAGMENT],
          },
        ],
      },
      {
        id: 'smelter-1',
        kind: FactoryKind.SMELTER,
        metadata: { recipeKey: 'neural_weave' },
        ports: [
          {
            id: 'ore-in',
            direction: 'input',
            label: 'Ore Input',
            itemKeys: [FactoryItem.NERVE_THREAD],
          },
          {
            id: 'ingot-out',
            direction: 'output',
            label: 'Output',
            itemKeys: [FactoryItem.NEURAL_WEAVE],
          },
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
  });
}

function createNodeProducerCluster(){
  return createCluster({
    id: 'node-producer',
    name: 'Node Producer',
    objects: [
      {
        id: 'node-skin',
        kind: FactoryKind.NODE,
        metadata: { outputRate: 0.2, outputItems: [FactoryItem.SKIN_PATCH] },
        ports: [
          { id: 'skin-out', direction: 'output', label: 'Skin Output', itemKeys: [FactoryItem.SKIN_PATCH] },
        ],
      },
      {
        id: 'node-blood',
        kind: FactoryKind.NODE,
        metadata: { outputRate: 0.2, outputItems: [FactoryItem.BLOOD_VIAL] },
        ports: [
          { id: 'blood-out', direction: 'output', label: 'Blood Output', itemKeys: [FactoryItem.BLOOD_VIAL] },
        ],
      },
      {
        id: 'node-organ',
        kind: FactoryKind.NODE,
        metadata: { outputRate: 0.2, outputItems: [FactoryItem.ORGAN_MASS] },
        ports: [
          { id: 'organ-out', direction: 'output', label: 'Organ Output', itemKeys: [FactoryItem.ORGAN_MASS] },
        ],
      },
      {
        id: 'vat-body',
        kind: FactoryKind.SMELTER,
        metadata: { recipeKey: 'body_system' },
        ports: [
          {
            id: 'body-in',
            direction: 'input',
            label: 'Body Intake',
            itemKeys: [FactoryItem.SKIN_PATCH, FactoryItem.BLOOD_VIAL, FactoryItem.ORGAN_MASS],
          },
          {
            id: 'body-out',
            direction: 'output',
            label: 'Body Output',
            itemKeys: [FactoryItem.BODY_SYSTEM],
          },
        ],
      },
    ],
    links: [
      {
        id: 'skin-to-body',
        source: { objectId: 'node-skin', portId: 'skin-out' },
        target: { objectId: 'vat-body', portId: 'body-in' },
      },
      {
        id: 'blood-to-body',
        source: { objectId: 'node-blood', portId: 'blood-out' },
        target: { objectId: 'vat-body', portId: 'body-in' },
      },
      {
        id: 'organ-to-body',
        source: { objectId: 'node-organ', portId: 'organ-out' },
        target: { objectId: 'vat-body', portId: 'body-in' },
      },
    ],
  });
}

describe('cloud cluster simulation services', () => {
  beforeEach(() => {
    resetCloudClusterState();
  });

  it('detects routing cycles during validation', () => {
    const cluster = createCycleCluster();
    const report = validateClusterRouting(cluster);
    expect(report.issues.some((issue) => issue.code === 'routing-cycle')).toBe(true);
    const cycle = report.issues.find((issue) => issue.code === 'routing-cycle');
    expect(cycle.nodes).toEqual(['smelter-a', 'smelter-b', 'smelter-a']);
  });

  it('calculates throughput using existing factory recipe data', () => {
    const cluster = createThroughputCluster();
    const throughput = calculateClusterThroughput(cluster);
    const miner = throughput.objects.find((entry) => entry.id === 'miner-1');
    expect(miner.outputs).toEqual([
      { item: FactoryItem.BONE_FRAGMENT, rate: getMinerExtractionRate() },
    ]);

    const smelter = throughput.objects.find((entry) => entry.id === 'smelter-1');
    const recipe = getBioforgeRecipeDefinition('neural_weave');
    expect(smelter.outputs).toEqual([
      { item: recipe.output, rate: recipe.speed },
    ]);
    const nerveInput = smelter.inputs.find((input) => input.item === FactoryItem.NERVE_THREAD);
    const nerveRequirement = recipe.inputs.find((input) => input.item === FactoryItem.NERVE_THREAD)?.amount ?? 0;
    expect(nerveInput.rate).toBeCloseTo(recipe.speed * nerveRequirement, 6);
  });

  it('creates telemetry snapshots and caches results in state', () => {
    const cluster = createThroughputCluster();
    const registry = createCloudClusterRegistry();
    registry.byId.set(cluster.id, cluster);
    registry.order.push(cluster.id);
    setCloudClusterRegistry(registry);

    const snapshot = stepCloudClusterSimulation({ tick: 42 });
    expect(snapshot.tick).toBe(42);
    expect(snapshot.clusters).toHaveLength(1);

    const telemetry = getCloudClusterTelemetry();
    expect(telemetry.clusters[0].id).toBe(cluster.id);
    expect(telemetry.clusters[0].status).toBe('ok');

    const validation = getClusterValidationReport(cluster.id);
    expect(validation.issues).toHaveLength(0);

    const throughput = getClusterThroughput(cluster.id);
    expect(throughput.objects).toHaveLength(2);

    const telemetryEntry = createClusterTelemetry(cluster, {
      validation,
      throughput,
      tick: snapshot.tick,
    });
    expect(telemetryEntry.totals).toEqual(snapshot.clusters[0].totals);
  });

  it('treats nodes as passive producers feeding smelters', () => {
    const cluster = createNodeProducerCluster();
    const throughput = calculateClusterThroughput(cluster);
    const skinNode = throughput.objects.find((entry) => entry.id === 'node-skin');
    expect(skinNode.totalOutput).toBeCloseTo(0.2, 6);
    expect(skinNode.outputs).toEqual([{ item: FactoryItem.SKIN_PATCH, rate: 0.2 }]);

    const totalsByItem = Object.fromEntries(throughput.totals.map((entry) => [entry.item, entry]));
    expect(totalsByItem[FactoryItem.SKIN_PATCH].produced).toBeCloseTo(0.2, 6);
    expect(totalsByItem[FactoryItem.SKIN_PATCH].consumed).toBeGreaterThan(0);

    const smelter = throughput.objects.find((entry) => entry.id === 'vat-body');
    expect(smelter.inputs.some((input) => input.item === FactoryItem.SKIN_PATCH)).toBe(true);
    expect(smelter.inputs.some((input) => input.item === FactoryItem.BLOOD_VIAL)).toBe(true);
    expect(smelter.inputs.some((input) => input.item === FactoryItem.ORGAN_MASS)).toBe(true);
  });
});
