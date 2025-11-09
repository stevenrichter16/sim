import {
  FactoryKind,
  FactoryItem,
  getBioforgeRecipeDefinition,
  getConstructorBlueprintDefinition,
  getFactoryOwnership,
} from '../../factory.js';
import {
  CloudFactoryPortDirection,
  getPortById,
  serialiseFactoryObject,
} from '../domain/factoryObject.js';
import {
  createCluster as createClusterModel,
  cloneCluster,
  upsertFactoryObject,
  removeFactoryObject,
  upsertLink,
  removeLink as removeClusterLink,
  isCluster,
} from '../domain/cluster.js';
import { ensureRegistry } from '../registry.js';
import {
  getCloudClusterRegistry,
  setCloudClusterRegistry,
} from '../state/index.js';
import {
  validateClusterRouting,
  calculateClusterThroughput,
  createClusterTelemetry,
  getCloudClusterTelemetry,
  getClusterValidationReport,
  getClusterThroughput,
  stepCloudClusterSimulation,
  clearClusterAccumulator,
  updateClusterAccumulatorMembership,
} from '../sim/index.js';

const KIND_LABEL = Object.freeze({
  [FactoryKind.NODE]: 'Dermal Node',
  [FactoryKind.MINER]: 'Harvest Surgeon',
  [FactoryKind.BELT]: 'Vein Conveyor',
  [FactoryKind.SMELTER]: 'Bioforge Vat',
  [FactoryKind.CONSTRUCTOR]: 'Synth Constructor',
  [FactoryKind.STORAGE]: 'Cradle Vault',
});

const CONSTRUCTOR_BLUEPRINT_KEYS = Object.freeze([
  'human_shell',
  'caretaker_drone',
  'emissary_avatar',
]);

const DEFAULT_OBJECT_METADATA = Object.freeze({
  [FactoryKind.MINER]: { resource: FactoryItem.SKIN_PATCH },
  [FactoryKind.SMELTER]: { recipeKey: 'body_system' },
  [FactoryKind.CONSTRUCTOR]: {
    blueprintKey: 'human_shell',
    blueprintKeys: CONSTRUCTOR_BLUEPRINT_KEYS,
  },
});

const DEFAULT_PORT_TEMPLATES = Object.freeze({
  [FactoryKind.NODE]: [
    { direction: CloudFactoryPortDirection.INPUT, label: 'Input' },
    { direction: CloudFactoryPortDirection.OUTPUT, label: 'Output' },
  ],
  [FactoryKind.MINER]: [
    { direction: CloudFactoryPortDirection.OUTPUT, label: 'Output' },
  ],
  [FactoryKind.BELT]: [
    { direction: CloudFactoryPortDirection.INPUT, label: 'Input' },
    { direction: CloudFactoryPortDirection.OUTPUT, label: 'Output' },
  ],
  [FactoryKind.SMELTER]: [
    { direction: CloudFactoryPortDirection.INPUT, label: 'Input' },
    { direction: CloudFactoryPortDirection.OUTPUT, label: 'Output' },
  ],
  [FactoryKind.CONSTRUCTOR]: [
    { direction: CloudFactoryPortDirection.INPUT, label: 'Intake A' },
    { direction: CloudFactoryPortDirection.INPUT, label: 'Intake B' },
    { direction: CloudFactoryPortDirection.INPUT, label: 'Intake C' },
    { direction: CloudFactoryPortDirection.INPUT, label: 'Intake D' },
    { direction: CloudFactoryPortDirection.OUTPUT, label: 'Output' },
  ],
  [FactoryKind.STORAGE]: [
    { direction: CloudFactoryPortDirection.INPUT, label: 'Input' },
    { direction: CloudFactoryPortDirection.OUTPUT, label: 'Output' },
  ],
});

