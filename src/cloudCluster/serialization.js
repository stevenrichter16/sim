import { createCluster, isCluster, serialiseCluster } from './domain/cluster.js';
import { clearRegistry, createCloudClusterRegistry, ensureRegistry } from './registry.js';

export function deserialiseCloudClusters(payload){
  const registry = createCloudClusterRegistry();
  if(!Array.isArray(payload)){
    return registry;
  }
  for(const entry of payload){
    try {
      const cluster = createCluster(entry);
      registry.byId.set(cluster.id, cluster);
      if(!registry.order.includes(cluster.id)){
        registry.order.push(cluster.id);
      }
    } catch (error){
      // Ignore invalid payload entries.
    }
  }
  return registry;
}

export function serialiseCloudClusters(registry){
  const source = ensureRegistry(registry);
  const output = [];
  if(source.order.length > 0){
    const seen = new Set();
    for(const id of source.order){
      if(seen.has(id)){
        continue;
      }
      seen.add(id);
      const cluster = source.byId.get(id);
      if(cluster && isCluster(cluster)){
        output.push(serialiseCluster(cluster));
      }
    }
    return output;
  }
  for(const cluster of source.byId.values()){
    if(isCluster(cluster)){
      output.push(serialiseCluster(cluster));
    }
  }
  return output;
}

export function hydrateRegistryFromPayload(registry, payload){
  const target = clearRegistry(registry);
  if(!Array.isArray(payload)){
    return target;
  }
  for(const entry of payload){
    try {
      const cluster = createCluster(entry);
      target.byId.set(cluster.id, cluster);
      if(!target.order.includes(cluster.id)){
        target.order.push(cluster.id);
      }
    } catch (error){
      // Ignore invalid payload entries.
    }
  }
  return target;
}
