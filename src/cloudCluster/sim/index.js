import {
  FactoryKind,
  FactoryItem,
  getBioforgeRecipeDefinition,
  getConstructorBlueprintDefinition,
  getDefaultBioforgeRecipeDefinition,
  getDefaultConstructorBlueprintDefinition,
  getMinerExtractionRate,
  getBeltBaseSpeed,
} from '../../factory.js';
import { CloudFactoryPortDirection } from '../domain/factoryObject.js';
import { isCluster } from '../domain/cluster.js';
import { ensureRegistry } from '../registry.js';
import { getCloudClusterState } from '../state/index.js';

const RATE_EPSILON = 1e-6;

function toArray(value){
  if(value == null) return [];
  return Array.from(value);
}

function buildAdjacency(cluster){
  const adjacency = new Map();
  for(const object of cluster.objects.values()){
    adjacency.set(object.id, new Set());
  }
  for(const link of cluster.links.values()){
    const sourceId = link?.source?.objectId;
    const targetId = link?.target?.objectId;
    if(!sourceId || !targetId) continue;
    if(!adjacency.has(sourceId)){
      adjacency.set(sourceId, new Set());
    }
    adjacency.get(sourceId).add(targetId);
    if(!adjacency.has(targetId)){
      adjacency.set(targetId, new Set());
    }
  }
  return adjacency;
}

function detectCycles(adjacency){
  const cycles = [];
  const stack = [];
  const onStack = new Set();
  const visited = new Set();
  const seenSignatures = new Set();

  function pushCycle(startNode){
    const startIndex = stack.indexOf(startNode);
    const cyclePath = startIndex >= 0 ? stack.slice(startIndex) : [startNode];
    cyclePath.push(startNode);
    const signature = cyclePath.join('->');
    if(!seenSignatures.has(signature)){
      seenSignatures.add(signature);
      cycles.push(cyclePath);
    }
  }

  function dfs(node){
    stack.push(node);
    onStack.add(node);
    const neighbors = adjacency.get(node);
    if(neighbors){
      for(const neighbor of neighbors){
        if(onStack.has(neighbor)){
          pushCycle(neighbor);
          continue;
        }
        if(!visited.has(neighbor)){
          dfs(neighbor);
        }
      }
    }
    stack.pop();
    onStack.delete(node);
    visited.add(node);
  }

  for(const node of adjacency.keys()){
    if(!visited.has(node)){
      dfs(node);
    }
  }

  return cycles;
}

export function validateClusterRouting(cluster){
  if(!isCluster(cluster)){
    throw new TypeError('Expected a cloud cluster instance for routing validation.');
  }
  const adjacency = buildAdjacency(cluster);
  const cycles = detectCycles(adjacency);
  const issues = cycles.map((cycle) => ({
    code: 'routing-cycle',
    severity: 'error',
    nodes: cycle,
    message: `Detected routing cycle: ${cycle.join(' -> ')}`,
  }));
  const graph = {};
  for(const [node, neighbors] of adjacency.entries()){
    graph[node] = toArray(neighbors);
  }
  return {
    clusterId: cluster.id,
    issues,
    graph,
  };
}

function inferPortItems(object, direction){
  if(!object || !Array.isArray(object.ports)) return [];
  const seen = new Set();
  const results = [];
  for(const port of object.ports){
    if(port.direction !== direction) continue;
    if(!Array.isArray(port.itemKeys)) continue;
    for(const key of port.itemKeys){
      if(typeof key !== 'string') continue;
      if(seen.has(key)) continue;
      seen.add(key);
      results.push(key);
    }
  }
  return results;
}

function resolveMinerOutputItem(object){
  if(!object) return FactoryItem.SKIN_PATCH;
  const meta = object.metadata ?? {};
  if(typeof meta.outputItem === 'string'){
    return meta.outputItem;
  }
  if(typeof meta.resource === 'string'){
    return meta.resource;
  }
  const portItems = inferPortItems(object, CloudFactoryPortDirection.OUTPUT);
  if(portItems.length === 1){
    return portItems[0];
  }
  return FactoryItem.SKIN_PATCH;
}

