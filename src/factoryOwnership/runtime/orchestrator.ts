import type {
  FactoryOwnershipDiffBundle,
  LinkDTO,
  ManualLinkReconciliationDTO,
  OwnershipEntryDTO,
} from '../model/types.js';
import type {
  FactoryOwnershipRuntimeInputs,
  ManualReservation,
  NodeSnapshot,
  RegistrySnapshot,
  StructureSnapshot,
} from './types.js';

export interface FactoryOwnershipOrchestratorConfig {
  getWorld: () => {
    W: number;
    dominantFaction: ArrayLike<number>;
    controlLevel: ArrayLike<number>;
  };
  factions: Array<{ id: number; key?: string; color?: string }>;
  createCloudCluster: (def: {
    id: string;
    name: string;
    description?: string;
    metadata?: Record<string, unknown>;
    objects?: unknown[];
    links?: unknown[];
  }) => any;
  clusterRuntime: {
    ensureFactoryCloudRegistry: (factory: any) => any;
    snapshotRegistry: (factory: any) => RegistrySnapshot;
    synchronizeFactionCluster: (options: {
      cluster: any;
      entries: OwnershipEntryDTO[];
      factory: any;
      registry: any;
      ownershipInputs: FactoryOwnershipRuntimeInputs;
    }) => {
      diffBundle: FactoryOwnershipDiffBundle | null;
      manualLinkReconciliation: ManualLinkReconciliationDTO | null;
    };
  };
}

