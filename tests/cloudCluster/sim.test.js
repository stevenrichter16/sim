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
  updateClusterAccumulatorMembership,
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
        id: 'miner-nerve',
        kind: FactoryKind.MINER,
        metadata: { resource: FactoryItem.NERVE_THREAD },
        ports: [
          {
            id: 'nerve-out',
            direction: 'output',
            label: 'Nerve Output',
            itemKeys: [FactoryItem.NERVE_THREAD],
          },
        ],
      },
      {
        id: 'miner-blood',
        kind: FactoryKind.MINER,
        metadata: { resource: FactoryItem.BLOOD_VIAL },
        ports: [
          {
            id: 'blood-out',
            direction: 'output',
            label: 'Blood Output',
            itemKeys: [FactoryItem.BLOOD_VIAL],
          },
        ],
      },
      {
        id: 'smelter-1',
        kind: FactoryKind.SMELTER,
        metadata: { recipeKey: 'neural_weave' },
        ports: [
          {
            id: 'nerve-in',
            direction: 'input',
            label: 'Nerve Input',
            itemKeys: [FactoryItem.NERVE_THREAD],
          },
          {
            id: 'blood-in',
            direction: 'input',
            label: 'Blood Input',
            itemKeys: [FactoryItem.BLOOD_VIAL],
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
        id: 'nerve-flow',
        source: { objectId: 'miner-nerve', portId: 'nerve-out' },
        target: { objectId: 'smelter-1', portId: 'nerve-in' },
      },
      {
        id: 'blood-flow',
        source: { objectId: 'miner-blood', portId: 'blood-out' },
        target: { objectId: 'smelter-1', portId: 'blood-in' },
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

function createIncompleteBioforgeCluster(){
  return createCluster({
    id: 'incomplete',
    name: 'Incomplete Cluster',
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
        id: 'vat-body',
        kind: FactoryKind.SMELTER,
        metadata: { recipeKey: 'body_system' },
        ports: [
          { id: 'body-in-skin', direction: 'input', label: 'Skin Intake', itemKeys: [FactoryItem.SKIN_PATCH] },
          { id: 'body-in-blood', direction: 'input', label: 'Blood Intake', itemKeys: [FactoryItem.BLOOD_VIAL] },
          { id: 'body-in-organ', direction: 'input', label: 'Organ Intake', itemKeys: [FactoryItem.ORGAN_MASS] },
          { id: 'body-out', direction: 'output', label: 'Body Output', itemKeys: [FactoryItem.BODY_SYSTEM] },
        ],
      },
    ],
    links: [
      {
        id: 'skin-to-body',
        source: { objectId: 'node-skin', portId: 'skin-out' },
        target: { objectId: 'vat-body', portId: 'body-in-skin' },
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
    const nerveMiner = throughput.objects.find((entry) => entry.id === 'miner-nerve');
    expect(nerveMiner.outputs).toEqual([
      { item: FactoryItem.NERVE_THREAD, rate: getMinerExtractionRate() },
    ]);

    const bloodMiner = throughput.objects.find((entry) => entry.id === 'miner-blood');
    expect(bloodMiner.outputs).toEqual([
      { item: FactoryItem.BLOOD_VIAL, rate: getMinerExtractionRate() },
    ]);

    const smelter = throughput.objects.find((entry) => entry.id === 'smelter-1');
    const recipe = getBioforgeRecipeDefinition('neural_weave');
    expect(smelter.outputs).toEqual([
      { item: recipe.output, rate: recipe.speed },
    ]);
    const nerveInput = smelter.inputs.find((input) => input.item === FactoryItem.NERVE_THREAD);
    const nerveRequirement = recipe.inputs.find((input) => input.item === FactoryItem.NERVE_THREAD)?.amount ?? 0;
    expect(nerveInput.rate).toBeCloseTo(recipe.speed * nerveRequirement, 6);
    const bloodInput = smelter.inputs.find((input) => input.item === FactoryItem.BLOOD_VIAL);
    const bloodRequirement = recipe.inputs.find((input) => input.item === FactoryItem.BLOOD_VIAL)?.amount ?? 0;
    expect(bloodInput.rate).toBeCloseTo(recipe.speed * bloodRequirement, 6);
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
    expect(throughput.objects).toHaveLength(3);

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

  it('does not run smelters when required inputs are missing', () => {
    const cluster = createIncompleteBioforgeCluster();
    const throughput = calculateClusterThroughput(cluster);
    const smelter = throughput.objects.find((entry) => entry.id === 'vat-body');
    expect(smelter.totalOutput).toBeCloseTo(0, 6);
    expect(smelter.outputs.length).toBe(0);
    const totalsByItem = Object.fromEntries(throughput.totals.map((entry) => [entry.item, entry]));
    expect(totalsByItem[FactoryItem.BODY_SYSTEM]?.produced ?? 0).toBeCloseTo(0, 6);
    expect(totalsByItem[FactoryItem.BLOOD_VIAL]?.consumed ?? 0).toBeCloseTo(0, 6);
    expect(totalsByItem[FactoryItem.ORGAN_MASS]?.consumed ?? 0).toBeCloseTo(0, 6);
  });

  it('preserves historical production when adding new nodes', () => {
    resetCloudClusterState();
    const registry = createCloudClusterRegistry();
    const baseCluster = createCluster({
      id: 'history',
      name: 'History Test',
      objects: [
        {
          id: 'node-early',
          kind: FactoryKind.NODE,
          metadata: { outputRate: 0.2, outputItems: [FactoryItem.SKIN_PATCH] },
          ports: [
            { id: 'out', direction: 'output', label: 'Output', itemKeys: [FactoryItem.SKIN_PATCH] },
          ],
        },
      ],
      links: [],
    });
    registry.byId.set(baseCluster.id, baseCluster);
    registry.order.push(baseCluster.id);
    setCloudClusterRegistry(registry);

    stepCloudClusterSimulation({ tick: 10 });

    const updatedCluster = createCluster({
      id: 'history',
      name: 'History Test',
      objects: [
        ...baseCluster.objects.values(),
        {
          id: 'node-late',
          kind: FactoryKind.NODE,
          metadata: { outputRate: 0.2, outputItems: [FactoryItem.SKIN_PATCH] },
          ports: [
            { id: 'out', direction: 'output', label: 'Output', itemKeys: [FactoryItem.SKIN_PATCH] },
          ],
        },
      ],
      links: [],
    });

    registry.byId.set(updatedCluster.id, updatedCluster);
    updateClusterAccumulatorMembership(updatedCluster.id, { added: ['node-late'], removed: [] });
    setCloudClusterRegistry(registry);

    stepCloudClusterSimulation({ tick: 12 });

    const telemetry = getCloudClusterTelemetry();
    const entry = telemetry.clusters.find((item) => item.id === 'history');
    const earlyNode = entry.objects.find((obj) => obj.id === 'node-early');
    const lateNode = entry.objects.find((obj) => obj.id === 'node-late');
    expect(earlyNode.cumulativeProduced).toBeGreaterThan(lateNode.cumulativeProduced);
    expect(lateNode.cumulativeProduced).toBeGreaterThan(0);
  });
});
