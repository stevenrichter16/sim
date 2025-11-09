import { describe, it, expect } from 'vitest';
import { computeOwnershipEntries, computeClusterIntents, computeAllocationIntents } from '../../src/factoryOwnership/transform/index.js';
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

const MULTI_BODY_RECIPE_KEY = 'body_system_multi';

const BIOFORGE_RECIPES = new Map([
  ['body_system', {
    key: 'body_system',
    output: 'body_system',
    inputs: new Map([
      ['blood_vial', 1],
    ]),
  }],
  [MULTI_BODY_RECIPE_KEY, {
    key: MULTI_BODY_RECIPE_KEY,
    output: 'body_system',
    inputs: new Map([
      ['blood_vial', 1],
      ['skin_patch', 1],
      ['organ_mass', 1],
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

describe('computeAllocationIntents', () => {
  it('allocates providers to smelter ports when resources exist', () => {
    const snapshot = makeBasicOwnershipSnapshot();
    const ownership = computeOwnershipEntries(snapshot);
    const clusterSnapshot = { objects: [], links: [] };

    const clusterIntents = computeClusterIntents({
      clusterId: 'faction-1-cloud',
      entries: ownership.entries,
      ownershipInputs: snapshot,
      clusterSnapshot,
      dependencies,
    });

    const allocation = computeAllocationIntents({
      clusterId: 'faction-1-cloud',
      desiredObjects: clusterIntents.desiredObjects,
      ownershipInputs: snapshot,
      clusterSnapshot,
      dependencies,
    });

    expect(Array.isArray(allocation.links)).toBe(true);
    expect(allocation.links.length).toBeGreaterThan(0);
    const bloodLink = allocation.links.find((link) => link.metadata?.item === 'blood_vial');
    expect(bloodLink?.source?.objectId).toBe('node-node-14');
    expect(bloodLink?.target?.objectId).toBe('structure-smelter-26');
    expect(allocation.rejectedPorts.length).toBe(0);
  });

  it('honours manual reservations by withholding providers from auto allocation', () => {
    const snapshot = makeBasicOwnershipSnapshot();
    const ownership = computeOwnershipEntries(snapshot);
    const clusterSnapshot = { objects: [], links: [] };

    const clusterIntents = computeClusterIntents({
      clusterId: 'faction-1-cloud',
      entries: ownership.entries,
      ownershipInputs: snapshot,
      clusterSnapshot,
      dependencies,
    });

    const allocation = computeAllocationIntents({
      clusterId: 'faction-1-cloud',
      desiredObjects: clusterIntents.desiredObjects,
      ownershipInputs: snapshot,
      clusterSnapshot,
      manualReservations: [
        {
          item: 'blood_vial',
          provider: { objectId: 'node-node-14', portId: 'out' },
        },
      ],
      dependencies,
    });

    const bloodLink = allocation.links.find((link) => link.metadata?.item === 'blood_vial');
    expect(bloodLink).toBeUndefined();
    expect(allocation.rejectedPorts).toEqual([
      {
        consumerId: 'structure-smelter-26',
        consumerPortId: 'in',
        requiredItem: 'blood_vial',
        reason: 'provider_unavailable',
      },
    ]);
  });

  it('matches providers strictly by required item for multi-ingredient recipes', () => {
    const snapshot = makeBasicOwnershipSnapshot();
    const factionId = 1;
    const additionalNodes = [
      { tileIdx: 31, resource: 'skin_patch' },
      { tileIdx: 32, resource: 'organ_mass' },
    ];
    for(const node of additionalNodes){
      snapshot.nodes.push(node);
      snapshot.nodesByTile.set(node.tileIdx, node);
      snapshot.world.dominantFaction[node.tileIdx] = factionId;
      snapshot.world.controlLevel[node.tileIdx] = 0.7;
    }

    const forge = snapshot.structuresByTile.get(26);
    forge.recipeKey = MULTI_BODY_RECIPE_KEY;
    forge.availableRecipeKeys = [MULTI_BODY_RECIPE_KEY];
    forge.activeRecipeIndex = 0;

    const ownership = computeOwnershipEntries(snapshot);
    const clusterSnapshot = { objects: [], links: [] };

    const clusterIntents = computeClusterIntents({
      clusterId: 'faction-1-cloud',
      entries: ownership.entries,
      ownershipInputs: snapshot,
      clusterSnapshot,
      dependencies,
    });

    const allocation = computeAllocationIntents({
      clusterId: 'faction-1-cloud',
      desiredObjects: clusterIntents.desiredObjects,
      ownershipInputs: snapshot,
      clusterSnapshot,
      dependencies,
    });

    expect(allocation.rejectedPorts).toEqual([]);
    const linksByItem = new Map(allocation.links.map((link) => [link.metadata?.item, link]));
    expect(linksByItem.get('blood_vial')?.source?.objectId).toBe('node-node-14');
    expect(linksByItem.get('skin_patch')?.source?.objectId).toBe('node-node-31');
    expect(linksByItem.get('organ_mass')?.source?.objectId).toBe('node-node-32');
    expect(linksByItem.size).toBe(3);
  });
});
