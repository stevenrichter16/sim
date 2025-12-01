import { describe, it, expect } from 'vitest';
import { computeClusterIntents, computeOwnershipEntries } from '../../dist/factoryOwnership/transform/index.js';
import { FactoryKind } from '../../src/factory.js';
import { makeBasicOwnershipSnapshot } from './__fixtures__/ownershipSnapshots.js';

const KIND_META = {
  [FactoryKind.NODE]: { name: 'Node' },
  [FactoryKind.MINER]: { name: 'Miner' },
  [FactoryKind.BELT]: { name: 'Belt' },
  [FactoryKind.SMELTER]: { name: 'Smelter' },
  [FactoryKind.CONSTRUCTOR]: { name: 'Constructor' },
  [FactoryKind.STORAGE]: { name: 'Storage' },
};

const BIOFORGE_RECIPES = new Map([
  ['body_system', {
    key: 'body_system',
    output: 'body_system',
    inputs: new Map([
      ['blood_vial', 1],
    ]),
  }],
]);

const DEFAULT_BIOFORGE_RECIPE = BIOFORGE_RECIPES.get('body_system');

const CONSTRUCTOR_BLUEPRINTS = new Map([
  ['human_shell', {
    key: 'human_shell',
    output: 'human_shell',
    inputs: new Map([
      ['body_system', 1],
    ]),
  }],
]);

const DEFAULT_CONSTRUCTOR_BLUEPRINT = CONSTRUCTOR_BLUEPRINTS.get('human_shell');

const dependencies = {
  factoryKindMeta: (kind) => KIND_META[kind] ?? { name: kind },
  factoryItemLabel: (item) => item,
  getRecipeInputMap: (recipe) => {
    if(!recipe) return new Map();
    if(recipe.inputs instanceof Map) return new Map(recipe.inputs);
    if(Array.isArray(recipe.inputs)) return new Map(recipe.inputs);
    return new Map(Object.entries(recipe.inputs ?? {}));
  },
  getBioforgeRecipe: (key) => BIOFORGE_RECIPES.get(key) ?? null,
  defaultBioforgeRecipe: DEFAULT_BIOFORGE_RECIPE,
  getConstructorBlueprint: (key) => CONSTRUCTOR_BLUEPRINTS.get(key) ?? DEFAULT_CONSTRUCTOR_BLUEPRINT,
  defaultConstructorBlueprint: DEFAULT_CONSTRUCTOR_BLUEPRINT,
  FactoryKind,
};