export function createFactoryOwnershipOrchestrator({
  getWorld,
  factions,
  createCloudCluster,
  clusterRuntime,
}: FactoryOwnershipOrchestratorConfig){
  const {
    ensureFactoryCloudRegistry,
    snapshotRegistry,
    synchronizeFactionCluster,
  } = clusterRuntime;

  /**
   * Capture immutable ownership inputs from the live factory/world.
   * @param {any} factory
   * @returns {FactoryOwnershipSnapshot & {
   *   nodesByTile: Map<number, { tileIdx: number, resource: string | null }>;
   *   structuresByTile: Map<number, {
   *     tileIdx: number;
   *     kind: string | null;
   *     orientation: string | null;
   *     recipeKey: string | null;
   *     availableRecipeKeys: string[] | null;
   *     activeRecipeIndex: number | null;
   *     blueprintKey: string | null;
   *     availableBlueprintKeys: string[] | null;
   *   }>;
   *   registrySnapshot: { clustersById: Map<string, unknown> };
   *   manualReservations: Array<Record<string, unknown>>;
   * }}
   */
  function captureOwnershipInputs(factory: any): FactoryOwnershipRuntimeInputs{
    const world = getWorld();
    const worldSnapshot = {
      width: Number.isFinite(world?.W) ? world.W : 0,
      dominantFaction: world?.dominantFaction ?? [],
      controlLevel: world?.controlLevel ?? [],
    };

    const nodes: NodeSnapshot[] = [];
    const nodesByTile = new Map<number, NodeSnapshot>();
    if(factory?.nodes instanceof Map){
      for(const [key, node] of factory.nodes.entries()){
        const tileIdx = Number(key);
        if(!Number.isFinite(tileIdx) || tileIdx < 0) continue;
        const nodeSnapshot: NodeSnapshot = {
          tileIdx,
          resource: node?.resource ?? null,
        };
        nodes.push(nodeSnapshot);
        nodesByTile.set(tileIdx, nodeSnapshot);
      }
    }

    const structures: StructureSnapshot[] = [];
    const structuresByTile = new Map<number, StructureSnapshot>();
    if(factory?.structures instanceof Map){
      for(const [key, structure] of factory.structures.entries()){
        const tileIdx = Number(key);
        if(!Number.isFinite(tileIdx) || tileIdx < 0) continue;
        const structureSnapshot: StructureSnapshot = {
          tileIdx,
          kind: structure?.kind ?? null,
          orientation: structure?.orientation ?? null,
          recipeKey: structure?.recipeKey ?? null,
          availableRecipeKeys: Array.isArray(structure?.availableRecipeKeys) ? structure.availableRecipeKeys.slice() : null,
          activeRecipeIndex: typeof structure?.activeRecipeIndex === 'number' ? structure.activeRecipeIndex : null,
          blueprintKey: structure?.blueprintKey ?? null,
          availableBlueprintKeys: Array.isArray(structure?.availableBlueprintKeys) ? structure.availableBlueprintKeys.slice() : null,
        };
        structures.push(structureSnapshot);
        structuresByTile.set(tileIdx, structureSnapshot);
      }
    }

    return {
      world: worldSnapshot,
      nodes,
      structures,
      nodesByTile,
      structuresByTile,
      registrySnapshot: snapshotRegistry(factory),
      manualReservations: captureManualReservations(factory),
    };
  }

  /**
   * @param {any} factory
   * @returns {Array<Record<string, unknown>>}
   */
  function captureManualReservations(factory: any): ManualReservation[]{
    if(Array.isArray(factory?.manualReservations)){
      return factory.manualReservations.map((reservation: ManualReservation) => ({ ...reservation }));
    }
    return [];
  }

  /**
   * @param {number} factionId
   */
  function clusterIdForFaction(factionId: number){
    return `faction-${factionId}-cloud`;
  }

  /**
   * @param {{ id: number, key?: string }} faction
   */
  function clusterLabelForFaction(faction: { id: number; key?: string }){
    if(!faction) return 'Faction Cloud';
    const key = faction.key ?? faction.id ?? '?';
    return `Faction ${key} Cloud`;
  }

  /**
   * @param {any} factory
   * @param {{ id: number, key?: string }} faction
   * @param {any} [registry=ensureFactoryCloudRegistry(factory)]
   */
  function ensureFactionCloudCluster(factory: any, faction: { id: number; key?: string }, registry = ensureFactoryCloudRegistry(factory)){
    const clusterId = clusterIdForFaction(faction.id);
    let cluster = registry.byId.get(clusterId);
    if(!cluster){
      cluster = createCloudCluster({
        id: clusterId,
        name: clusterLabelForFaction(faction),
        description: `Autogenerated cluster for faction ${faction.key ?? faction.id}.`,
        metadata: {
          factionId: faction.id,
          factionKey: faction.key ?? null,
          auto: true,
        },
        objects: [],
        links: [],
      });
      registry.byId.set(clusterId, cluster);
    }
    if(!registry.order.includes(clusterId)){
      registry.order.push(clusterId);
    }
    return cluster;
  }

  /**
   * @param {any} factory
   * @param {number} factionId
   * @param {any} [registry=ensureFactoryCloudRegistry(factory)]
   */
  function removeFactionCloudCluster(factory: any, factionId: number, registry = ensureFactoryCloudRegistry(factory)){
    const clusterId = clusterIdForFaction(factionId);
    if(!registry.byId.delete(clusterId)){
      return false;
    }
    const orderIndex = registry.order.indexOf(clusterId);
    if(orderIndex >= 0){
      registry.order.splice(orderIndex, 1);
    }
    return true;
  }

  /**
   * @param {any} factory
   * @param {Map<number, OwnershipEntryDTO[]>} ownershipByFaction
   * @param {ReturnType<typeof captureOwnershipInputs>} ownershipInputs
   * @returns {Array<{ factionId: number, clusterId: string, bundle: FactoryOwnershipDiffBundle }>}
   */
  function syncFactionCloudClusters(
    factory: any,
    ownershipByFaction: Map<number, OwnershipEntryDTO[]> | undefined,
    ownershipInputs: FactoryOwnershipRuntimeInputs,
  ){
    if(!factory) return [];
    const registry = ensureFactoryCloudRegistry(factory);
    const factionOwnership = ownershipByFaction instanceof Map
      ? ownershipByFaction
      : factory.ownershipByFaction instanceof Map
        ? factory.ownershipByFaction
        : new Map<number, OwnershipEntryDTO[]>();
    const bundles: Array<{ factionId: number; clusterId: string; bundle: FactoryOwnershipDiffBundle }> = [];
    const manualLinkReconciliation = new Map<string, ManualLinkReconciliationDTO>();
    const manualLinkWarnings: Array<{ factionId: number; clusterId: string; droppedLinks: LinkDTO[] }> = [];
    for(const faction of factions){
      const clusterId = clusterIdForFaction(faction.id);
      const entries = factionOwnership.get(faction.id) ?? [];
      let cluster = registry.byId.get(clusterId);
      if(entries.length > 0){
        cluster = ensureFactionCloudCluster(factory, faction, registry);
        const result = synchronizeFactionCluster({
          cluster,
          entries,
          factory,
          registry,
          ownershipInputs,
        });
        appendClusterResults({
          result,
          factionId: faction.id,
          clusterId,
          bundles,
          manualLinkReconciliation,
          manualLinkWarnings,
        });
        continue;
      }
      if(!cluster) continue;
      const result = synchronizeFactionCluster({
        cluster,
        entries: [],
        factory,
        registry,
        ownershipInputs,
      });
      appendClusterResults({
        result,
        factionId: faction.id,
        clusterId,
        bundles,
        manualLinkReconciliation,
        manualLinkWarnings,
      });
      const hasObjects = (cluster.objects?.size ?? 0) > 0;
      const hasLinks = (cluster.links?.size ?? 0) > 0;
      if(!hasObjects && !hasLinks){
        removeFactionCloudCluster(factory, faction.id, registry);
      }
    }
    factory.manualLinkReconciliation = manualLinkReconciliation;
    factory.manualLinkWarnings = manualLinkWarnings;
    if(Array.isArray(manualLinkWarnings) && manualLinkWarnings.length){
      factory.manualLinkWarningsLog = manualLinkWarnings;
    } else if(!Array.isArray(factory.manualLinkWarningsLog)){
      factory.manualLinkWarningsLog = [];
    }
    return bundles;
  }

  /**
   * @param {{
   *   result: {
   *     diffBundle: FactoryOwnershipDiffBundle | null;
   *     manualLinkReconciliation: ManualLinkReconciliationDTO | null;
   *   };
   *   factionId: number;
   *   clusterId: string;
   *   bundles: Array<{ factionId: number, clusterId: string, bundle: FactoryOwnershipDiffBundle }>;
   *   manualLinkReconciliation: Map<string, ManualLinkReconciliationDTO>;
   *   manualLinkWarnings: Array<{ factionId: number; clusterId: string; droppedLinks: import('../model/types').LinkDTO[] }>;
   * }} options
   */
  function appendClusterResults({
    result,
    factionId,
    clusterId,
    bundles,
    manualLinkReconciliation,
    manualLinkWarnings,
  }: {
    result: {
      diffBundle: FactoryOwnershipDiffBundle | null;
      manualLinkReconciliation: ManualLinkReconciliationDTO | null;
    };
    factionId: number;
    clusterId: string;
    bundles: Array<{ factionId: number; clusterId: string; bundle: FactoryOwnershipDiffBundle }>;
    manualLinkReconciliation: Map<string, ManualLinkReconciliationDTO>;
    manualLinkWarnings: Array<{ factionId: number; clusterId: string; droppedLinks: any[] }>;
  }){
    if(result?.diffBundle){
      bundles.push({
        factionId,
        clusterId,
        bundle: /** @type {FactoryOwnershipDiffBundle} */ (result.diffBundle),
      });
    }
    if(result?.manualLinkReconciliation){
      manualLinkReconciliation.set(clusterId, result.manualLinkReconciliation);
      const dropped = result.manualLinkReconciliation.droppedLinks ?? [];
      if(dropped.length){
        manualLinkWarnings.push({
          factionId,
          clusterId,
          droppedLinks: dropped,
        });
      }
    }
  }

  /**
   * @param {OwnershipEntryDTO} entry
   * @returns {OwnershipEntryDTO | null}
   */
  function cloneOwnershipEntry(entry: OwnershipEntryDTO | null){
    if(!entry) return null;
    const clone: OwnershipEntryDTO = {
      id: entry.id,
      tileIdx: entry.tileIdx,
      type: entry.type,
      kind: entry.kind,
      control: entry.control,
      factionId: entry.factionId,
      dominantFactionId: entry.dominantFactionId ?? null,
      coords: entry.coords ? { ...entry.coords } : { x: 0, y: 0 },
      metadata: entry.metadata ? { ...entry.metadata } : undefined,
    };
    if(entry.resource != null){
      clone.resource = entry.resource;
    }
    if(entry.orientation != null){
      clone.orientation = entry.orientation;
    }
    return clone;
  }

  return {
    captureOwnershipInputs,
    ensureFactoryCloudRegistry,
    ensureFactionCloudCluster,
    removeFactionCloudCluster,
    syncFactionCloudClusters,
    cloneOwnershipEntry,
  };
}
