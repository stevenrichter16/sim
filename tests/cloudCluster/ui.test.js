import { describe, it, expect, beforeEach } from 'vitest';
import { FactoryKind, FactoryItem } from '../../src/factory.js';
import {
  resetCloudClusterState,
  createCloudClusterEditor,
  stepCloudClusterSimulation,
} from '../../src/cloudCluster/index.js';

function getPortByDirection(node, direction){
  return node?.ports?.find((port) => port.direction === direction) ?? null;
}

describe('cloud cluster editor UI helpers', () => {
  beforeEach(() => {
    resetCloudClusterState();
  });

  it('creates clusters and keeps registry order stable', () => {
    const editor = createCloudClusterEditor();
    expect(editor.getClusters()).toHaveLength(0);

    const first = editor.createCluster({ id: 'alpha', name: 'Alpha Cluster' });
    const second = editor.createCluster({ id: 'alpha', name: 'Beta Cluster' });

    const clusters = editor.getClusters();
    expect(clusters).toHaveLength(2);
    expect(clusters[0].id).toBe(first.id);
    expect(clusters[1].id).toBe(second.id);
    expect(first.id).toBe('alpha');
    expect(second.id).not.toBe('alpha');
  });

  it('adds palette objects and links ports with validation', () => {
    const editor = createCloudClusterEditor();
    const cluster = editor.createCluster({ name: 'Routing Test' });
    expect(cluster).toBeTruthy();

    editor.addObjectFromPalette(FactoryKind.MINER, {
      metadata: { resource: FactoryItem.BONE_FRAGMENT },
    });
    editor.addObjectFromPalette(FactoryKind.SMELTER, {
      metadata: { recipeKey: 'neural_weave' },
    });

    const graph = editor.getGraph();
    expect(graph?.nodes).toHaveLength(2);
    const minerNode = graph.nodes.find((node) => node.kind === FactoryKind.MINER);
    const smelterNode = graph.nodes.find((node) => node.kind === FactoryKind.SMELTER);
    expect(minerNode).toBeTruthy();
    expect(smelterNode).toBeTruthy();

    const minerOutput = getPortByDirection(minerNode, 'output');
    const smelterInput = getPortByDirection(smelterNode, 'input');
    expect(minerOutput).toBeTruthy();
    expect(smelterInput).toBeTruthy();

    editor.beginLink(minerNode.id, minerOutput.id);
    expect(() => editor.beginLink(smelterNode.id, smelterInput.id)).toThrowError();
    editor.completeLink(smelterNode.id, smelterInput.id);

    const updated = editor.getGraph();
    expect(updated?.links).toHaveLength(1);
    expect(updated.links[0].source.objectId).toBe(minerNode.id);
    expect(updated.links[0].target.objectId).toBe(smelterNode.id);
  });

  it('summarises telemetry and overlays for inspector panels', () => {
    const editor = createCloudClusterEditor();
    editor.createCluster({ name: 'Telemetry' });
    const miner = editor.addObjectFromPalette(FactoryKind.MINER, {
      metadata: { resource: FactoryItem.BONE_FRAGMENT },
    });
    const smelter = editor.addObjectFromPalette(FactoryKind.SMELTER, {
      metadata: { recipeKey: 'body_system' },
    });
    const graph = editor.getGraph();
    const minerPort = getPortByDirection(graph.nodes.find((node) => node.id === miner.id), 'output');
    const smelterPort = getPortByDirection(graph.nodes.find((node) => node.id === smelter.id), 'input');
    editor.beginLink(miner.id, minerPort.id);
    editor.completeLink(smelter.id, smelterPort.id);

    const inspectorBefore = editor.getInspector();
    expect(inspectorBefore?.status).toBe('ok');

    stepCloudClusterSimulation({ tick: 12 });
    const inspectorAfter = editor.getInspector();
    expect(inspectorAfter?.status).toBe('ok');
    expect(Array.isArray(inspectorAfter?.totals)).toBe(true);

    const overlay = editor.getOverlay();
    expect(overlay.clusters).toHaveLength(1);
    expect(overlay.clusters[0].status).toBe('ok');
  });
});
