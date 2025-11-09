import {
  upsertFactoryObject as upsertCloudFactoryObject,
  removeFactoryObject as removeCloudFactoryObject,
  upsertLink as upsertCloudClusterLink,
  removeLink as removeCloudClusterLink,
  serialiseCluster,
} from '../../cloudCluster/domain/cluster.js';
import { updateClusterAccumulatorMembership } from '../../cloudCluster/sim/index.js';
import { ensureRegistry as ensureCloudClusterRegistry } from '../../cloudCluster/registry.js';
import { getCloudClusterRegistry, setCloudClusterRegistry } from '../../cloudCluster/state/index.js';
import { computeClusterIntents, computeAllocationIntents } from '../transform/index.js';
import { CLOUD_CLUSTER_AUTO_LINK_PREFIX } from '../constants.js';
import Ajv2020 from 'ajv/dist/2020.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const contractsSchema = require('../model/contracts.schema.json');
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateDiffBundleSchema = ajv.compile(contractsSchema);
const FACTORY_OWNERSHIP_SCHEMA_VERSION = 'v1';

export function createClusterRuntime({
  factoryKindMeta,
  factoryItemLabel,
  getRecipeInputMap,
  getBioforgeRecipe,
  defaultBioforgeRecipe,
  getConstructorBlueprint,
  defaultConstructorBlueprint,
  FactoryKind,
} = {}){
  function ensureFactoryCloudRegistry(factory){
    const factoryRegistry = ensureCloudClusterRegistry(factory?.cloudClusters);
    const stateRegistry = getCloudClusterRegistry();
    const targetRegistry = stateRegistry;

    if(factoryRegistry !== stateRegistry){
      for(const [id, cluster] of factoryRegistry.byId.entries()){
        targetRegistry.byId.set(id, cluster);
        if(!targetRegistry.order.includes(id)){
          targetRegistry.order.push(id);
        }
      }
      const seen = new Set();
      targetRegistry.order = targetRegistry.order.filter((id) => {
        if(seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    }

    if(factory){
      factory.cloudClusters = targetRegistry;
    }

    setCloudClusterRegistry(targetRegistry);
    return targetRegistry;
  }

  function snapshotRegistry(factory){
    const registry = ensureFactoryCloudRegistry(factory);
    const clustersById = new Map();
    for(const [id, cluster] of registry.byId.entries()){
      clustersById.set(id, serialiseCluster(cluster));
    }
    return { clustersById };
  }

  function synchronizeFactionCluster({ cluster, entries, factory, registry, ownershipInputs }){
    if(!cluster){
      return { diffBundle: null, manualLinkReconciliation: null };
    }
    const clustersById = ownershipInputs?.registrySnapshot?.clustersById;
    const clusterSnapshot = clustersById instanceof Map ? clustersById.get(cluster.id) : serialiseCluster(cluster);

    const intents = computeClusterIntents({
      clusterId: cluster.id,
      entries,
      ownershipInputs,
      clusterSnapshot,
      dependencies: {
        factoryKindMeta,
        factoryItemLabel,
        getRecipeInputMap,
        getBioforgeRecipe,
        defaultBioforgeRecipe,
        getConstructorBlueprint,
        defaultConstructorBlueprint,
        FactoryKind,
      },
    });

    const allocation = computeAllocationIntents({
      clusterId: cluster.id,
      desiredObjects: intents.desiredObjects,
      ownershipInputs,
      clusterSnapshot,
      manualReservations: ownershipInputs?.manualReservations ?? [],
      dependencies: { FactoryKind },
    });

    applySmelterSelections(factory, intents.smelterSelections, getBioforgeRecipe);

    const desiredObjects = intents.desiredObjects instanceof Map ? intents.desiredObjects : new Map();

    const removed = [];
    for(const objectId of Array.from(cluster.objects.keys())){
      if(desiredObjects.has(objectId)) continue;
      const existing = cluster.objects.get(objectId);
      const autoManaged = existing?.metadata?.auto === true;
      if(!autoManaged){
        continue;
      }
      removeCloudFactoryObject(cluster, objectId);
      removed.push(objectId);
    }

    const added = [];
    for(const [objectId, def] of desiredObjects.entries()){
      const existed = cluster.objects.has(objectId);
      upsertCloudFactoryObject(cluster, def);
      if(!existed){
        added.push(objectId);
      }
    }

    if(added.length || removed.length){
      updateClusterAccumulatorMembership(cluster.id, { added, removed });
    }

    const existingAutoLinks = new Map();
    for(const [linkId, link] of cluster.links.entries()){
      const isAuto = link?.metadata?.auto === true || (typeof linkId === 'string' && linkId.startsWith(CLOUD_CLUSTER_AUTO_LINK_PREFIX));
      if(!isAuto) continue;
      const key = makeAutoLinkKey(link);
      existingAutoLinks.set(key, linkId);
    }

    let linksChanged = false;

    const desiredAutoLinks = new Map();
    for(const link of allocation.links ?? []){
      const key = makeAutoLinkKey(link);
      desiredAutoLinks.set(key, link);
    }

    for(const [key, linkId] of existingAutoLinks.entries()){
      if(desiredAutoLinks.has(key)){
        continue;
      }
      removeCloudClusterLink(cluster, linkId);
      linksChanged = true;
    }

    for(const [key, def] of desiredAutoLinks.entries()){
      if(existingAutoLinks.has(key)){
        continue;
      }
      upsertCloudClusterLink(cluster, def);
      linksChanged = true;
    }

    if(registry && (added.length || removed.length || linksChanged)){
      setCloudClusterRegistry(registry);
    }

    const diffBundle = buildDiffBundle({
      cluster,
      previousSnapshot: clusterSnapshot,
      entries,
      manualLinkSummary: intents.manualLinkSummary,
      allocation,
    });

    const manualLinkReconciliation = buildManualLinkReconciliation(intents.manualLinkSummary);

    return { diffBundle, manualLinkReconciliation };
  }

  return {
    ensureFactoryCloudRegistry,
    snapshotRegistry,
    synchronizeFactionCluster,
  };
}

function buildDiffBundle({
  cluster,
  previousSnapshot,
  entries,
  manualLinkSummary,
  allocation,
}){
  const before = previousSnapshot ?? { objects: [], links: [] };
  const after = serialiseCluster(cluster);
  const snapshot = buildOwnershipSnapshot(entries, before);
  const allocationDto = buildAllocationResult(allocation, manualLinkSummary);
  const diff = buildRegistryDiff(before, after, manualLinkSummary);
  const bundle = {
    version: FACTORY_OWNERSHIP_SCHEMA_VERSION,
    snapshot,
    allocation: allocationDto,
    diff,
  };
  assertDiffBundleSchema(bundle);
  return bundle;
}

function buildOwnershipSnapshot(entries = [], clusterSnapshot = {}){
  const nodes = entries
    .filter((entry) => entry?.type === 'node')
    .map(cloneOwnershipEntry);
  const structures = entries
    .filter((entry) => entry?.type === 'structure')
    .map(cloneOwnershipEntry);
  const links = Array.isArray(clusterSnapshot?.links) ? clusterSnapshot.links.map(cloneLink) : [];
  const existingManualLinks = links.filter((link) => isManualLink(link));
  return {
    nodes,
    structures,
    existingLinks: links,
    existingManualLinks,
  };
}

function buildAllocationResult(allocation = {}, manualLinkSummary = {}){
  const links = Array.isArray(allocation.links) ? allocation.links.map(cloneLink) : [];
  const rejectedPorts = Array.isArray(allocation.rejectedPorts)
    ? allocation.rejectedPorts.map(clone)
    : [];
  const auditTrail = Array.isArray(allocation.auditTrail)
    ? allocation.auditTrail.map(clone)
    : [];
  return {
    links,
    rejectedPorts,
    auditTrail,
    reconciliation: buildManualLinkReconciliation(manualLinkSummary),
  };
}

function buildRegistryDiff(before = {}, after = {}, manualLinkSummary = {}){
  const objectDiff = diffById(before?.objects, after?.objects, normaliseClusterObjectDto);
  const linkDiff = diffById(before?.links, after?.links, cloneLink);
  return {
    addedObjects: objectDiff.added,
    removedObjects: objectDiff.removed,
    addedLinks: linkDiff.added,
    removedLinks: linkDiff.removed,
    metadataChanges: [],
    preservedManualLinks: Array.isArray(manualLinkSummary?.preserved)
      ? manualLinkSummary.preserved.map(cloneLink)
      : [],
    droppedManualLinks: Array.isArray(manualLinkSummary?.dropped)
      ? manualLinkSummary.dropped.map(cloneLink)
      : [],
  };
}

function diffById(beforeList = [], afterList = [], transform = clone){
  const beforeMap = new Map();
  for(const item of Array.isArray(beforeList) ? beforeList : []){
    const dto = transform(item);
    if(dto?.id){
      beforeMap.set(dto.id, dto);
    }
  }
  const afterMap = new Map();
  for(const item of Array.isArray(afterList) ? afterList : []){
    const dto = transform(item);
    if(dto?.id){
      afterMap.set(dto.id, dto);
    }
  }
  const added = [];
  const removed = [];
  for(const [id, item] of afterMap.entries()){
    if(!beforeMap.has(id)){
      added.push(item);
    }
  }
  for(const [id, item] of beforeMap.entries()){
    if(!afterMap.has(id)){
      removed.push(item);
    }
  }
  return { added, removed };
}

function buildManualLinkReconciliation(summary = {}){
  return {
    preservedLinks: Array.isArray(summary?.preserved)
      ? summary.preserved.map(cloneLink)
      : [],
    droppedLinks: Array.isArray(summary?.dropped)
      ? summary.dropped.map(cloneLink)
      : [],
    missingTargets: [],
  };
}

function normaliseClusterObjectDto(object){
  if(!object){
    return null;
  }
  return {
    id: object.id,
    kind: object.kind,
    label: object.label ?? '',
    description: object.description ?? '',
    metadata: clone(object.metadata ?? {}),
    ports: Array.isArray(object.ports)
      ? object.ports
        .map(normaliseClusterPortDto)
        .filter(Boolean)
      : [],
  };
}

function normaliseClusterPortDto(port){
  if(!port){
    return null;
  }
  return {
    id: port.id,
    direction: port.direction,
    label: port.label ?? '',
    itemKeys: Array.isArray(port.itemKeys) ? port.itemKeys.map(String) : [],
    metadata: port.metadata ? { ...port.metadata } : undefined,
  };
}

function applySmelterSelections(factory, selections, getBioforgeRecipe){
  if(!factory || !Array.isArray(selections) || !selections.length){
    return;
  }
  if(!(factory.structures instanceof Map)){
    return;
  }
  for(const selection of selections){
    if(!selection || selection.tileIdx == null || !selection.nextRecipeKey){
      continue;
    }
    const structure = factory.structures.get(selection.tileIdx);
    if(!structure){
      continue;
    }
    const recipe = getBioforgeRecipe(selection.nextRecipeKey);
    if(!recipe){
      continue;
    }
    structure.recipe = recipe;
    structure.recipeKey = recipe.key;
    if(Array.isArray(structure.availableRecipeKeys)){
      const idx = structure.availableRecipeKeys.indexOf(recipe.key);
      if(idx >= 0){
        structure.activeRecipeIndex = idx;
      }
    }
  }
}

function makeAutoLinkKey(link){
  if(!link) return '';
  const sourceId = link?.source?.objectId ?? '';
  const sourcePort = link?.source?.portId ?? '';
  const targetId = link?.target?.objectId ?? '';
  const targetPort = link?.target?.portId ?? '';
  const item = link?.metadata?.item ?? '';
  return `${sourceId}:${sourcePort}->${targetId}:${targetPort}:${item}`;
}

function isManualLink(link){
  if(!link){
    return false;
  }
  const isAutoMeta = link?.metadata?.auto === true;
  const hasAutoId = typeof link?.id === 'string' && link.id.startsWith(CLOUD_CLUSTER_AUTO_LINK_PREFIX);
  return !(isAutoMeta || hasAutoId);
}

function cloneOwnershipEntry(entry){
  if(!entry){
    return null;
  }
  const base = clone(entry);
  if(base && base.coords){
    base.coords = { ...base.coords };
  }
  if(base && base.metadata){
    base.metadata = { ...base.metadata };
  }
  return base;
}

function cloneLink(link){
  if(!link){
    return null;
  }
  return {
    id: link.id,
    source: link.source ? { ...link.source } : null,
    target: link.target ? { ...link.target } : null,
    metadata: link.metadata ? { ...link.metadata } : undefined,
  };
}

function clone(value){
  if(value == null){
    return value;
  }
  if(typeof structuredClone === 'function'){
    try {
      return structuredClone(value);
    } catch (error){
      // fall through
    }
  }
  return JSON.parse(JSON.stringify(value));
}

function assertDiffBundleSchema(bundle){
  if(validateDiffBundleSchema(bundle)){
    return;
  }
  const errorMessage = ajv.errorsText(validateDiffBundleSchema.errors, { separator: '\n' });
  throw new Error(`[factoryOwnership] Diff bundle failed schema validation: ${errorMessage}`);
}
