/// <reference path="../types/external-modules.d.ts" />

import {
  CLOUD_CLUSTER_AUTO_LINK_PREFIX,
  NODE_OUTPUT_PORT_ID,
  SMELTER_INPUT_PORT_ID,
  SMELTER_OUTPUT_PORT_ID,
  DEFAULT_INPUT_PORT_ID,
  DEFAULT_OUTPUT_PORT_ID,
} from '../constants.js';
import { CloudFactoryPortDirection } from '../../../src/cloudCluster/domain/factoryObject.js';

interface ProviderRecord {
  item: string;
  objectId: string;
  portId: string;
}

type ProviderStore = Map<string, ProviderRecord[]>;

export function computeClusterIntents({
  clusterId,
  entries,
  ownershipInputs,
  clusterSnapshot,
  dependencies,
}: any = {}){
  const { objects: clusterObjects, links: clusterLinks } = normaliseClusterSnapshot(clusterSnapshot);
  const desiredObjects = new Map<string, any>();
  const desiredAutoLinks = new Map<string, any>();
  const smelterSelections: any[] = [];

  const preservedManualLinks: any[] = [];
  const droppedManualLinks: any[] = [];

  if(!Array.isArray(entries) || entries.length === 0){
    if(clusterSnapshot?.links instanceof Map){
      for(const link of clusterSnapshot.links.values()){
        if(isManualLink(link)){
          preservedManualLinks.push(link);
        }
      }
    }
    return {
      desiredObjects,
      desiredAutoLinks,
      smelterSelections,
      manualLinkSummary: { preserved: preservedManualLinks, dropped: droppedManualLinks },
    };
  }

  const {
    factoryKindMeta,
    factoryItemLabel,
    getRecipeInputMap,
    getBioforgeRecipe,
    defaultBioforgeRecipe,
    getConstructorBlueprint,
    defaultConstructorBlueprint,
    FactoryKind,
  } = dependencies ?? {};

  const nodesByTile = ownershipInputs?.nodesByTile instanceof Map
    ? ownershipInputs.nodesByTile
    : new Map();
  const structuresByTile = ownershipInputs?.structuresByTile instanceof Map
    ? ownershipInputs.structuresByTile
    : new Map();

  const structureState = cloneStructureState(structuresByTile);

  const providersByItem: ProviderStore = new Map();
  const smelterEntries: any[] = [];

  for(const entry of entries){
    if(!entry || entry.factionId == null){
      continue;
    }
    if(entry.type === 'node'){
      const nodeObject = buildNodeClusterObject({
        entry,
        nodesByTile,
        factoryKindMeta,
        factoryItemLabel,
        FactoryKind,
      });
      if(nodeObject){
        desiredObjects.set(nodeObject.id, nodeObject);
        const resource = nodesByTile.get(entry.tileIdx)?.resource ?? null;
        if(typeof resource === 'string' && resource.length){
          registerProvider(providersByItem, resource as string, {
            objectId: nodeObject.id,
            portId: NODE_OUTPUT_PORT_ID,
          });
        }
      }
      continue;
    }
    if(entry.type !== 'structure'){
      continue;
    }
    switch(entry.kind){
      case FactoryKind.MINER: {
        const minerObject = buildMinerClusterObject({
          entry,
          nodesByTile,
          factoryKindMeta,
          factoryItemLabel,
          FactoryKind,
        });
        if(minerObject){
          desiredObjects.set(minerObject.id, minerObject);
          const resource = nodesByTile.get(entry.tileIdx)?.resource ?? null;
          if(typeof resource === 'string' && resource.length){
            registerProvider(providersByItem, resource as string, {
              objectId: minerObject.id,
              portId: DEFAULT_OUTPUT_PORT_ID,
            });
          }
        }
        break;
      }
      case FactoryKind.BELT: {
        const beltObject = buildBeltClusterObject({
          entry,
          factoryKindMeta,
          FactoryKind,
        });
        if(beltObject){
          desiredObjects.set(beltObject.id, beltObject);
        }
        break;
      }
      case FactoryKind.CONSTRUCTOR: {
        const constructorObject = buildConstructorClusterObject({
          entry,
          structureState,
          factoryKindMeta,
          factoryItemLabel,
          getRecipeInputMap,
          getConstructorBlueprint,
          defaultConstructorBlueprint,
          FactoryKind,
        });
        if(constructorObject){
          desiredObjects.set(constructorObject.id, constructorObject);
        }
        break;
      }
      case FactoryKind.STORAGE: {
        const storageObject = buildStorageClusterObject({
          entry,
          factoryKindMeta,
          FactoryKind,
        });
        if(storageObject){
          desiredObjects.set(storageObject.id, storageObject);
        }
        break;
      }
      case FactoryKind.SMELTER:
        smelterEntries.push(entry);
        break;
      default: {
        const fallbackObject = buildFallbackClusterObject({
          entry,
          factoryKindMeta,
        });
        if(fallbackObject){
          desiredObjects.set(fallbackObject.id, fallbackObject);
        }
        break;
      }
    }
  }

  for(const entry of smelterEntries){
    const smelterObjectId = clusterObjectIdForEntry(entry);
    const structure = structureState.get(entry.tileIdx) ?? null;

    const baseProviderPool = cloneProviderPool(providersByItem);
    const providerCounts = buildProviderCounts(baseProviderPool);

    const selection = selectSmelterRecipeIntent({
      structure,
      providerCounts,
      getBioforgeRecipe,
      getRecipeInputMap,
      defaultBioforgeRecipe,
      FactoryKind,
    });

    const updatedStructure = applySmelterSelectionToState(structureState, entry.tileIdx, selection);

    if(selection.changed){
      smelterSelections.push({
        tileIdx: entry.tileIdx,
        nextRecipeKey: selection.recipeKey,
      });
    }

    const smelterObject = buildSmelterClusterObject({
      entry,
      structure: updatedStructure,
      factoryKindMeta,
      factoryItemLabel,
      getRecipeInputMap,
      getBioforgeRecipe,
      defaultBioforgeRecipe,
      FactoryKind,
    });

    if(smelterObject){
      desiredObjects.set(smelterObject.id, smelterObject);
      const usedProviders = assignProvidersToSmelter({
        smelterObject,
        baseProviderPool,
        desiredAutoLinks,
        clusterId,
      });
      releaseAssignedProviders(providersByItem, usedProviders);
    }
  }

  if(clusterLinks.size){
    for(const link of clusterLinks.values()){
      if(isManualLink(link)){
        const sourceValid = link?.source?.objectId ? desiredObjects.has(link.source.objectId) : false;
        const targetValid = link?.target?.objectId ? desiredObjects.has(link.target.objectId) : false;
        if(sourceValid && targetValid){
          preservedManualLinks.push(link);
        } else {
          droppedManualLinks.push(link);
        }
      }
    }
  }

  return {
    desiredObjects,
    desiredAutoLinks,
    smelterSelections,
    manualLinkSummary: {
      preserved: preservedManualLinks,
      dropped: droppedManualLinks,
    },
  };
}