const PALETTE_ENTRIES = Object.freeze([
  {
    key: 'node-dermal',
    kind: FactoryKind.NODE,
    icon: '🧬',
    label: 'Dermal Node',
    description: 'Static dermal anchor that emits skin patches.',
    metadata: { outputItems: [FactoryItem.SKIN_PATCH] },
    ports: [
      {
        id: 'out-dermal',
        direction: CloudFactoryPortDirection.OUTPUT,
        label: 'Skin Patch Output',
        itemKeys: [FactoryItem.SKIN_PATCH],
      },
    ],
  },
  {
    key: 'node-blood',
    kind: FactoryKind.NODE,
    icon: '🩸',
    label: 'Bloodwell Node',
    description: 'Wells of suspended blood serum.',
    metadata: { outputItems: [FactoryItem.BLOOD_VIAL] },
    ports: [
      {
        id: 'out-blood',
        direction: CloudFactoryPortDirection.OUTPUT,
        label: 'Blood Vial Output',
        itemKeys: [FactoryItem.BLOOD_VIAL],
      },
    ],
  },
  {
    key: 'node-organ',
    kind: FactoryKind.NODE,
    icon: '🫀',
    label: 'Organ Bloom Node',
    description: 'Visceral fascias that emit organ mass.',
    metadata: { outputItems: [FactoryItem.ORGAN_MASS] },
    ports: [
      {
        id: 'out-organ',
        direction: CloudFactoryPortDirection.OUTPUT,
        label: 'Organ Mass Output',
        itemKeys: [FactoryItem.ORGAN_MASS],
      },
    ],
  },
  {
    key: 'node-nerve',
    kind: FactoryKind.NODE,
    icon: '🧠',
    label: 'Synapse Node',
    description: 'Neuronal bundles spun into nerve thread.',
    metadata: { outputItems: [FactoryItem.NERVE_THREAD] },
    ports: [
      {
        id: 'out-nerve',
        direction: CloudFactoryPortDirection.OUTPUT,
        label: 'Nerve Thread Output',
        itemKeys: [FactoryItem.NERVE_THREAD],
      },
    ],
  },
  {
    key: 'node-bone',
    kind: FactoryKind.NODE,
    icon: '🦴',
    label: 'Osteo Node',
    description: 'Calcified projections generating bone fragments.',
    metadata: { outputItems: [FactoryItem.BONE_FRAGMENT] },
    ports: [
      {
        id: 'out-bone',
        direction: CloudFactoryPortDirection.OUTPUT,
        label: 'Bone Fragment Output',
        itemKeys: [FactoryItem.BONE_FRAGMENT],
      },
    ],
  },
  {
    key: 'node-gland',
    kind: FactoryKind.NODE,
    icon: '🧪',
    label: 'Endocrine Node',
    description: 'Endocrine protrusions that emit gland seeds.',
    metadata: { outputItems: [FactoryItem.GLAND_SEED] },
    ports: [
      {
        id: 'out-gland',
        direction: CloudFactoryPortDirection.OUTPUT,
        label: 'Gland Seed Output',
        itemKeys: [FactoryItem.GLAND_SEED],
      },
    ],
  },
  {
    key: 'belt',
    kind: FactoryKind.BELT,
    icon: '🪢',
    label: KIND_LABEL[FactoryKind.BELT],
    description: 'Transfers materials between upstream and downstream objects.',
  },
  /* Legacy smelter palette entries retained for reference.
  { ... }
  */
  {
    key: 'smelter-omni',
    kind: FactoryKind.SMELTER,
    icon: '🧬',
    label: 'Omni Bioforge',
    description: 'Adaptive bioforge capable of every known vat recipe.',
    metadata: {
      recipeKey: 'body_system',
      recipeKeys: ['body_system', 'neural_weave', 'skeletal_frame', 'glandular_network'],
    },
    ports: [
      {
        id: 'in-a',
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Intake A',
        itemKeys: [
          FactoryItem.SKIN_PATCH,
          FactoryItem.BLOOD_VIAL,
          FactoryItem.ORGAN_MASS,
          FactoryItem.NERVE_THREAD,
          FactoryItem.BONE_FRAGMENT,
          FactoryItem.GLAND_SEED,
        ],
      },
      {
        id: 'in-b',
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Intake B',
        itemKeys: [
          FactoryItem.SKIN_PATCH,
          FactoryItem.BLOOD_VIAL,
          FactoryItem.ORGAN_MASS,
          FactoryItem.NERVE_THREAD,
          FactoryItem.BONE_FRAGMENT,
          FactoryItem.GLAND_SEED,
        ],
      },
      {
        id: 'in-c',
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Intake C',
        itemKeys: [
          FactoryItem.SKIN_PATCH,
          FactoryItem.BLOOD_VIAL,
          FactoryItem.ORGAN_MASS,
          FactoryItem.NERVE_THREAD,
          FactoryItem.BONE_FRAGMENT,
          FactoryItem.GLAND_SEED,
        ],
      },
      {
        id: 'out-products',
        direction: CloudFactoryPortDirection.OUTPUT,
        label: 'Bioforge Output',
        itemKeys: [
          FactoryItem.BODY_SYSTEM,
          FactoryItem.NEURAL_WEAVE,
          FactoryItem.SKELETAL_FRAME,
          FactoryItem.GLANDULAR_NETWORK,
        ],
      },
    ],
  },
  {
    key: 'constructor-omni',
    kind: FactoryKind.CONSTRUCTOR,
    icon: '🧍',
    label: 'Omni Constructor',
    description: 'Synth fab that assembles shells, caretakers, or emissaries from available stock.',
    metadata: {
      blueprintKey: 'human_shell',
      blueprintKeys: CONSTRUCTOR_BLUEPRINT_KEYS,
    },
    ports: [
      { id: 'in-a', direction: CloudFactoryPortDirection.INPUT, label: 'Intake A' },
      { id: 'in-b', direction: CloudFactoryPortDirection.INPUT, label: 'Intake B' },
      { id: 'in-c', direction: CloudFactoryPortDirection.INPUT, label: 'Intake C' },
      { id: 'in-d', direction: CloudFactoryPortDirection.INPUT, label: 'Intake D' },
      {
        id: 'out-products',
        direction: CloudFactoryPortDirection.OUTPUT,
        label: 'Constructor Output',
        itemKeys: [
          FactoryItem.HUMAN_SHELL,
          FactoryItem.CARETAKER_DRONE,
          FactoryItem.EMISSARY_AVATAR,
        ],
      },
    ],
  },
  {
    key: 'storage',
    kind: FactoryKind.STORAGE,
    icon: '🛏️',
    label: KIND_LABEL[FactoryKind.STORAGE],
    description: 'Buffers inputs and outputs for distribution or delivery.',
  },
]);

