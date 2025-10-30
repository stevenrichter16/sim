export function createCloudClusterRegistry(){
  return {
    version: 1,
    byId: new Map(),
    order: [],
  };
}

export function ensureRegistry(registry){
  if(registry && registry.byId instanceof Map){
    if(!Array.isArray(registry.order)){
      registry.order = [];
    }
    if(typeof registry.version !== 'number'){
      registry.version = 1;
    }
    return registry;
  }
  return createCloudClusterRegistry();
}

export function clearRegistry(registry){
  const target = ensureRegistry(registry);
  target.byId.clear();
  target.order.length = 0;
  return target;
}
