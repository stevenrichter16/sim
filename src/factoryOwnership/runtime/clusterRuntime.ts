/// <reference path="../types/external-modules.d.ts" />

import {
  upsertFactoryObject as upsertCloudFactoryObject,
  removeFactoryObject as removeCloudFactoryObject,
  upsertLink as upsertCloudClusterLink,
  removeLink as removeCloudClusterLink,
  serialiseCluster,
} from '../../../src/cloudCluster/domain/cluster.js';
import { updateClusterAccumulatorMembership } from '../../../src/cloudCluster/sim/index.js';
import { ensureRegistry as ensureCloudClusterRegistry } from '../../../src/cloudCluster/registry.js';
import { getCloudClusterRegistry, setCloudClusterRegistry } from '../../../src/cloudCluster/state/index.js';
import { computeClusterIntents, computeAllocationIntents } from '../transform/index.js';
import { CLOUD_CLUSTER_AUTO_LINK_PREFIX } from '../constants.js';
import type { ErrorObject, ErrorsTextOptions, ValidateFunction } from 'ajv';
import { factoryOwnershipSchemas } from '../model/index.js';
import type {
  AllocationResult,
  ClusterObjectDTO,
  FactoryNodeDTO,
  FactoryOwnershipDiffBundle,
  FactionOwnershipSnapshot,
  LinkDTO,
  LinkPortDTO,
  ManualLinkReconciliationDTO,
  OwnershipEntryDTO,
  RegistryDiffV1,
  StructureDTO,
} from '../model/types.js';
import type { FactoryOwnershipRuntimeInputs, RegistrySnapshot } from './types.js';

const contractsSchema = factoryOwnershipSchemas.contracts;
type DiffBundleValidator = ValidateFunction<FactoryOwnershipDiffBundle>;
type AjvErrorText = (errors?: ErrorObject[] | null, options?: ErrorsTextOptions) => string;

const isNodeEnvironment = typeof process !== 'undefined' && process?.release?.name === 'node';

let validateDiffBundleSchema: DiffBundleValidator | null = null;
let ajvErrorsText: AjvErrorText | null = null;

if(isNodeEnvironment){
  void import('ajv/dist/2020.js')
    .then((AjvModule) => {
      const Ajv2020Ctor = (AjvModule.default ?? AjvModule) as typeof import('ajv/dist/2020.js').default;
      const ajvInstance = new Ajv2020Ctor({ allErrors: true, strict: false });
      validateDiffBundleSchema = ajvInstance.compile(contractsSchema) as DiffBundleValidator;
      ajvErrorsText = ajvInstance.errorsText.bind(ajvInstance) as AjvErrorText;
    })
    .catch((error) => {
      console.warn('[factoryOwnership] Failed to initialise Ajv schema validation.', error);
    });
}

interface CloudClusterInstance {
  id: string;
  objects: Map<string, any>;
  links: Map<string, any>;
  metadata?: Record<string, unknown>;
}

interface CloudClusterRegistry {
  byId: Map<string, CloudClusterInstance>;
  order: string[];
}

interface SmelterSelection {
  tileIdx: number;
  nextRecipeKey: string | null;
}

interface ManualLinkSummary {
  preserved?: LinkDTO[];
  dropped?: LinkDTO[];
}

interface SynchronizeFactionClusterArgs {
  cluster: CloudClusterInstance | null;
  entries: OwnershipEntryDTO[];
  factory: any;
  registry: CloudClusterRegistry;
  ownershipInputs: FactoryOwnershipRuntimeInputs;
}

interface ClusterIntentResult {
  desiredObjects: Map<string, any>;
  desiredAutoLinks?: Map<string, any>;
  smelterSelections: SmelterSelection[];
  manualLinkSummary: ManualLinkSummary;
}