function normaliseClusterId(rawId, fallback){
  const base = rawId ?? fallback ?? 'cluster';
  const slug = String(base)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'cluster';
}

  function cloneRegistry(registry){
    const ensured = ensureRegistry(registry);
    return {
      version: ensured.version ?? 1,
      byId: new Map(ensured.byId ?? []),
      order: Array.isArray(ensured.order) ? ensured.order.slice() : [],
    };
  }

  function getSmelterRecipes(){
    return getSmelterRecipeSummaries();
  }

  function getConstructorBlueprints(){
    return getConstructorBlueprintSummaries();
  }

  function advanceSimulation(step = 1){
    const telemetry = getCloudClusterTelemetry();
    const currentTick = telemetry?.tick ?? 0;
    const increment = Math.max(1, step | 0);
    stepCloudClusterSimulation({ tick: currentTick + increment });
  }

function orderedClusterIds(registry){
  const ensured = ensureRegistry(registry);
  const ids = [];
  const seen = new Set();
  const ordered = Array.isArray(ensured.order) && ensured.order.length
    ? ensured.order
    : [];
  for(const id of ordered){
    if(seen.has(id)) continue;
    if(ensured.byId.has(id)){
      ids.push(id);
      seen.add(id);
    }
  }
  for(const [id, cluster] of ensured.byId.entries()){
    if(!cluster || seen.has(id)) continue;
    ids.push(id);
  }
  return ids;
}

function deriveStatusFromIssues(issues = []){
  if(issues.some((issue) => issue?.severity === 'error')){
    return 'error';
  }
  if(issues.some((issue) => issue?.severity === 'warning')){
    return 'warning';
  }
  return 'ok';
}

function createDefaultPorts(kind, ordinal){
  const templates = DEFAULT_PORT_TEMPLATES[kind] ?? [];
  return templates.map((template, index) => ({
    id: `${template.direction === CloudFactoryPortDirection.INPUT ? 'in' : 'out'}-${ordinal}-${index + 1}`,
    label: template.label,
    direction: template.direction,
    itemKeys: Array.isArray(template.itemKeys) ? template.itemKeys.slice() : [],
    capacity: Number.isFinite(template.capacity) ? template.capacity : null,
    metadata: template.metadata ? { ...template.metadata } : {},
  }));
}

function ensureCluster(instance){
  if(!isCluster(instance)){
    throw new Error('Expected a valid cloud cluster instance.');
  }
  return instance;
}

export function getCloudClusterPalette(){
  return PALETTE_ENTRIES.map((entry) => ({
    ...entry,
    metadata: entry.metadata ? { ...entry.metadata } : undefined,
    ports: Array.isArray(entry.ports)
      ? entry.ports.map((port) => ({
          ...port,
          itemKeys: Array.isArray(port.itemKeys) ? port.itemKeys.slice() : [],
          metadata: port.metadata ? { ...port.metadata } : undefined,
        }))
      : undefined,
  }));
}