function buildNodeClusterObject({ entry, nodesByTile, factoryKindMeta, factoryItemLabel, FactoryKind }: any){
  const node = nodesByTile.get(entry.tileIdx);
  const resource = node?.resource ?? null;
  const id = clusterObjectIdForEntry(entry);
  if(!resource || !id){
    return null;
  }
  const label = `${factoryItemLabel(resource)} Node`;
  return {
    id,
    kind: FactoryKind.NODE,
    label,
    description: 'Faction-controlled biological node.',
    metadata: {
      tileIdx: entry.tileIdx,
      factionId: entry.factionId,
      resource,
      control: entry.control ?? 0,
      type: entry.type,
      auto: true,
    },
    ports: [
      {
        id: NODE_OUTPUT_PORT_ID,
        direction: CloudFactoryPortDirection.OUTPUT,
        label: `${factoryItemLabel(resource)} Output`,
        itemKeys: [resource],
      },
    ],
  };
}

function buildMinerClusterObject({ entry, nodesByTile, factoryKindMeta, factoryItemLabel, FactoryKind }: any){
  const node = nodesByTile.get(entry.tileIdx);
  const resource = node?.resource ?? null;
  const itemKeys = resource ? [resource] : [];
  const id = clusterObjectIdForEntry(entry);
  if(!id){
    return null;
  }
  const meta = factoryKindMeta(FactoryKind.MINER);
  const label = itemKeys.length ? `${meta.name} (${factoryItemLabel(resource)})` : meta.name;
  return {
    id,
    kind: FactoryKind.MINER,
    label,
    description: 'Faction-operated harvest surgeon.',
    metadata: {
      tileIdx: entry.tileIdx,
      factionId: entry.factionId,
      resource: resource ?? null,
      control: entry.control ?? 0,
      auto: true,
    },
    ports: [
      {
        id: DEFAULT_OUTPUT_PORT_ID,
        direction: CloudFactoryPortDirection.OUTPUT,
        label: itemKeys.length ? `${factoryItemLabel(resource)} Output` : 'Output',
        itemKeys,
      },
    ],
  };
}