function resolveSmelterRecipe(object){
  const meta = object?.metadata ?? {};
  const key = typeof meta.recipeKey === 'string'
    ? meta.recipeKey
    : typeof meta.recipe === 'string'
      ? meta.recipe
      : typeof meta.recipe?.key === 'string'
        ? meta.recipe.key
        : null;
  return getBioforgeRecipeDefinition(key) ?? getDefaultBioforgeRecipeDefinition();
}

function resolveConstructorRecipe(object){
  const meta = object?.metadata ?? {};
  const key = typeof meta.blueprintKey === 'string'
    ? meta.blueprintKey
    : typeof meta.recipeKey === 'string'
      ? meta.recipeKey
      : typeof meta.blueprint === 'string'
        ? meta.blueprint
        : typeof meta.blueprint?.key === 'string'
          ? meta.blueprint.key
          : typeof meta.recipe?.key === 'string'
            ? meta.recipe.key
            : null;
  return getConstructorBlueprintDefinition(key) ?? getDefaultConstructorBlueprintDefinition();
}

function pushRate(list, item, rate){
  if(!item) return;
  if(!Number.isFinite(rate) || rate <= RATE_EPSILON) return;
  list.push({ item, rate });
}

function updateTotals(totals, item, produced = 0, consumed = 0){
  if(!item) return;
  if(!totals.has(item)){
    totals.set(item, { item, produced: 0, consumed: 0 });
  }
  const entry = totals.get(item);
  if(Number.isFinite(produced) && produced > 0){
    entry.produced += produced;
  }
  if(Number.isFinite(consumed) && consumed > 0){
    entry.consumed += consumed;
  }
}

function summariseNet(outputs, inputs){
  const net = new Map();
  for(const entry of outputs){
    const prev = net.get(entry.item) ?? 0;
    net.set(entry.item, prev + entry.rate);
  }
  for(const entry of inputs){
    const prev = net.get(entry.item) ?? 0;
    net.set(entry.item, prev - entry.rate);
  }
  return Array.from(net.entries())
    .filter(([, value]) => Math.abs(value) > RATE_EPSILON)
    .map(([item, rate]) => ({ item, rate }));
}

export function calculateClusterThroughput(cluster){
  if(!isCluster(cluster)){
    throw new TypeError('Expected a cloud cluster instance to calculate throughput.');
  }
  const totals = new Map();
  const objects = [];

  for(const object of cluster.objects.values()){
    const outputs = [];
    const inputs = [];
    let bandwidth = null;
    switch(object.kind){
      case FactoryKind.MINER: {
        const rate = getMinerExtractionRate();
        const outputItem = resolveMinerOutputItem(object);
        pushRate(outputs, outputItem, rate);
        updateTotals(totals, outputItem, rate, 0);
        break;
      }
      case FactoryKind.SMELTER: {
        const recipe = resolveSmelterRecipe(object);
        const outputItem = recipe?.output ?? null;
        const speed = recipe?.speed ?? 0;
        pushRate(outputs, outputItem, speed);
        if(outputItem){
          updateTotals(totals, outputItem, speed, 0);
        }
        for(const input of recipe?.inputs ?? []){
          const amount = Number.isFinite(input.amount) ? input.amount : 0;
          if(amount <= 0) continue;
          const rate = speed * amount;
          pushRate(inputs, input.item, rate);
          if(input.item){
            updateTotals(totals, input.item, 0, rate);
          }
        }
        break;
      }
      case FactoryKind.CONSTRUCTOR: {
        const recipe = resolveConstructorRecipe(object);
        const outputItem = recipe?.output ?? null;
        const speed = recipe?.speed ?? 0;
        pushRate(outputs, outputItem, speed);
        if(outputItem){
          updateTotals(totals, outputItem, speed, 0);
        }
        for(const input of recipe?.inputs ?? []){
          const amount = Number.isFinite(input.amount) ? input.amount : 0;
          if(amount <= 0) continue;
          const rate = speed * amount;
          pushRate(inputs, input.item, rate);
          if(input.item){
            updateTotals(totals, input.item, 0, rate);
          }
        }
        break;
      }
      case FactoryKind.BELT: {
        bandwidth = getBeltBaseSpeed();
        break;
      }
      default:
        break;
    }

    const totalOutput = outputs.reduce((sum, entry) => sum + entry.rate, 0);
    const totalInput = inputs.reduce((sum, entry) => sum + entry.rate, 0);
    const net = summariseNet(outputs, inputs);

    objects.push({
      id: object.id,
      kind: object.kind,
      label: object.label ?? object.id,
      outputs,
      inputs,
      net,
      totalOutput,
      totalInput,
      bandwidth,
    });
  }

  const totalsArray = Array.from(totals.values()).map((entry) => ({
    item: entry.item,
    produced: entry.produced,
    consumed: entry.consumed,
    net: entry.produced - entry.consumed,
  })).sort((a, b) => a.item.localeCompare(b.item));

  return {
    clusterId: cluster.id,
    totals: totalsArray,
    objects,
  };
}