function formatRecipeItemName(item){
  if(typeof item === 'string' && item.length){
    return item.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  return String(item ?? 'Item');
}

const RATE_EPSILON = 1e-5;

function selectPrimaryOutputEntry(telemetryEntry){
  if(!telemetryEntry || !Array.isArray(telemetryEntry.outputs) || !telemetryEntry.outputs.length){
    return null;
  }
  let best = null;
  for(const entry of telemetryEntry.outputs){
    if(!entry || !entry.item) continue;
    if(!best || (entry.rate ?? 0) > (best.rate ?? 0)){
      best = entry;
    }
  }
  if(!best || (best.rate ?? 0) <= RATE_EPSILON){
    return null;
  }
  return best;
}

function inferObjectOutputItem(object){
  if(!object) return null;
  const metadata = object.metadata ?? {};
  switch(object.kind){
    case FactoryKind.NODE:
      if(Array.isArray(metadata.outputItems) && metadata.outputItems.length){
        return metadata.outputItems[0];
      }
      return null;
    case FactoryKind.MINER:
      return metadata.resource ?? null;
    case FactoryKind.SMELTER: {
      const key = typeof metadata.recipeKey === 'string'
        ? metadata.recipeKey
        : typeof metadata.recipe === 'string'
          ? metadata.recipe
          : typeof metadata.recipe?.key === 'string'
            ? metadata.recipe.key
            : null;
      const recipe = getBioforgeRecipeDefinition(key);
      return recipe?.output ?? null;
    }
    case FactoryKind.CONSTRUCTOR: {
      const key = typeof metadata.blueprintKey === 'string'
        ? metadata.blueprintKey
        : typeof metadata.blueprint === 'string'
          ? metadata.blueprint
          : typeof metadata.blueprint?.key === 'string'
            ? metadata.blueprint.key
            : null;
      const blueprint = getConstructorBlueprintDefinition(key);
      return blueprint?.output ?? null;
    }
    case FactoryKind.STORAGE:
      if(Array.isArray(metadata.allowedItems) && metadata.allowedItems.length){
        return metadata.allowedItems[0];
      }
      return null;
    default:
      return null;
  }
}

function collectInboundItems(cluster, objectId, telemetryByNode = null){
  const items = new Map();
  if(!cluster || !objectId) return items;
  for(const link of cluster.links.values()){
    if(link?.target?.objectId !== objectId) continue;
    const sourceId = link.source?.objectId;
    if(!sourceId) continue;
    const source = cluster.objects.get(sourceId);
    if(!source) continue;
    let item = null;
    let rate = 0;
    if(telemetryByNode && telemetryByNode.has(sourceId)){
      const primary = selectPrimaryOutputEntry(telemetryByNode.get(sourceId));
      if(primary){
        item = primary.item;
        rate = primary.rate ?? 0;
      }
    }
    if(!item){
      item = inferObjectOutputItem(source);
      rate = 0;
    }
    if(item){
      const prev = items.get(item) ?? 0;
      items.set(item, Math.max(prev, rate));
    }
  }
  return items;
}

export function getSmelterRecipeSummaries(){
  const recipeKeys = ['body_system', 'neural_weave', 'skeletal_frame', 'glandular_network'];
  const summaries = [];
  for(const key of recipeKeys){
    const recipe = getBioforgeRecipeDefinition(key);
    if(!recipe) continue;
    const inputs = [];
    if(recipe.inputs instanceof Map){
      for(const [item, amount] of recipe.inputs.entries()){
        inputs.push({
          item,
          amount: Number.isFinite(amount) && amount > 0 ? amount : 1,
          label: formatRecipeItemName(item),
        });
      }
    } else if(Array.isArray(recipe.inputs)){
      for(const entry of recipe.inputs){
        if(!entry) continue;
        const item = entry.item ?? entry[0] ?? null;
        const amount = Number.isFinite(entry.amount) ? entry.amount : Number.isFinite(entry[1]) ? entry[1] : 1;
        inputs.push({
          item,
          amount: amount > 0 ? amount : 1,
          label: formatRecipeItemName(entry.label ?? item),
        });
      }
    } else if(recipe.inputs && typeof recipe.inputs === 'object'){
      for(const [item, value] of Object.entries(recipe.inputs)){
        const amount = Number.isFinite(value) ? value : 1;
        inputs.push({
          item,
          amount: amount > 0 ? amount : 1,
          label: formatRecipeItemName(item),
        });
      }
    }
    summaries.push({
      key: recipe.key ?? key,
      output: recipe.output ?? null,
      outputLabel: recipe.label ?? formatRecipeItemName(recipe.output),
      description: recipe.description ?? '',
      inputs,
    });
  }
  return summaries;
}

export function getConstructorBlueprintSummaries(){
  const summaries = [];
  for(const key of CONSTRUCTOR_BLUEPRINT_KEYS){
    const blueprint = getConstructorBlueprintDefinition(key);
    if(!blueprint) continue;
    const inputs = [];
    if(blueprint.inputs instanceof Map){
      for(const [item, amount] of blueprint.inputs.entries()){
        inputs.push({
          item,
          amount: Number.isFinite(amount) && amount > 0 ? amount : 1,
          label: formatRecipeItemName(item),
        });
      }
    } else if(Array.isArray(blueprint.inputs)){
      for(const entry of blueprint.inputs){
        if(!entry) continue;
        const item = entry.item ?? entry[0] ?? null;
        const amount = Number.isFinite(entry.amount) ? entry.amount : Number.isFinite(entry[1]) ? entry[1] : 1;
        inputs.push({
          item,
          amount: amount > 0 ? amount : 1,
          label: formatRecipeItemName(entry.label ?? item),
        });
      }
    } else if(blueprint.inputs && typeof blueprint.inputs === 'object'){
      for(const [item, value] of Object.entries(blueprint.inputs)){
        const amount = Number.isFinite(value) ? value : 1;
        inputs.push({
          item,
          amount: amount > 0 ? amount : 1,
          label: formatRecipeItemName(item),
        });
      }
    }
    summaries.push({
      key: blueprint.key ?? key,
      output: blueprint.output ?? null,
      outputLabel: blueprint.label ?? formatRecipeItemName(blueprint.output),
      description: blueprint.description ?? '',
      inputs,
    });
  }
  return summaries;
}

export function createCloudClusterEditor(options = {}){
  const initialRegistry = ensureRegistry(options.registry ?? getCloudClusterRegistry());
  const state = {
    registry: initialRegistry,
    selectedClusterId: null,
    selectedObjectId: null,
    pendingLink: null,
    kindCounters: new Map(),
    clusterCounter: 1,
    diffBundles: [],
    manualLinkWarnings: [],
  };

  function refreshOwnershipDiagnostics(){
    try {
      const ownership = getFactoryOwnership();
      state.diffBundles = Array.isArray(ownership.diffBundles) ? ownership.diffBundles : [];
      state.manualLinkWarnings = Array.isArray(ownership.manualLinkWarnings) ? ownership.manualLinkWarnings : [];
    } catch (error){
      state.diffBundles = [];
      state.manualLinkWarnings = [];
      if(typeof console !== 'undefined' && console.warn){
        console.warn('[cloudCluster] Failed to refresh ownership diagnostics', error);
      }
    }
  }

  function commit(nextRegistry){
    state.registry = setCloudClusterRegistry(ensureRegistry(nextRegistry));
    refreshSelection();
    refreshOwnershipDiagnostics();
    return state.registry;
  }

  function refreshSelection(){
    const registry = state.registry;
    if(state.selectedClusterId && !registry.byId.has(state.selectedClusterId)){
      state.selectedClusterId = null;
    }
    if(state.selectedClusterId){
      const cluster = registry.byId.get(state.selectedClusterId);
      if(!cluster || !cluster.objects.has(state.selectedObjectId)){
        state.selectedObjectId = null;
      }
    }
    if(!state.selectedClusterId){
      const firstId = orderedClusterIds(registry)[0] ?? null;
      state.selectedClusterId = firstId ?? null;
      state.selectedObjectId = null;
    }
    if(state.selectedClusterId == null){
      state.pendingLink = null;
    }
  }

  function getClusters(){
    refreshOwnershipDiagnostics();
    const registry = state.registry;
    const warningByCluster = new Map();
    for(const warning of state.manualLinkWarnings ?? []){
      if(warning?.clusterId){
        warningByCluster.set(warning.clusterId, warning);
      }
    }
    const result = [];
    for(const id of orderedClusterIds(registry)){
      const cluster = registry.byId.get(id);
      if(!cluster) continue;
      const warning = warningByCluster.get(cluster.id);
      result.push({
        id: cluster.id,
        name: cluster.name,
        description: cluster.description,
        objectCount: cluster.objects.size,
        linkCount: cluster.links.size,
        manualWarningCount: warning?.droppedLinks?.length ?? 0,
        manualWarnings: warning ?? null,
      });
    }
    return result;
  }

  function ensureSelectedClusterId(){
    refreshSelection();
    return state.selectedClusterId;
  }

  function updateCluster(clusterId, updater){
    const registry = state.registry;
    if(!registry.byId.has(clusterId)){
      throw new Error(`Unknown cluster: ${clusterId}`);
    }
    const nextRegistry = cloneRegistry(registry);
    const currentCluster = registry.byId.get(clusterId);
    const draft = cloneCluster(currentCluster);
    const result = updater(draft);
    nextRegistry.byId.set(clusterId, draft);
    const added = [];
    const removed = [];
    for(const id of currentCluster.objects.keys()){
      if(!draft.objects.has(id)){
        removed.push(id);
      }
    }
    for(const id of draft.objects.keys()){
      if(!currentCluster.objects.has(id)){
        added.push(id);
      }
    }
    if(added.length || removed.length){
      // cluster composition changed; accumulator updated below
    }
    if(!nextRegistry.order.includes(clusterId)){
      nextRegistry.order.push(clusterId);
    }
    commit(nextRegistry);
    updateClusterAccumulatorMembership(clusterId, { added, removed });
    return result;
  }

  function maybeAutoSelectConstructorBlueprint(clusterId, objectId, { telemetryByNode = null, clusterOverride = null } = {}){
    if(!clusterId || !objectId) return;
    const registry = state.registry;
    if(!registry.byId.has(clusterId)) return;
    const cluster = clusterOverride ?? registry.byId.get(clusterId);
    ensureCluster(cluster);
    const object = cluster.objects.get(objectId);
    if(!object || object.kind !== FactoryKind.CONSTRUCTOR) return;

    let telemetryMap = telemetryByNode;
    if(!telemetryMap){
      const inspector = getInspector(clusterId);
      telemetryMap = inspector && Array.isArray(inspector.objects)
        ? new Map(inspector.objects.map((entry) => [entry.id, entry]))
        : null;
    }

    const inboundItems = collectInboundItems(cluster, objectId, telemetryMap);
    const metadata = object.metadata ?? {};
    const blueprintCandidates = Array.isArray(metadata.blueprintKeys) && metadata.blueprintKeys.length
      ? metadata.blueprintKeys
      : CONSTRUCTOR_BLUEPRINT_KEYS;

    let bestKey = null;
    let bestScore = -1;
    for(const key of blueprintCandidates){
      const blueprint = getConstructorBlueprintDefinition(key);
      if(!blueprint) continue;
      const requiredItems = new Set((blueprint.inputs ?? []).map((entry) => entry?.item).filter(Boolean));
      if(requiredItems.size === 0){
        if(bestKey == null){
          bestKey = key;
          bestScore = 0;
        }
        continue;
      }
      const satisfied = Array.from(requiredItems).every((item) => {
        const rate = inboundItems.get(item) ?? 0;
        return rate > RATE_EPSILON;
      });
      if(!satisfied) continue;
      const score = Array.from(requiredItems).reduce((sum, item) => sum + (inboundItems.get(item) ?? 0), 0);
      if(score > bestScore){
        bestKey = key;
        bestScore = score;
      }
    }

    if(!bestKey){
      bestKey = metadata.blueprintKey ?? blueprintCandidates[0] ?? null;
    }

    if(!bestKey || bestKey === metadata.blueprintKey) return;

    updateCluster(clusterId, (draft) => {
      const existing = draft.objects.get(objectId);
      if(!existing) return null;
      const definition = serialiseFactoryObject(existing);
      definition.metadata = {
        ...definition.metadata,
        blueprintKey: bestKey,
      };
      upsertFactoryObject(draft, definition);
      return null;
    });
  }

  function autoSelectConstructorBlueprints(clusterId = state.selectedClusterId, telemetryByNode = null){
    if(!clusterId) return;
    const registry = state.registry;
    if(!registry.byId.has(clusterId)) return;
    const cluster = registry.byId.get(clusterId);
    ensureCluster(cluster);
    let telemetryMap = telemetryByNode;
    if(!telemetryMap){
      const inspector = getInspector(clusterId);
      telemetryMap = inspector && Array.isArray(inspector.objects)
        ? new Map(inspector.objects.map((entry) => [entry.id, entry]))
        : null;
    }
    for(const object of cluster.objects.values()){
      if(object.kind === FactoryKind.CONSTRUCTOR){
        maybeAutoSelectConstructorBlueprint(clusterId, object.id, {
          telemetryByNode: telemetryMap,
          clusterOverride: cluster,
        });
      }
    }
  }

  function generateObjectId(cluster, kind){
    const counter = state.kindCounters.get(kind) ?? 1;
    let attempt = counter;
    let candidate = `${kind}-${attempt}`;
    while(cluster.objects.has(candidate)){
      attempt += 1;
      candidate = `${kind}-${attempt}`;
    }
    state.kindCounters.set(kind, attempt + 1);
    return candidate;
  }

  function getSelectedCluster(){
    const clusterId = ensureSelectedClusterId();
    if(!clusterId) return null;
    return state.registry.byId.get(clusterId) ?? null;
  }

  function selectCluster(clusterId){
    if(!clusterId){
      state.selectedClusterId = null;
      state.selectedObjectId = null;
      state.pendingLink = null;
      refreshSelection();
      return state.selectedClusterId ? state.registry.byId.get(state.selectedClusterId) ?? null : null;
    }
    if(!state.registry.byId.has(clusterId)){
      return null;
    }
    state.selectedClusterId = clusterId;
    const cluster = state.registry.byId.get(clusterId);
    if(!cluster?.objects.has(state.selectedObjectId)){
      state.selectedObjectId = null;
    }
    state.pendingLink = null;
    return cluster;
  }

  function selectObject(objectId){
    const cluster = getSelectedCluster();
    if(!cluster) return null;
    if(!cluster.objects.has(objectId)){
      state.selectedObjectId = null;
      return null;
    }
    state.selectedObjectId = objectId;
    return cluster.objects.get(objectId) ?? null;
  }

  function createCluster(def = {}){
    const registry = state.registry;
    const nextRegistry = cloneRegistry(registry);
    const ordinal = state.clusterCounter++;
    const fallbackId = `cluster-${ordinal}`;
    const idBase = normaliseClusterId(def.id ?? def.name, fallbackId);
    let candidate = idBase;
    let attempt = 1;
    while(nextRegistry.byId.has(candidate)){
      attempt += 1;
      candidate = `${idBase}-${attempt}`;
    }
    const cluster = createClusterModel({
      id: candidate,
      name: def.name ?? `Cluster ${ordinal}`,
      description: def.description ?? '',
      objects: Array.isArray(def.objects) ? def.objects : [],
      links: Array.isArray(def.links) ? def.links : [],
      metadata: def.metadata,
    });
    nextRegistry.byId.set(cluster.id, cluster);
    if(!nextRegistry.order.includes(cluster.id)){
      nextRegistry.order.push(cluster.id);
    }
    commit(nextRegistry);
    clearClusterAccumulator(cluster.id);
    state.selectedClusterId = cluster.id;
    state.selectedObjectId = null;
    state.pendingLink = null;
    return cluster;
  }

  function removeCluster(clusterId){
    const registry = state.registry;
    if(!registry.byId.has(clusterId)) return false;
    const nextRegistry = cloneRegistry(registry);
    const removed = nextRegistry.byId.delete(clusterId);
    if(removed){
      nextRegistry.order = nextRegistry.order.filter((id) => id !== clusterId);
      commit(nextRegistry);
      if(state.selectedClusterId === clusterId){
        state.selectedClusterId = null;
        state.selectedObjectId = null;
        state.pendingLink = null;
        refreshSelection();
      }
      clearClusterAccumulator(clusterId);
    }
    return removed;
  }

  function addObject(def){
    const cluster = getSelectedCluster();
    if(!cluster){
      throw new Error('Cannot add object without selecting a cluster.');
    }
    return updateCluster(cluster.id, (draft) => upsertFactoryObject(draft, def));
  }

  function addObjectFromPalette(kindOrEntry, overrides = {}){
    const cluster = getSelectedCluster();
    if(!cluster){
      throw new Error('Cannot add object without selecting a cluster.');
    }
    let paletteEntry = null;
    let kind = kindOrEntry;
    if(kindOrEntry && typeof kindOrEntry === 'object' && kindOrEntry.kind){
      paletteEntry = kindOrEntry;
      kind = paletteEntry.kind;
    }
    const labelBase = overrides.label ?? paletteEntry?.label ?? KIND_LABEL[kind] ?? kind;
    const ordinal = state.kindCounters.get(kind) ?? 1;
    let objectId;
    if(overrides.id){
      objectId = String(overrides.id);
      state.kindCounters.set(kind, ordinal + 1);
    } else {
      objectId = generateObjectId(cluster, kind);
    }
    const portsSource = overrides.ports ?? paletteEntry?.ports ?? null;
    const ports = Array.isArray(portsSource)
      ? portsSource.map((port) => ({
          ...port,
          id: String(port.id ?? `${port.direction}-${ordinal}`),
          direction: port.direction === CloudFactoryPortDirection.OUTPUT
            ? CloudFactoryPortDirection.OUTPUT
            : CloudFactoryPortDirection.INPUT,
          itemKeys: Array.isArray(port.itemKeys) ? port.itemKeys.map(String) : [],
          capacity: Number.isFinite(port.capacity) ? port.capacity : null,
          metadata: port.metadata ? { ...port.metadata } : {},
        }))
      : createDefaultPorts(kind, ordinal);
    const metadata = {
      ...(DEFAULT_OBJECT_METADATA[kind] ?? {}),
      ...(paletteEntry?.metadata ?? {}),
      ...(overrides.metadata ?? {}),
    };
    const object = {
      id: objectId,
      kind,
      label: `${labelBase} ${ordinal}`.trim(),
      description: overrides.description ?? paletteEntry?.description ?? '',
      ports,
      metadata,
    };
    const created = updateCluster(cluster.id, (draft) => upsertFactoryObject(draft, object));
    state.selectedObjectId = object.id;
    return created;
  }

  function removeObject(objectId){
    const cluster = getSelectedCluster();
    if(!cluster) return false;
    const removed = updateCluster(cluster.id, (draft) => removeFactoryObject(draft, objectId));
    if(removed && state.selectedObjectId === objectId){
      state.selectedObjectId = null;
    }
    return removed;
  }

  function beginLink(objectId, portId){
    const cluster = getSelectedCluster();
    if(!cluster){
      throw new Error('Cannot start a link without a selected cluster.');
    }
    const object = cluster.objects.get(objectId);
    const port = getPortById(object, portId);
    if(!port){
      throw new Error(`Unknown port ${portId} on object ${objectId}.`);
    }
    if(port.direction !== CloudFactoryPortDirection.OUTPUT){
      throw new Error('Link source must be an output port.');
    }
    state.pendingLink = { objectId, portId };
    return state.pendingLink;
  }

  function generateLinkId(cluster, source, target, explicitId){
    if(explicitId){
      return String(explicitId);
    }
    const base = `${source.objectId}-${source.portId}__${target.objectId}-${target.portId}`.replace(/[^a-z0-9_-]+/gi, '_');
    let candidate = base;
    let attempt = 1;
    while(cluster.links.has(candidate)){
      attempt += 1;
      candidate = `${base}_${attempt}`;
    }
    return candidate;
  }

  function completeLink(targetObjectId, targetPortId, options = {}){
    const cluster = getSelectedCluster();
    if(!cluster){
      throw new Error('Cannot complete a link without a selected cluster.');
    }
    const start = options.source ?? state.pendingLink;
    if(!start){
      return null;
    }
    const sourceObject = cluster.objects.get(start.objectId);
    const sourcePort = getPortById(sourceObject, start.portId);
    if(!sourcePort || sourcePort.direction !== CloudFactoryPortDirection.OUTPUT){
      state.pendingLink = null;
      throw new Error('Link source must be an output port.');
    }
    const targetObject = cluster.objects.get(targetObjectId);
    const targetPort = getPortById(targetObject, targetPortId);
    if(!targetPort){
      state.pendingLink = null;
      throw new Error(`Unknown target port ${targetPortId}.`);
    }
    if(targetPort.direction !== CloudFactoryPortDirection.INPUT){
      state.pendingLink = null;
      throw new Error('Link target must be an input port.');
    }
    const linkId = generateLinkId(cluster, start, { objectId: targetObjectId, portId: targetPortId }, options.linkId);
    const link = updateCluster(cluster.id, (draft) => upsertLink(draft, {
      id: linkId,
      source: { objectId: start.objectId, portId: start.portId },
      target: { objectId: targetObjectId, portId: targetPortId },
      metadata: options.metadata ?? {},
    }));
    state.pendingLink = null;
    if(link?.target?.objectId){
      maybeAutoSelectConstructorBlueprint(cluster.id, link.target.objectId);
    }
    return link;
  }

  function cancelLink(){
    state.pendingLink = null;
  }

  function removeLink(linkId){
    const cluster = getSelectedCluster();
    if(!cluster) return false;
    const link = cluster.links.get(linkId);
    const targetObjectId = link?.target?.objectId ?? null;
    const removed = updateCluster(cluster.id, (draft) => removeClusterLink(draft, linkId));
    if(removed && targetObjectId){
      maybeAutoSelectConstructorBlueprint(cluster.id, targetObjectId);
    }
    return removed;
  }

  function getGraph(clusterId = state.selectedClusterId){
    if(!clusterId || !state.registry.byId.has(clusterId)) return null;
    const cluster = state.registry.byId.get(clusterId);
    ensureCluster(cluster);
    const linkedPorts = new Set();
    for(const link of cluster.links.values()){
      if(link?.source?.objectId && link?.source?.portId){
        linkedPorts.add(`${link.source.objectId}::${link.source.portId}::${link.id}`);
      }
      if(link?.target?.objectId && link?.target?.portId){
        linkedPorts.add(`${link.target.objectId}::${link.target.portId}::${link.id}`);
      }
    }
    return {
      clusterId: cluster.id,
      name: cluster.name,
      description: cluster.description,
      nodes: Array.from(cluster.objects.values(), (object) => ({
        id: object.id,
        kind: object.kind,
        label: object.label,
        description: object.description,
        metadata: object.metadata,
        selected: object.id === state.selectedObjectId,
        ports: object.ports.map((port) => {
          let linkedEntry = null;
          for(const entry of linkedPorts){
            if(entry.startsWith(`${object.id}::${port.id}::`)){
              const [, , linkId] = entry.split('::');
              linkedEntry = { linkId };
              break;
            }
          }
          return {
            id: port.id,
            label: port.label,
            direction: port.direction,
            itemKeys: port.itemKeys.slice(),
            capacity: port.capacity,
            metadata: port.metadata,
            linked: Boolean(linkedEntry),
            linkId: linkedEntry?.linkId ?? null,
          };
        }),
      })),
      links: Array.from(cluster.links.values(), (link) => ({
        id: link.id,
        source: { ...link.source },
        target: { ...link.target },
        metadata: link.metadata,
      })),
      pendingLink: state.pendingLink ? { ...state.pendingLink } : null,
    };
  }

  function getInspector(clusterId = state.selectedClusterId){
    if(!clusterId || !state.registry.byId.has(clusterId)) return null;
    const cluster = state.registry.byId.get(clusterId);
    ensureCluster(cluster);
    advanceSimulation();
    const telemetryState = getCloudClusterTelemetry();
    const telemetryEntry = telemetryState?.clusters?.find((entry) => entry.id === clusterId) ?? null;
    const validation = getClusterValidationReport(clusterId) ?? validateClusterRouting(cluster);
    const throughput = getClusterThroughput(clusterId) ?? calculateClusterThroughput(cluster);
    const telemetry = telemetryEntry ?? createClusterTelemetry(cluster, {
      validation,
      throughput,
      tick: telemetryState?.tick ?? null,
    });
    return {
      id: cluster.id,
      clusterId: cluster.id,
      name: cluster.name,
      description: cluster.description,
      status: telemetry?.status ?? deriveStatusFromIssues(validation?.issues ?? []),
      tick: telemetry?.tick ?? telemetryState?.tick ?? null,
      totals: telemetry?.totals ?? throughput?.totals ?? [],
      objects: telemetry?.objects ?? throughput?.objects ?? [],
      issues: validation?.issues ?? [],
    };
  }

  function getOverlay(){
    advanceSimulation();
    refreshOwnershipDiagnostics();
    const telemetryState = getCloudClusterTelemetry();
    const clusters = [];
    const warningByCluster = new Map();
    for(const warning of state.manualLinkWarnings ?? []){
      if(warning?.clusterId){
        warningByCluster.set(warning.clusterId, warning);
      }
    }
    for(const id of orderedClusterIds(state.registry)){
      const cluster = state.registry.byId.get(id);
      if(!cluster) continue;
      const validation = getClusterValidationReport(id) ?? validateClusterRouting(cluster);
      const throughput = getClusterThroughput(id) ?? calculateClusterThroughput(cluster);
      const telemetryEntry = telemetryState?.clusters?.find((entry) => entry.id === id) ?? null;
      const status = telemetryEntry?.status ?? deriveStatusFromIssues(validation?.issues ?? []);
      const warning = warningByCluster.get(id);
      clusters.push({
        id: cluster.id,
        name: cluster.name,
        description: cluster.description,
        status,
        issueCount: validation?.issues?.length ?? 0,
        issues: validation?.issues ?? [],
        totals: (telemetryEntry?.totals ?? throughput?.totals ?? []).slice(),
        manualWarningCount: warning?.droppedLinks?.length ?? 0,
        manualWarnings: warning ?? null,
      });
    }
    return {
      tick: telemetryState?.tick ?? null,
      clusters,
    };
  }

  function getOwnershipDiagnostics(){
    refreshOwnershipDiagnostics();
    return {
      diffBundles: state.diffBundles.slice(),
      manualLinkWarnings: state.manualLinkWarnings.slice(),
    };
  }

  function getState(){
    return {
      registry: state.registry,
      selectedClusterId: state.selectedClusterId,
      selectedObjectId: state.selectedObjectId,
      pendingLink: state.pendingLink,
    };
  }

  refreshSelection();
  refreshOwnershipDiagnostics();

  return {
    getState,
    getClusters,
    getPaletteEntries: getCloudClusterPalette,
    selectCluster,
    removeCluster,
    createCluster,
    addObject,
    addObjectFromPalette,
    selectObject,
    removeObject,
    beginLink,
    completeLink,
    cancelLink,
    removeLink,
    getGraph,
    getInspector,
    getOverlay,
    getOwnershipDiagnostics,
    stepSimulation: advanceSimulation,
    getSmelterRecipes,
    getConstructorBlueprints,
    autoSelectConstructorBlueprints,
  };
}

export default {
  createCloudClusterEditor,
  getCloudClusterPalette,
};