function buildBeltClusterObject({ entry, factoryKindMeta, FactoryKind }: any){
  const meta = factoryKindMeta(FactoryKind.BELT);
  const id = clusterObjectIdForEntry(entry);
  if(!id){
    return null;
  }
  return {
    id,
    kind: FactoryKind.BELT,
    label: meta.name,
    description: 'Faction-controlled conveyor segment.',
    metadata: {
      tileIdx: entry.tileIdx,
      factionId: entry.factionId,
      control: entry.control ?? 0,
      auto: true,
    },
    ports: [
      {
        id: DEFAULT_INPUT_PORT_ID,
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Intake',
        itemKeys: [],
      },
      {
        id: DEFAULT_OUTPUT_PORT_ID,
        direction: CloudFactoryPortDirection.OUTPUT,
        label: 'Output',
        itemKeys: [],
      },
    ],
  };
}

function buildStorageClusterObject({ entry, factoryKindMeta, FactoryKind }: any){
  const meta = factoryKindMeta(FactoryKind.STORAGE);
  const id = clusterObjectIdForEntry(entry);
  if(!id){
    return null;
  }
  return {
    id,
    kind: FactoryKind.STORAGE,
    label: meta.name,
    description: 'Faction storage cradle.',
    metadata: {
      tileIdx: entry.tileIdx,
      factionId: entry.factionId,
      control: entry.control ?? 0,
      auto: true,
    },
    ports: [
      {
        id: DEFAULT_INPUT_PORT_ID,
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Intake',
        itemKeys: [],
      },
      {
        id: DEFAULT_OUTPUT_PORT_ID,
        direction: CloudFactoryPortDirection.OUTPUT,
        label: 'Output',
        itemKeys: [],
      },
    ],
  };
}

function buildConstructorClusterObject({
  entry,
  structureState,
  factoryKindMeta,
  factoryItemLabel,
  getRecipeInputMap,
  getConstructorBlueprint,
  defaultConstructorBlueprint,
  FactoryKind,
}: any){
  const structure = structureState.get(entry.tileIdx);
  const id = clusterObjectIdForEntry(entry);
  if(!id){
    return null;
  }
  const blueprint = resolveConstructorBlueprint({
    structure,
    getConstructorBlueprint,
    defaultConstructorBlueprint,
  });
  const requirements = Array.from(getRecipeInputMap(blueprint).keys());
  const outputItems = blueprint?.output ? [blueprint.output] : [];
  const meta = factoryKindMeta(FactoryKind.CONSTRUCTOR);
  const ports = [];
  if(requirements.length){
    requirements.forEach((item, index) => {
      ports.push({
        id: `${DEFAULT_INPUT_PORT_ID}-${index}`,
        direction: CloudFactoryPortDirection.INPUT,
        label: `${factoryItemLabel(item)} Intake`,
        itemKeys: item ? [item] : [],
      });
    });
  } else {
    ports.push({
      id: DEFAULT_INPUT_PORT_ID,
      direction: CloudFactoryPortDirection.INPUT,
      label: 'Intake',
      itemKeys: [],
    });
  }
  ports.push({
    id: DEFAULT_OUTPUT_PORT_ID,
    direction: CloudFactoryPortDirection.OUTPUT,
    label: outputItems.length ? `${factoryItemLabel(outputItems[0])} Output` : 'Output',
    itemKeys: outputItems,
  });
  return {
    id,
    kind: FactoryKind.CONSTRUCTOR,
    label: meta.name,
    description: 'Faction constructor array.',
    metadata: {
      tileIdx: entry.tileIdx,
      factionId: entry.factionId,
      blueprintKey: blueprint?.key ?? null,
      output: blueprint?.output ?? null,
      control: entry.control ?? 0,
      auto: true,
    },
    ports,
  };
}

