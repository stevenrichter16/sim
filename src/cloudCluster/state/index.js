import { createCloudClusterRegistry, ensureRegistry } from '../registry.js';

let cloudClusterState = null;

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
  return ensured;
}

export function clearCloudClusterDiagnostics(){
  const state = getCloudClusterState();
  state.validation.clear();
  state.throughput.clear();
  state.telemetry = { tick: 0, clusters: [] };
}
