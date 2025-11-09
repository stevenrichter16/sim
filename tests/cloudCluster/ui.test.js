import { describe, it, expect, beforeEach } from 'vitest';
import { FactoryKind, FactoryItem, placeFactoryStructure, stepFactory } from '../../src/factory.js';
import {
  resetCloudClusterState,
  createCloudClusterEditor,
  stepCloudClusterSimulation,
} from '../../src/cloudCluster/index.js';
import { idx, world } from '../../src/state.js';
import { initWorld } from '../helpers/worldHarness.js';
import { upsertLink } from '../../src/cloudCluster/domain/cluster.js';

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
    expect(overlay.clusters.length).toBeGreaterThan(0);
    const overlayEntry = overlay.clusters.find((entry) => entry.id === editor.getGraph().clusterId) ?? overlay.clusters[0];
    expect(overlayEntry?.status).toBe('ok');
  });

  it('surfaces ownership diagnostics and manual link warnings for UI consumers', () => {
    initWorld({ o2: 0.19 });
    const factionId = 1;
    const nodeTile = idx(12, 6);
    const forgeTile = idx(13, 6);
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
      id: 'manual:ui-test',
      source: { objectId: nodeObjectId, portId: 'out' },
      target: { objectId: smelterObjectId, portId: 'in' },
      metadata: { reason: 'ui-test' },
    });

    world.controlLevel[nodeTile] = 0;
    world.dominantFaction[nodeTile] = -1;
    stepFactory();

    const editor = createCloudClusterEditor();
    const diagnostics = editor.getOwnershipDiagnostics();
    expect(Array.isArray(diagnostics.manualLinkWarnings)).toBe(true);
    const warning = diagnostics.manualLinkWarnings.find((entry) => entry.clusterId === clusterId);
    expect(warning).toBeTruthy();
    expect(warning.droppedLinks.some((link) => link.id === 'manual:ui-test')).toBe(true);

    const clusters = editor.getClusters();
    const target = clusters.find((entry) => entry.id === clusterId);
    expect(target?.manualWarningCount ?? 0).toBeGreaterThan(0);
  });
});