type AllocationIntentResult = Pick<AllocationResult, 'links' | 'rejectedPorts' | 'auditTrail'>;

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
}: any = {}){
  function ensureFactoryCloudRegistry(factory: any): CloudClusterRegistry{
    const factoryRegistry = ensureCloudClusterRegistry(factory?.cloudClusters) as CloudClusterRegistry;
    const stateRegistry = getCloudClusterRegistry() as CloudClusterRegistry;
    const targetRegistry: CloudClusterRegistry = stateRegistry;

    if(factoryRegistry !== stateRegistry){
      for(const [id, cluster] of factoryRegistry.byId.entries()){
        targetRegistry.byId.set(id, cluster);
        if(!targetRegistry.order.includes(id)){
          targetRegistry.order.push(id);
        }
      }
      const seen = new Set<string>();
      targetRegistry.order = targetRegistry.order.filter((id: string) => {
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

  function snapshotRegistry(factory: any): RegistrySnapshot{
    const registry = ensureFactoryCloudRegistry(factory);
    const clustersById = new Map<string, ReturnType<typeof serialiseCluster>>();
    for(const [id, cluster] of registry.byId.entries()){
      clustersById.set(id, serialiseCluster(cluster));
    }
    return { clustersById };
  }

  function synchronizeFactionCluster({
    cluster,
    entries,
    factory,
    registry,
    ownershipInputs,
  }: SynchronizeFactionClusterArgs){
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
    }) as ClusterIntentResult;

    const allocation = computeAllocationIntents({
      clusterId: cluster.id,
      desiredObjects: intents.desiredObjects,
      ownershipInputs,
      clusterSnapshot,
      manualReservations: ownershipInputs?.manualReservations ?? [],
      dependencies: { FactoryKind },
    }) as AllocationIntentResult;

    applySmelterSelections(factory, intents.smelterSelections, getBioforgeRecipe);

    const desiredObjects = intents.desiredObjects instanceof Map ? intents.desiredObjects : new Map<string, any>();

    const removed: string[] = [];
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

    const added: string[] = [];
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

    const existingAutoLinks = new Map<string, string>();
    for(const [linkId, link] of cluster.links.entries()){
      const isAuto = link?.metadata?.auto === true || (typeof linkId === 'string' && linkId.startsWith(CLOUD_CLUSTER_AUTO_LINK_PREFIX));
      if(!isAuto) continue;
      const key = makeAutoLinkKey(link);
      existingAutoLinks.set(key, linkId);
    }

    let linksChanged = false;

    const desiredAutoLinks = new Map<string, LinkDTO>();
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
}: {
  cluster: CloudClusterInstance;
  previousSnapshot: Record<string, unknown> | null | undefined;
  entries: OwnershipEntryDTO[];
  manualLinkSummary: ManualLinkSummary;
  allocation: AllocationIntentResult;
}): FactoryOwnershipDiffBundle{
  const before = previousSnapshot ?? { objects: [], links: [] };
  const after = serialiseCluster(cluster);
  const snapshot = buildOwnershipSnapshot(entries, before);
  const allocationDto = buildAllocationResult(allocation, manualLinkSummary);
  const diff = buildRegistryDiff(before, after, manualLinkSummary);
  const bundle: FactoryOwnershipDiffBundle = {
    version: FACTORY_OWNERSHIP_SCHEMA_VERSION,
    snapshot,
    allocation: allocationDto,
    diff,
  };
  assertDiffBundleSchema(bundle);
  return bundle;
}

function buildOwnershipSnapshot(
  entries: OwnershipEntryDTO[] = [],
  clusterSnapshot: Record<string, unknown> | null = null,
): FactionOwnershipSnapshot{
  const nodes = entries
    .filter((entry) => entry?.type === 'node')
    .map(cloneOwnershipEntry)
    .filter(isFactoryNodeEntry);
  const structures = entries
    .filter((entry) => entry?.type === 'structure')
    .map(cloneOwnershipEntry)
    .filter(isStructureEntry);
  const links = Array.isArray(clusterSnapshot?.links)
    ? (clusterSnapshot.links.map(cloneLink).filter(Boolean) as LinkDTO[])
    : [];
  const existingManualLinks = links.filter((link) => isManualLink(link));
  return {
    nodes,
    structures,
    existingLinks: links,
    existingManualLinks,
  };
}

function buildAllocationResult(
  allocation: AllocationIntentResult = { links: [], rejectedPorts: [], auditTrail: [] },
  manualLinkSummary: ManualLinkSummary = {},
): AllocationResult{
  const links = Array.isArray(allocation.links)
    ? (allocation.links.map(cloneLink).filter(Boolean) as LinkDTO[])
    : [];
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

function buildRegistryDiff(
  before: Record<string, unknown> = {},
  after: Record<string, unknown> = {},
  manualLinkSummary: ManualLinkSummary = {},
): RegistryDiffV1{
  const beforeObjects = Array.isArray(before?.objects) ? (before.objects as Record<string, any>[]) : [];
  const afterObjects = Array.isArray(after?.objects) ? (after.objects as Record<string, any>[]) : [];
  const objectDiff = diffById(beforeObjects, afterObjects, normaliseClusterObjectDto);
  const beforeLinks = Array.isArray(before?.links) ? (before.links as Record<string, any>[]) : [];
  const afterLinks = Array.isArray(after?.links) ? (after.links as Record<string, any>[]) : [];
  const linkDiff = diffById(beforeLinks, afterLinks, cloneLink);
  return {
    addedObjects: objectDiff.added as ClusterObjectDTO[],
    removedObjects: objectDiff.removed as ClusterObjectDTO[],
    addedLinks: linkDiff.added as LinkDTO[],
    removedLinks: linkDiff.removed as LinkDTO[],
    metadataChanges: [],
    preservedManualLinks: Array.isArray(manualLinkSummary?.preserved)
      ? (manualLinkSummary.preserved.map(cloneLink).filter(Boolean) as LinkDTO[])
      : [],
    droppedManualLinks: Array.isArray(manualLinkSummary?.dropped)
      ? (manualLinkSummary.dropped.map(cloneLink).filter(Boolean) as LinkDTO[])
      : [],
  };
}

function diffById(
  beforeList: Array<Record<string, any>> = [],
  afterList: Array<Record<string, any>> = [],
  transform: (value: unknown) => Record<string, any> | null = (value) => clone(value as Record<string, any>),
){
  const beforeMap = new Map<string, Record<string, any>>();
  for(const item of beforeList){
    const dto = transform(item);
    if(dto?.id){
      beforeMap.set(String(dto.id), dto);
    }
  }
  const afterMap = new Map<string, Record<string, any>>();
  for(const item of afterList){
    const dto = transform(item);
    if(dto?.id){
      afterMap.set(String(dto.id), dto);
    }
  }
  const added: Record<string, any>[] = [];
  const removed: Record<string, any>[] = [];
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

function buildManualLinkReconciliation(summary: ManualLinkSummary = {}): ManualLinkReconciliationDTO{
  return {
    preservedLinks: Array.isArray(summary?.preserved)
      ? (summary.preserved.map(cloneLink).filter(Boolean) as LinkDTO[])
      : [],
    droppedLinks: Array.isArray(summary?.dropped)
      ? (summary.dropped.map(cloneLink).filter(Boolean) as LinkDTO[])
      : [],
    missingTargets: [],
  };
}

function normaliseClusterObjectDto(object: any): ClusterObjectDTO | null{
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
      ? (object.ports
        .map(normaliseClusterPortDto)
        .filter(Boolean) as LinkPortDTO[])
      : [],
  };
}

function normaliseClusterPortDto(port: any): LinkPortDTO | null{
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

function applySmelterSelections(
  factory: any,
  selections: SmelterSelection[] = [],
  getBioforgeRecipe?: (key: string) => any,
){
  if(!factory || !Array.isArray(selections) || !selections.length || typeof getBioforgeRecipe !== 'function'){
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

function makeAutoLinkKey(link: LinkDTO | null){
  if(!link) return '';
  const sourceId = link?.source?.objectId ?? '';
  const sourcePort = link?.source?.portId ?? '';
  const targetId = link?.target?.objectId ?? '';
  const targetPort = link?.target?.portId ?? '';
  const item = (link?.metadata as { item?: string } | undefined)?.item ?? '';
  return `${sourceId}:${sourcePort}->${targetId}:${targetPort}:${item}`;
}

function isManualLink(link: LinkDTO | null){
  if(!link){
    return false;
  }
  const metadata = link?.metadata as { auto?: boolean } | undefined;
  const isAutoMeta = metadata?.auto === true;
  const hasAutoId = typeof link?.id === 'string' && link.id.startsWith(CLOUD_CLUSTER_AUTO_LINK_PREFIX);
  return !(isAutoMeta || hasAutoId);
}

function cloneOwnershipEntry(entry: OwnershipEntryDTO | null): OwnershipEntryDTO | null{
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

function cloneLink(link: unknown): LinkDTO | null{
  if(!link || typeof link !== 'object'){
    return null;
  }
  const dto = link as LinkDTO;
  return {
    id: dto.id,
    source: dto.source ? { ...dto.source } : { objectId: '', portId: '' },
    target: dto.target ? { ...dto.target } : { objectId: '', portId: '' },
    metadata: dto.metadata ? { ...dto.metadata } : undefined,
  };
}

function isFactoryNodeEntry(entry: OwnershipEntryDTO | null): entry is FactoryNodeDTO{
  return entry?.type === 'node';
}

function isStructureEntry(entry: OwnershipEntryDTO | null): entry is StructureDTO{
  return entry?.type === 'structure';
}

function clone<T>(value: T): T{
  if(value == null){
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertDiffBundleSchema(bundle: FactoryOwnershipDiffBundle){
  if(!validateDiffBundleSchema){
    return;
  }
  if(validateDiffBundleSchema(bundle)){
    return;
  }
  const errors = validateDiffBundleSchema.errors;
  const errorMessage = ajvErrorsText
    ? ajvErrorsText(errors, { separator: '\n' })
    : 'Schema validation failed but Ajv diagnostics are unavailable.';
  throw new Error(`[factoryOwnership] Diff bundle failed schema validation: ${errorMessage}`);
}