function buildSmelterClusterObject({
  entry,
  structure,
  factoryKindMeta,
  factoryItemLabel,
  getRecipeInputMap,
  getBioforgeRecipe,
  defaultBioforgeRecipe,
  FactoryKind,
}: any){
  const recipe = resolveSmelterRecipe({
    structure,
    getBioforgeRecipe,
    defaultBioforgeRecipe,
  });
  const requiredItems = recipe ? Array.from(getRecipeInputMap(recipe).keys()) : [];
  const outputItems = recipe?.output ? [recipe.output] : [];
  const meta = factoryKindMeta(FactoryKind.SMELTER);
  const id = clusterObjectIdForEntry(entry);
  if(!id){
    return null;
  }
  const recipeKeys = Array.isArray(structure?.availableRecipeKeys)
    ? structure.availableRecipeKeys.slice()
    : structure?.recipeKey ? [structure.recipeKey] : [];

  const inputPorts = [];
  const requirementUnits = [];
  if(requiredItems.length){
    for(const item of requiredItems){
      const amount = Math.max(1, Math.round(getRecipeInputMap(recipe).get(item) ?? 1));
      for(let i = 0; i < amount; i += 1){
        requirementUnits.push(item);
      }
    }
    requirementUnits.forEach((item, index) => {
      const letter = String.fromCharCode(65 + index);
      const suffix = index === 0 ? '' : `-${index}`;
      inputPorts.push({
        id: `${SMELTER_INPUT_PORT_ID}${suffix}`,
        direction: CloudFactoryPortDirection.INPUT,
        label: `Intake ${letter}`,
        itemKeys: item ? [item] : [],
        metadata: {
          item,
        },
      });
    });
  } else {
    inputPorts.push({
      id: SMELTER_INPUT_PORT_ID,
      direction: CloudFactoryPortDirection.INPUT,
      label: 'Intake',
      itemKeys: [],
    });
  }

  return {
    id,
    kind: FactoryKind.SMELTER,
    label: meta.name,
    description: 'Faction bioforge vat.',
    metadata: {
      tileIdx: entry.tileIdx,
      factionId: entry.factionId,
      recipeKey: recipe?.key ?? null,
      output: recipe?.output ?? null,
      recipeKeys,
      control: entry.control ?? 0,
      auto: true,
    },
    ports: [
      ...inputPorts,
      {
        id: SMELTER_OUTPUT_PORT_ID,
        direction: CloudFactoryPortDirection.OUTPUT,
        label: 'Bioforge Output',
        itemKeys: outputItems,
      },
    ],
  };
}

function buildFallbackClusterObject({ entry, factoryKindMeta }: any){
  const id = clusterObjectIdForEntry(entry);
  if(!id){
    return null;
  }
  return {
    id,
    kind: entry.kind,
    label: factoryKindMeta(entry.kind).name,
    description: 'Faction-controlled factory object.',
    metadata: {
      tileIdx: entry.tileIdx,
      factionId: entry.factionId,
      control: entry.control ?? 0,
      auto: true,
    },
    ports: [],
  };
}

function assignProvidersToSmelter({
  smelterObject,
  baseProviderPool,
  desiredAutoLinks,
  clusterId,
}: {
  smelterObject: any;
  baseProviderPool: ProviderStore;
  desiredAutoLinks: Map<string, any>;
  clusterId: string | null;
}){
  if(!smelterObject){
    return [];
  }
  const providerPool = cloneProviderPool(baseProviderPool);
  const inputPorts = Array.isArray(smelterObject.ports)
    ? smelterObject.ports.filter((port: any) => port.direction === CloudFactoryPortDirection.INPUT)
    : [];
  const assignmentsByPort: Map<string, ProviderRecord[]> = new Map(inputPorts.map((port: any) => [port.id, []]));
  const usedProviders: ProviderRecord[] = [];

  const takeProvider = (preferredItem: string | null = null): ProviderRecord | null => {
    if(preferredItem && providerPool.has(preferredItem)){
      const list = providerPool.get(preferredItem);
      if(list?.length){
        const provider = list.shift() ?? null;
        if(list.length === 0){
          providerPool.delete(preferredItem);
        }
        return provider;
      }
      return null;
    }
    if(preferredItem == null){
      for(const [item, list] of providerPool.entries()){
        if(!list.length) continue;
        const provider = list.shift() ?? null;
        if(list.length === 0){
          providerPool.delete(item);
        }
        return provider;
      }
    }
    return null;
  };

  for(const port of inputPorts){
    const preferredItem = port.metadata?.item ?? null;
    const provider = takeProvider(preferredItem);
    if(!provider) continue;
    if(!assignmentsByPort.has(port.id)){
      assignmentsByPort.set(port.id, []);
    }
    assignmentsByPort.get(port.id)!.push(provider);
  }

  for(const [portId, assignedProviders] of assignmentsByPort.entries()){
    for(const provider of assignedProviders){
      if(!provider) continue;
      const linkKey = makeAutoLinkKey(provider.objectId, provider.portId, smelterObject.id, portId, provider.item);
      if(!desiredAutoLinks.has(linkKey)){
        desiredAutoLinks.set(linkKey, {
          id: buildAutoLinkId(clusterId, provider.objectId, smelterObject.id, provider.item),
          source: { objectId: provider.objectId, portId: provider.portId },
          target: { objectId: smelterObject.id, portId },
          metadata: {
            auto: true,
            factionClusterId: clusterId,
            item: provider.item,
          },
        });
      }
      usedProviders.push(provider);
    }
  }

  return usedProviders;
}

