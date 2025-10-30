import { CLOUD_CLUSTER_PRESETS } from '../../data/cloudClusters/index.js';
import { ensureRegistry } from './registry.js';
import { hydrateRegistryFromPayload, serialiseCloudClusters } from './serialization.js';
import { setCloudClusterRegistry } from './state/index.js';

export function getFactoryCloudRegistry(factoryState){
  if(!factoryState || typeof factoryState !== 'object'){
    const registry = ensureRegistry();
    setCloudClusterRegistry(registry);
    return registry;
  }
  const registry = ensureRegistry(factoryState.cloudClusters);
  factoryState.cloudClusters = registry;
  setCloudClusterRegistry(registry);
  return registry;
}

export function loadCloudClustersIntoFactory(factoryState, payload){
  const registry = getFactoryCloudRegistry(factoryState);
  hydrateRegistryFromPayload(registry, payload);
  return registry;
}

export function exportCloudClustersFromFactory(factoryState){
  const registry = getFactoryCloudRegistry(factoryState);
  return serialiseCloudClusters(registry);
}

export function seedFactoryCloudClusters(factoryState, presets = CLOUD_CLUSTER_PRESETS){
  const registry = getFactoryCloudRegistry(factoryState);
  if((registry.byId?.size ?? 0) > 0 || (registry.order?.length ?? 0) > 0){
    return registry;
  }
  hydrateRegistryFromPayload(registry, presets);
  return registry;
}
