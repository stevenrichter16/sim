import { world } from './state.js';
import { FACTIONS } from './factions.js';
import { createCloudClusterRegistry, ensureRegistry as ensureCloudClusterRegistry } from './cloudCluster/registry.js';
import { createCluster as createCloudCluster } from './cloudCluster/domain/cluster.js';
import { computeOwnershipEntries } from '../dist/factoryOwnership/transform/index.js';
import { createClusterRuntime } from '../dist/factoryOwnership/runtime/clusterRuntime.js';
import { createFactoryOwnershipOrchestrator } from '../dist/factoryOwnership/runtime/orchestrator.js';

export function createFactoryOwnershipManager({
  ensureFactoryState,
  factoryKindMeta,
  factoryItemLabel,
  getRecipeInputMap,
  getBioforgeRecipe,
  defaultBioforgeRecipe,
  getConstructorBlueprint,
  defaultConstructorBlueprint,
  FactoryKind,
}){
  const clusterRuntime = createClusterRuntime({
    factoryKindMeta,
    factoryItemLabel,
    getRecipeInputMap,
    getBioforgeRecipe,
    defaultBioforgeRecipe,
    getConstructorBlueprint,
    defaultConstructorBlueprint,
    FactoryKind,
  });

  const {
    captureOwnershipInputs,
    ensureFactoryCloudRegistry,
    syncFactionCloudClusters,
    cloneOwnershipEntry,
  } = createFactoryOwnershipOrchestrator({
    getWorld: () => world,
    factions: FACTIONS,
    createCloudCluster,
    clusterRuntime,
  });

  function refreshFactoryOwnership(){
    const factory = ensureFactoryState();
    const snapshot = captureOwnershipInputs(factory);
    const { entries, byFaction, unassigned } = computeOwnershipEntries(snapshot);

    factory.ownershipRecords = entries;
    factory.ownershipByFaction = byFaction;
    factory.unassignedOwnership = unassigned;
    factory.ownershipDiffBundles = syncFactionCloudClusters(factory, byFaction, snapshot);
    return factory.ownershipDiffBundles;
  }

  function getFactoryOwnership(){
    refreshFactoryOwnership();
    const factory = ensureFactoryState();
    const byFactionMap = factory.ownershipByFaction instanceof Map ? factory.ownershipByFaction : new Map();
    const allEntries = Array.isArray(factory.ownershipRecords) ? factory.ownershipRecords : [];
    const unassigned = Array.isArray(factory.unassignedOwnership) ? factory.unassignedOwnership : [];
    const manualLinkWarnings = Array.isArray(factory.manualLinkWarningsLog)
      ? factory.manualLinkWarningsLog
      : Array.isArray(factory.manualLinkWarnings)
        ? factory.manualLinkWarnings
        : [];
    const manualLinkReconciliation = factory.manualLinkReconciliation instanceof Map
      ? Array.from(factory.manualLinkReconciliation.entries(), ([clusterId, reconciliation]) => ({
        clusterId,
        reconciliation,
      }))
      : [];
    const byFaction = FACTIONS.map((faction) => ({
      factionId: faction.id,
      factionKey: faction.key,
      color: faction.color,
      objects: (byFactionMap.get(faction.id) ?? []).map(cloneOwnershipEntry).filter(Boolean),
    }));
    return {
      byFaction,
      unassigned: unassigned.map(cloneOwnershipEntry).filter(Boolean),
      all: allEntries.map(cloneOwnershipEntry).filter(Boolean),
      diffBundles: Array.isArray(factory.ownershipDiffBundles) ? factory.ownershipDiffBundles : [],
      manualLinkWarnings,
      manualLinkReconciliation,
    };
  }

  return {
    refreshFactoryOwnership,
    getFactoryOwnership,
    ensureFactoryCloudRegistry,
  };
}

export function initialiseFactoryOwnership(factory){
  const registry = ensureCloudClusterRegistry(factory?.cloudClusters);
  if(factory){
    factory.cloudClusters = registry ?? createCloudClusterRegistry();
  }
  return registry;
}