export function createClusterTelemetry(cluster, { validation, throughput, tick = null } = {}){
  if(!isCluster(cluster)){
    throw new TypeError('Expected a cloud cluster instance to create telemetry.');
  }
  const validationReport = validation ?? validateClusterRouting(cluster);
  const throughputReport = throughput ?? calculateClusterThroughput(cluster);
  const status = validationReport.issues.some((issue) => issue.severity === 'error')
    ? 'error'
    : validationReport.issues.some((issue) => issue.severity === 'warning')
      ? 'warning'
      : 'ok';
  return {
    id: cluster.id,
    clusterId: cluster.id,
    name: cluster.name,
    description: cluster.description,
    tick,
    status,
    issues: validationReport.issues,
    totals: throughputReport.totals,
    objects: throughputReport.objects,
  };
}

export function stepCloudClusterSimulation({ tick = 0 } = {}){
  const state = getCloudClusterState();
  const registry = ensureRegistry(state.registry);
  const seen = new Set();
  state.validation.clear();
  state.throughput.clear();

  const snapshots = [];
  const orderedIds = Array.isArray(registry.order) && registry.order.length
    ? registry.order
    : Array.from(registry.byId.keys());

  for(const id of orderedIds){
    if(seen.has(id)) continue;
    seen.add(id);
    const cluster = registry.byId.get(id);
    if(!cluster || !isCluster(cluster)) continue;
    const validation = validateClusterRouting(cluster);
    const throughput = calculateClusterThroughput(cluster);
    state.validation.set(cluster.id, validation);
    state.throughput.set(cluster.id, throughput);
    snapshots.push(createClusterTelemetry(cluster, { validation, throughput, tick }));
  }

  for(const [id, cluster] of registry.byId.entries()){
    if(seen.has(id)) continue;
    if(!isCluster(cluster)) continue;
    const validation = validateClusterRouting(cluster);
    const throughput = calculateClusterThroughput(cluster);
    state.validation.set(cluster.id, validation);
    state.throughput.set(cluster.id, throughput);
    snapshots.push(createClusterTelemetry(cluster, { validation, throughput, tick }));
  }

  state.telemetry = { tick, clusters: snapshots };
  return state.telemetry;
}

export function getCloudClusterTelemetry(){
  return getCloudClusterState().telemetry;
}

export function getClusterValidationReport(clusterId){
  return getCloudClusterState().validation.get(clusterId) ?? null;
}

export function getClusterThroughput(clusterId){
  return getCloudClusterState().throughput.get(clusterId) ?? null;
}
