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
