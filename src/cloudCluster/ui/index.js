import { FactoryKind, FactoryItem } from '../../factory.js';
import {
  CloudFactoryPortDirection,
  getPortById,
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
} from '../sim/index.js';

const KIND_LABEL = Object.freeze({
  [FactoryKind.NODE]: 'Dermal Node',
  [FactoryKind.MINER]: 'Harvest Surgeon',
  [FactoryKind.BELT]: 'Vein Conveyor',
  [FactoryKind.SMELTER]: 'Bioforge Vat',
  [FactoryKind.CONSTRUCTOR]: 'Synth Constructor',
  [FactoryKind.STORAGE]: 'Cradle Vault',
});

const DEFAULT_OBJECT_METADATA = Object.freeze({
  [FactoryKind.MINER]: { resource: FactoryItem.SKIN_PATCH },
  [FactoryKind.SMELTER]: { recipeKey: 'body_system' },
  [FactoryKind.CONSTRUCTOR]: { blueprintKey: 'human_shell' },
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
    { direction: CloudFactoryPortDirection.INPUT, label: 'Input' },
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
  {
    key: 'smelter-body',
    kind: FactoryKind.SMELTER,
    icon: '🧪',
    label: 'Body System Vat',
    description: 'Bioforge that seals multi-organ capsules.',
    metadata: { recipeKey: 'body_system' },
    ports: [
      {
        id: 'in-skin',
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Skin Patch Intake',
        itemKeys: [FactoryItem.SKIN_PATCH],
      },
      {
        id: 'in-blood',
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Blood Vial Intake',
        itemKeys: [FactoryItem.BLOOD_VIAL],
      },
      {
        id: 'in-organ',
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Organ Mass Intake',
        itemKeys: [FactoryItem.ORGAN_MASS],
      },
      {
        id: 'out-body',
        direction: CloudFactoryPortDirection.OUTPUT,
        label: 'Body System Output',
        itemKeys: [FactoryItem.BODY_SYSTEM],
      },
    ],
  },
  {
    key: 'smelter-neural',
    kind: FactoryKind.SMELTER,
    icon: '🧠',
    label: 'Neural Weave Loom',
    description: 'Spins neural weave from nerve thread and serum.',
    metadata: { recipeKey: 'neural_weave' },
    ports: [
      {
        id: 'in-nerve',
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Nerve Thread Intake',
        itemKeys: [FactoryItem.NERVE_THREAD],
      },
      {
        id: 'in-blood',
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Blood Vial Intake',
        itemKeys: [FactoryItem.BLOOD_VIAL],
      },
      {
        id: 'out-neural',
        direction: CloudFactoryPortDirection.OUTPUT,
        label: 'Neural Weave Output',
        itemKeys: [FactoryItem.NEURAL_WEAVE],
      },
    ],
  },
  {
    key: 'smelter-frame',
    kind: FactoryKind.SMELTER,
    icon: '🦾',
    label: 'Frame Press',
    description: 'Compresses osteo fragments and dermal binding into rigid frames.',
    metadata: { recipeKey: 'skeletal_frame' },
    ports: [
      {
        id: 'in-bone',
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Bone Fragment Intake',
        itemKeys: [FactoryItem.BONE_FRAGMENT],
      },
      {
        id: 'in-skin',
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Skin Patch Intake',
        itemKeys: [FactoryItem.SKIN_PATCH],
      },
      {
        id: 'out-frame',
        direction: CloudFactoryPortDirection.OUTPUT,
        label: 'Skeletal Frame Output',
        itemKeys: [FactoryItem.SKELETAL_FRAME],
      },
    ],
  },
  {
    key: 'smelter-gland',
    kind: FactoryKind.SMELTER,
    icon: '🌿',
    label: 'Endocrine Bloom',
    description: 'Coaxes gland seeds and organ mass into hormonal webs.',
    metadata: { recipeKey: 'glandular_network' },
    ports: [
      {
        id: 'in-gland',
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Gland Seed Intake',
        itemKeys: [FactoryItem.GLAND_SEED],
      },
      {
        id: 'in-organ',
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Organ Mass Intake',
        itemKeys: [FactoryItem.ORGAN_MASS],
      },
      {
        id: 'out-gland',
        direction: CloudFactoryPortDirection.OUTPUT,
        label: 'Glandular Network Output',
        itemKeys: [FactoryItem.GLANDULAR_NETWORK],
      },
    ],
  },
  {
    key: 'constructor-shell',
    kind: FactoryKind.CONSTRUCTOR,
    icon: '🧍',
    label: 'Recruit Constructor',
    description: 'Prints baseline human shells from body systems.',
    metadata: { blueprintKey: 'human_shell' },
    ports: [
      {
        id: 'in-body',
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Body System Intake',
        itemKeys: [FactoryItem.BODY_SYSTEM],
      },
      {
        id: 'out-shell',
        direction: CloudFactoryPortDirection.OUTPUT,
        label: 'Human Shell Output',
        itemKeys: [FactoryItem.HUMAN_SHELL],
      },
    ],
  },
  {
    key: 'constructor-caretaker',
    kind: FactoryKind.CONSTRUCTOR,
    icon: '🤖',
    label: 'Caretaker Constructor',
    description: 'Assembles caretaker drones from weave and frames.',
    metadata: { blueprintKey: 'caretaker_drone' },
    ports: [
      {
        id: 'in-neural',
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Neural Weave Intake',
        itemKeys: [FactoryItem.NEURAL_WEAVE],
      },
      {
        id: 'in-frame',
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Skeletal Frame Intake',
        itemKeys: [FactoryItem.SKELETAL_FRAME],
      },
      {
        id: 'out-caretaker',
        direction: CloudFactoryPortDirection.OUTPUT,
        label: 'Caretaker Drone Output',
        itemKeys: [FactoryItem.CARETAKER_DRONE],
      },
    ],
  },
  {
    key: 'constructor-emissary',
    kind: FactoryKind.CONSTRUCTOR,
    icon: '🕊️',
    label: 'Emissary Constructor',
    description: 'Combines systems, weaves, and glands into emissaries.',
    metadata: { blueprintKey: 'emissary_avatar' },
    ports: [
      {
        id: 'in-body',
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Body System Intake',
        itemKeys: [FactoryItem.BODY_SYSTEM],
      },
      {
        id: 'in-neural',
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Neural Weave Intake',
        itemKeys: [FactoryItem.NEURAL_WEAVE],
      },
      {
        id: 'in-gland',
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Glandular Network Intake',
        itemKeys: [FactoryItem.GLANDULAR_NETWORK],
      },
      {
        id: 'out-emissary',
        direction: CloudFactoryPortDirection.OUTPUT,
        label: 'Emissary Output',
        itemKeys: [FactoryItem.EMISSARY_AVATAR],
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

export function createCloudClusterEditor(options = {}){
  const initialRegistry = ensureRegistry(options.registry ?? getCloudClusterRegistry());
  const state = {
    registry: initialRegistry,
    selectedClusterId: null,
    selectedObjectId: null,
    pendingLink: null,
    kindCounters: new Map(),
    clusterCounter: 1,
  };

  function commit(nextRegistry){
    state.registry = setCloudClusterRegistry(ensureRegistry(nextRegistry));
    refreshSelection();
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
    const registry = state.registry;
    const result = [];
    for(const id of orderedClusterIds(registry)){
      const cluster = registry.byId.get(id);
      if(!cluster) continue;
      result.push({
        id: cluster.id,
        name: cluster.name,
        description: cluster.description,
        objectCount: cluster.objects.size,
        linkCount: cluster.links.size,
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
    if(!nextRegistry.order.includes(clusterId)){
      nextRegistry.order.push(clusterId);
    }
    commit(nextRegistry);
    clearClusterAccumulator(clusterId);
    return result;
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
    return link;
  }

  function cancelLink(){
    state.pendingLink = null;
  }

  function removeLink(linkId){
    const cluster = getSelectedCluster();
    if(!cluster) return false;
    const removed = updateCluster(cluster.id, (draft) => removeClusterLink(draft, linkId));
    return removed;
  }

  function getGraph(clusterId = state.selectedClusterId){
    if(!clusterId || !state.registry.byId.has(clusterId)) return null;
    const cluster = state.registry.byId.get(clusterId);
    ensureCluster(cluster);
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
        ports: object.ports.map((port) => ({
          id: port.id,
          label: port.label,
          direction: port.direction,
          itemKeys: port.itemKeys.slice(),
          capacity: port.capacity,
          metadata: port.metadata,
        })),
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
    const telemetryState = getCloudClusterTelemetry();
    const clusters = [];
    for(const id of orderedClusterIds(state.registry)){
      const cluster = state.registry.byId.get(id);
      if(!cluster) continue;
      const validation = getClusterValidationReport(id) ?? validateClusterRouting(cluster);
      const throughput = getClusterThroughput(id) ?? calculateClusterThroughput(cluster);
      const telemetryEntry = telemetryState?.clusters?.find((entry) => entry.id === id) ?? null;
      const status = telemetryEntry?.status ?? deriveStatusFromIssues(validation?.issues ?? []);
      clusters.push({
        id: cluster.id,
        name: cluster.name,
        description: cluster.description,
        status,
        issueCount: validation?.issues?.length ?? 0,
        issues: validation?.issues ?? [],
        totals: (telemetryEntry?.totals ?? throughput?.totals ?? []).slice(),
      });
    }
    return {
      tick: telemetryState?.tick ?? null,
      clusters,
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
    stepSimulation: advanceSimulation,
  };
}

export default {
  createCloudClusterEditor,
  getCloudClusterPalette,
};