function registerProvider(store: ProviderStore, item: string, provider: { objectId: string; portId: string }){
  if(!item || !provider?.objectId || !provider?.portId){
    return;
  }
  let list = store.get(item);
  if(!list){
    list = [];
    store.set(item, list);
  }
  list.push({
    item,
    objectId: provider.objectId,
    portId: provider.portId,
  });
}

function cloneProviderPool(source: ProviderStore): ProviderStore{
  const clone: ProviderStore = new Map();
  for(const [item, list] of source.entries()){
    clone.set(item, list.map((entry) => ({ ...entry })) as ProviderRecord[]);
  }
  return clone;
}

function buildProviderCounts(providerPool: ProviderStore){
  const counts = new Map<string, number>();
  for(const [item, list] of providerPool.entries()){
    counts.set(item, list.length);
  }
  return counts;
}

function selectSmelterRecipeIntent({
  structure,
  providerCounts,
  getBioforgeRecipe,
  getRecipeInputMap,
  defaultBioforgeRecipe,
}: any){
  if(!structure){
    return {
      recipeKey: defaultBioforgeRecipe?.key ?? null,
      changed: false,
    };
  }
  const keys = Array.isArray(structure.availableRecipeKeys) && structure.availableRecipeKeys.length
    ? structure.availableRecipeKeys
    : structure.recipeKey ? [structure.recipeKey] : [];
  if(!keys.length){
    return {
      recipeKey: structure.recipeKey ?? defaultBioforgeRecipe?.key ?? null,
      changed: false,
    };
  }
  let bestKey = structure.recipeKey ?? keys[0];
  let bestScore = -Infinity;
  let bestSatisfied = false;
  for(const key of keys){
    const recipe = getBioforgeRecipe(key);
    if(!recipe) continue;
    const requirements = getRecipeInputMap(recipe);
    if(!requirements.size){
      if(bestKey == null){
        bestKey = key;
      }
      continue;
    }
    let satisfied = true;
    let score = 0;
    for(const [item, amount] of requirements.entries()){
      const available = providerCounts.get(item) ?? 0;
      if(amount > 0 && available < amount){
        satisfied = false;
      }
      const ratio = amount > 0 ? available / amount : 0;
      score += Math.min(ratio, 1);
    }
    const normalised = score / requirements.size;
    if(satisfied){
      if(!bestSatisfied || normalised > bestScore){
        bestSatisfied = true;
        bestScore = normalised;
        bestKey = key;
      }
      if(normalised >= 1){
        break;
      }
      continue;
    }
    if(!bestSatisfied && normalised > bestScore){
      bestScore = normalised;
      bestKey = key;
    }
  }

  const currentKey = structure?.recipeKey ?? defaultBioforgeRecipe?.key ?? null;
  let nextKey = currentKey;
  let selectedRecipe = currentKey ? getBioforgeRecipe(currentKey) ?? defaultBioforgeRecipe : defaultBioforgeRecipe;

  if(bestSatisfied && bestKey){
    const recipe = getBioforgeRecipe(bestKey) ?? defaultBioforgeRecipe;
    if(recipe){
      nextKey = recipe.key ?? nextKey;
      selectedRecipe = recipe;
    }
  }

  return {
    recipeKey: nextKey,
    changed: bestSatisfied && nextKey != null && nextKey !== structure?.recipeKey,
    recipe: selectedRecipe,
  };
}

function releaseAssignedProviders(store: ProviderStore, providers: ProviderRecord[]){
  if(!providers || !providers.length){
    return;
  }
  for(const provider of providers){
    if(!provider?.item){
      continue;
    }
    const list = store.get(provider.item);
    if(!Array.isArray(list) || !list.length){
      continue;
    }
    const index = list.findIndex((entry) => entry.objectId === provider.objectId && entry.portId === provider.portId);
    if(index >= 0){
      list.splice(index, 1);
    }
    if(list.length === 0){
      store.delete(provider.item);
    }
  }
}

