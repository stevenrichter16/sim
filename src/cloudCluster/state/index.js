import { createCloudClusterRegistry, ensureRegistry } from '../registry.js';
import { world } from '../../state.js';

let cloudClusterState = null;
const registryListeners = new Set();

function notifyRegistryListeners(event = {}){
  if(registryListeners.size === 0){
    return;
  }
  for(const listener of Array.from(registryListeners)){
    try {
      listener(event);
    } catch (error){
      // Swallow listener errors to avoid breaking upstream flows.
      if(typeof console !== 'undefined' && console.error){
        console.error('Cloud cluster registry listener failed', error);
      }
    }
  }
}

export function createCloudClusterState(){
  return {
    registry: createCloudClusterRegistry(),
    validation: new Map(),
    throughput: new Map(),
    telemetry: { tick: 0, clusters: [] },
    accumulators: new Map(),
  };
}

export function getCloudClusterState(){
  if(!cloudClusterState){
    cloudClusterState = createCloudClusterState();
  }
  return cloudClusterState;
}

export function resetCloudClusterState(){
  cloudClusterState = createCloudClusterState();
  return cloudClusterState;
}

export function getCloudClusterRegistry(){
  const state = getCloudClusterState();
  state.registry = ensureRegistry(state.registry);
  return state.registry;
}

export function setCloudClusterRegistry(registry){
  const ensured = ensureRegistry(registry);
  const state = getCloudClusterState();
  state.registry = ensured;
  if(world?.factory){
    world.factory.cloudClusters = ensured;
  }
  notifyRegistryListeners({ registry: ensured });
  return ensured;
}

export function clearCloudClusterDiagnostics(){
  const state = getCloudClusterState();
  state.validation.clear();
  state.throughput.clear();
  state.telemetry = { tick: 0, clusters: [] };
}

export function addCloudClusterRegistryListener(listener){
  if(typeof listener !== 'function'){
    return () => {};
  }
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}