describe('computeClusterIntents', () => {
  it('produces desired objects and auto links for faction-owned entries', () => {
    const ownershipInputs = {
      nodesByTile: new Map([
        [10, { tileIdx: 10, resource: 'blood_vial' }],
      ]),
      structuresByTile: new Map([
        [11, {
          tileIdx: 11,
          kind: FactoryKind.SMELTER,
          orientation: 'north',
          recipeKey: 'body_system',
          availableRecipeKeys: ['body_system'],
          activeRecipeIndex: 0,
        }],
      ]),
    };

    const entries = [
      {
        id: 'node:10:node',
        tileIdx: 10,
        type: 'node',
        kind: FactoryKind.NODE,
        factionId: 1,
        dominantFactionId: 1,
        control: 0.6,
        resource: 'blood_vial',
      },
      {
        id: 'structure:11:smelter',
        tileIdx: 11,
        type: 'structure',
        kind: FactoryKind.SMELTER,
        factionId: 1,
        dominantFactionId: 1,
        control: 0.7,
        orientation: 'north',
      },
    ];

    const clusterSnapshot = {
      objects: new Map(),
      links: new Map(),
    };

    const intents = computeClusterIntents({
      clusterId: 'faction-1-cloud',
      entries,
      ownershipInputs,
      clusterSnapshot,
      dependencies,
    });

    expect(intents.desiredObjects).toBeInstanceOf(Map);
    expect(intents.desiredObjects.size).toBe(2);
    expect(intents.desiredObjects.has('node-node-10')).toBe(true);
    expect(intents.desiredObjects.has('structure-smelter-11')).toBe(true);

    const smelterObject = intents.desiredObjects.get('structure-smelter-11');
    const intakePorts = smelterObject.ports.filter((port) => port.direction === 'input');
    expect(intakePorts.length).toBeGreaterThan(0);
    expect(intakePorts[0].metadata?.item).toBe('blood_vial');

    expect(intents.desiredAutoLinks).toBeInstanceOf(Map);
    expect(intents.desiredAutoLinks.size).toBe(1);

    const [linkIntent] = Array.from(intents.desiredAutoLinks.values());
    expect(linkIntent.metadata.item).toBe('blood_vial');
    expect(linkIntent.source.objectId).toBe('node-node-10');
    expect(linkIntent.target.objectId).toBe('structure-smelter-11');
    expect(linkIntent.id).toBe('auto:faction:faction-1-cloud:node-node-10->structure-smelter-11:blood_vial');

    expect(Array.isArray(intents.smelterSelections)).toBe(true);
    expect(intents.smelterSelections.length).toBe(0);
    expect(intents.manualLinkSummary.preserved.length).toBe(0);
    expect(intents.manualLinkSummary.dropped.length).toBe(0);
  });

  it('builds intents for belts, constructors, storage, and fallback structures', () => {
    const ownershipInputs = {
      nodesByTile: new Map(),
      structuresByTile: new Map([
        [12, {
          tileIdx: 12,
          kind: FactoryKind.BELT,
          orientation: 'east',
        }],
        [13, {
          tileIdx: 13,
          kind: FactoryKind.CONSTRUCTOR,
          orientation: 'north',
          recipeKey: 'human_shell',
          availableRecipeKeys: ['human_shell'],
          activeRecipeIndex: 0,
        }],
        [14, {
          tileIdx: 14,
          kind: FactoryKind.STORAGE,
        }],
        [15, {
          tileIdx: 15,
          kind: 'custom-fabricator',
        }],
      ]),
      registrySnapshot: { clustersById: new Map() },
    };

    const entries = [
      { id: 'structure:12:belt', tileIdx: 12, type: 'structure', kind: FactoryKind.BELT, factionId: 2, control: 0.4 },
      { id: 'structure:13:constructor', tileIdx: 13, type: 'structure', kind: FactoryKind.CONSTRUCTOR, factionId: 2, control: 0.5 },
      { id: 'structure:14:storage', tileIdx: 14, type: 'structure', kind: FactoryKind.STORAGE, factionId: 2, control: 0.55 },
      { id: 'structure:15:custom', tileIdx: 15, type: 'structure', kind: 'custom-fabricator', factionId: 2, control: 0.6 },
    ];

    const intents = computeClusterIntents({
      clusterId: 'faction-2-cloud',
      entries,
      ownershipInputs,
      clusterSnapshot: { objects: [], links: [] },
      dependencies,
    });

    expect(intents.desiredObjects.size).toBe(4);
    const constructor = intents.desiredObjects.get('structure-constructor-13');
    expect(constructor.metadata.blueprintKey).toBe('human_shell');
    expect(constructor.ports.some((port) => port.direction === 'output' && port.itemKeys.includes('human_shell'))).toBe(true);

    const fallback = intents.desiredObjects.get('structure-custom-fabricator-15');
    expect(fallback).toBeTruthy();
    expect(fallback.label).toBe('custom-fabricator');
  });

  it('preserves manual links that still reference existing objects and drops stale ones', () => {
    const snapshot = makeBasicOwnershipSnapshot();

    const ownership = computeOwnershipEntries(snapshot);
    const entries = ownership.entries;

    const manualLink = {
      id: 'manual-link-1',
      source: { objectId: 'node-node-14', portId: 'out' },
      target: { objectId: 'structure-smelter-26', portId: 'in' },
      metadata: { reason: 'user-defined' },
    };

    const staleManualLink = {
      id: 'manual-link-2',
      source: { objectId: 'node-node-999', portId: 'out' },
      target: { objectId: 'structure-smelter-999', portId: 'in' },
      metadata: { reason: 'stale' },
    };

    const clusterSnapshot = {
      objects: [
        { id: 'node-node-14' },
        { id: 'structure-smelter-26' },
      ],
      links: [
        manualLink,
        staleManualLink,
      ],
    };

    const intents = computeClusterIntents({
      clusterId: 'faction-1-cloud',
      entries,
      ownershipInputs: snapshot,
      clusterSnapshot,
      dependencies,
    });

    const preservedIds = intents.manualLinkSummary.preserved.map((link) => link.id);
    const droppedIds = intents.manualLinkSummary.dropped.map((link) => link.id);
    expect(preservedIds).toContain(manualLink.id);
    expect(droppedIds).toContain(staleManualLink.id);
  });
});
