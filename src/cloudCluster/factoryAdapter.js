import { ensureRegistry } from './registry.js';
import { hydrateRegistryFromPayload, serialiseCloudClusters } from './serialization.js';

export function getFactoryCloudRegistry(factoryState){
  if(!factoryState || typeof factoryState !== 'object'){
    return ensureRegistry();
  }
  const registry = ensureRegistry(factoryState.cloudClusters);
  factoryState.cloudClusters = registry;
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