function applySmelterSelectionToState(structureState: Map<number, any>, tileIdx: number, selection: any){
  const prev = structureState.get(tileIdx) ?? { tileIdx };
  const next = {
    ...prev,
    recipeKey: selection.recipeKey ?? prev.recipeKey ?? null,
  };
  if(Array.isArray(next.availableRecipeKeys) && selection.recipeKey){
    const idx = next.availableRecipeKeys.indexOf(selection.recipeKey);
    next.activeRecipeIndex = idx >= 0 ? idx : next.activeRecipeIndex ?? null;
  }
  structureState.set(tileIdx, next);
  return next;
}

function resolveSmelterRecipe({ structure, getBioforgeRecipe, defaultBioforgeRecipe }: any){
  if(!structure){
    return defaultBioforgeRecipe ?? null;
  }
  if(structure.recipeKey){
    const recipe = getBioforgeRecipe(structure.recipeKey);
    if(recipe){
      return recipe;
    }
  }
  return defaultBioforgeRecipe ?? null;
}

function resolveConstructorBlueprint({ structure, getConstructorBlueprint, defaultConstructorBlueprint }: any){
  if(!structure){
    return defaultConstructorBlueprint ?? null;
  }
  if(structure.recipeKey){
    const blueprint = getConstructorBlueprint(structure.recipeKey);
    if(blueprint){
      return blueprint;
    }
  }
  return defaultConstructorBlueprint ?? null;
}

function clusterObjectIdForEntry(entry: any){
  if(!entry || !Number.isFinite(entry.tileIdx)){
    return null;
  }
  const kind = entry.kind ?? 'unknown';
  return `${entry.type ?? 'object'}-${kind}-${entry.tileIdx}`;
}

function makeAutoLinkKey(sourceObjectId: string | null, sourcePortId: string | null, targetObjectId: string | null, targetPortId: string | null, item: string | null){
  return `${sourceObjectId}:${sourcePortId}->${targetObjectId}:${targetPortId}:${item ?? ''}`;
}

function buildAutoLinkId(clusterId: string | null, sourceObjectId: string, targetObjectId: string, item: string | null){
  return `${CLOUD_CLUSTER_AUTO_LINK_PREFIX}${clusterId}:${sourceObjectId}->${targetObjectId}:${item ?? ''}`;
}

function cloneStructureState(source: Map<number, any>){
  const clone = new Map();
  for(const [tileIdx, structure] of source.entries()){
    clone.set(tileIdx, {
      ...structure,
      availableRecipeKeys: Array.isArray(structure?.availableRecipeKeys)
        ? structure.availableRecipeKeys.slice()
        : null,
      availableBlueprintKeys: Array.isArray(structure?.availableBlueprintKeys)
        ? structure.availableBlueprintKeys.slice()
        : null,
    });
  }
  return clone;
}

function isManualLink(link: any){
  if(!link){
    return false;
  }
  const isAutoMeta = link?.metadata?.auto === true;
  const hasAutoId = typeof link?.id === 'string' && link.id.startsWith(CLOUD_CLUSTER_AUTO_LINK_PREFIX);
  return !(isAutoMeta || hasAutoId);
}

function normaliseClusterSnapshot(snapshot: any){
  const objects = new Map();
  const links = new Map();
  if(!snapshot){
    return { objects, links };
  }
  if(snapshot.objects instanceof Map){
    for(const [id, object] of snapshot.objects.entries()){
      objects.set(id, object);
    }
  } else if(Array.isArray(snapshot.objects)){
    for(const object of snapshot.objects){
      if(object?.id){
        objects.set(object.id, object);
      }
    }
  }
  if(snapshot.links instanceof Map){
    for(const [id, link] of snapshot.links.entries()){
      links.set(id, link);
    }
  } else if(Array.isArray(snapshot.links)){
    for(const link of snapshot.links){
      const key = link?.id ?? makeAutoLinkKey(
        link?.source?.objectId ?? '',
        link?.source?.portId ?? '',
        link?.target?.objectId ?? '',
        link?.target?.portId ?? '',
        link?.metadata?.item ?? '',
      );
      links.set(key, link);
    }
  }
  return { objects, links };
}
