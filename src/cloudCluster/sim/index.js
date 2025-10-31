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

function buildInboundLinkMap(cluster){
  const inbound = new Map();
  for(const link of cluster.links.values()){
    const targetId = link?.target?.objectId;
    if(!targetId) continue;
    if(!inbound.has(targetId)){
      inbound.set(targetId, []);
    }
    inbound.get(targetId).push(link);
  }
  return inbound;
}

function incrementMapValue(map, key, amount){
  if(!Number.isFinite(amount) || Math.abs(amount) <= RATE_EPSILON){
    return;
  }
  const previous = map.get(key) ?? 0;
  map.set(key, previous + amount);
}

function ensureClusterAccumulatorRecord(clusterId){
  const state = getCloudClusterState();
  if(!state.accumulators){
    state.accumulators = new Map();
  }
  let record = state.accumulators.get(clusterId);
  if(!record){
    record = {
      lastTick: null,
      itemTotals: new Map(),
      objectTotals: new Map(),
    };
    state.accumulators.set(clusterId, record);
  }
  return record;
}

function ensureObjectTotals(record, objectId){
  let objectTotals = record.objectTotals.get(objectId);
  if(!objectTotals){
    objectTotals = {
      outputs: new Map(),
      inputs: new Map(),
      net: new Map(),
      produced: 0,
      consumed: 0,
    };
    record.objectTotals.set(objectId, objectTotals);
  }
  return objectTotals;
}

function accumulateItemTotals(record, item, producedDelta = 0, consumedDelta = 0){
  if(!item) return;
  let entry = record.itemTotals.get(item);
  if(!entry){
    entry = { produced: 0, consumed: 0 };
    record.itemTotals.set(item, entry);
  }
  if(Number.isFinite(producedDelta) && producedDelta > 0){
    entry.produced += producedDelta;
  }
  if(Number.isFinite(consumedDelta) && consumedDelta > 0){
    entry.consumed += consumedDelta;
  }
}

function updateClusterAccumulator(clusterId, throughput, tick){
  if(!throughput || !Array.isArray(throughput.objects)){
    return;
  }
  const record = ensureClusterAccumulatorRecord(clusterId);
  const delta = record.lastTick == null ? 1 : Math.max(0, tick - record.lastTick);
  record.lastTick = tick;
  if(delta <= 0){
    return;
  }
  for(const object of throughput.objects){
    const objectTotals = ensureObjectTotals(record, object.id);
    for(const entry of (object.outputs ?? [])){
      const amount = Number.isFinite(entry.rate) ? entry.rate * delta : 0;
      if(amount <= RATE_EPSILON) continue;
      incrementMapValue(objectTotals.outputs, entry.item, amount);
      incrementMapValue(objectTotals.net, entry.item, amount);
      objectTotals.produced += amount;
      accumulateItemTotals(record, entry.item, amount, 0);
    }
    for(const entry of (object.inputs ?? [])){
      const amount = Number.isFinite(entry.rate) ? entry.rate * delta : 0;
      if(amount <= RATE_EPSILON) continue;
      incrementMapValue(objectTotals.inputs, entry.item, amount);
      incrementMapValue(objectTotals.net, entry.item, -amount);
      objectTotals.consumed += amount;
      accumulateItemTotals(record, entry.item, 0, amount);
    }
  }
}
 
export function clearClusterAccumulator(clusterId){
  const state = getCloudClusterState();
  if(!state.accumulators){
    state.accumulators = new Map();
  }
  if(clusterId == null){
    state.accumulators.clear();
    return;
  }
  state.accumulators.delete(clusterId);
}

export function updateClusterAccumulatorMembership(clusterId, { added = [], removed = [] } = {}){
  const state = getCloudClusterState();
  if(!state.accumulators){
    state.accumulators = new Map();
  }
  const record = state.accumulators.get(clusterId);
  if(!record){
    return;
  }
  for(const id of removed){
    record.objectTotals.delete(id);
  }
  for(const id of added){
    record.objectTotals.delete(id);
  }
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

function resolveNodeOutputs(object){
  if(!object){
    return [];
  }
  const meta = object.metadata ?? {};
  if(meta.autoExtract === false){
    return [];
  }
  const outputs = [];
  if(meta.outputRates && typeof meta.outputRates === 'object'){
    for(const [item, rate] of Object.entries(meta.outputRates)){
      const key = typeof item === 'string' ? item : null;
      if(!key) continue;
      if(!Number.isFinite(rate) || rate <= RATE_EPSILON) continue;
      outputs.push({ item: key, rate });
    }
    if(outputs.length){
      return outputs;
    }
  }
  const itemSet = new Set();
  if(Array.isArray(meta.outputItems)){
    for(const entry of meta.outputItems){
      if(typeof entry === 'string' && entry){
        itemSet.add(entry);
      }
    }
  }
  if(typeof meta.outputItem === 'string' && meta.outputItem){
    itemSet.add(meta.outputItem);
  }
  if(typeof meta.resource === 'string' && meta.resource){
    itemSet.add(meta.resource);
  }
  if(!itemSet.size){
    for(const portItem of inferPortItems(object, CloudFactoryPortDirection.OUTPUT)){
      if(typeof portItem === 'string' && portItem){
        itemSet.add(portItem);
      }
    }
  }
  if(!itemSet.size){
    const hints = [];
    if(typeof meta.type === 'string') hints.push(meta.type);
    if(typeof meta.nodeType === 'string') hints.push(meta.nodeType);
    if(typeof object.label === 'string') hints.push(object.label);
    if(typeof object.description === 'string') hints.push(object.description);
    if(typeof object.id === 'string') hints.push(object.id);
    const mappings = [
      { regex: /blood|serum|haem/i, item: FactoryItem.BLOOD_VIAL },
      { regex: /organ|visc/i, item: FactoryItem.ORGAN_MASS },
      { regex: /nerve|synapse/i, item: FactoryItem.NERVE_THREAD },
      { regex: /bone|osteo/i, item: FactoryItem.BONE_FRAGMENT },
      { regex: /gland|endocr/i, item: FactoryItem.GLAND_SEED },
      { regex: /skin|derm|dermal/i, item: FactoryItem.SKIN_PATCH },
    ];
    for(const hint of hints){
      if(!hint) continue;
      for(const mapping of mappings){
        if(mapping.regex.test(hint)){
          itemSet.add(mapping.item);
        }
      }
      if(itemSet.size){
        break;
      }
    }
  }
  if(!itemSet.size){
    itemSet.add(FactoryItem.SKIN_PATCH);
  }
  const rate = Number.isFinite(meta.outputRate) && meta.outputRate > RATE_EPSILON
    ? meta.outputRate
    : getMinerExtractionRate();
  const entries = [];
  for(const item of itemSet){
    entries.push({ item, rate });
  }
  return entries;
}

function collectPotentialOutputItems(object){
  switch(object.kind){
    case FactoryKind.NODE: {
      const entries = resolveNodeOutputs(object);
      return new Set(entries.map((entry) => entry.item));
    }
    case FactoryKind.MINER: {
      return new Set([resolveMinerOutputItem(object)]);
    }
    case FactoryKind.SMELTER: {
      const recipe = resolveSmelterRecipe(object);
      return recipe?.output ? new Set([recipe.output]) : new Set();
    }
    case FactoryKind.CONSTRUCTOR: {
      const recipe = resolveConstructorRecipe(object);
      return recipe?.output ? new Set([recipe.output]) : new Set();
    }
    default:
      return new Set();
  }
}

function isItemSupplied(cluster, inboundMap, outputItemsMap, objectId, item){
  const inboundLinks = inboundMap.get(objectId);
  if(!inboundLinks || !inboundLinks.length){
    return false;
  }
  for(const link of inboundLinks){
    const sourceId = link?.source?.objectId;
    if(!sourceId) continue;
    const sourceItems = outputItemsMap.get(sourceId);
    if(sourceItems?.has(item)){
      return true;
    }
  }
  return false;
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

function mergeRatesWithHistory(rates = [], historyMap){
  const merged = [];
  const seen = new Set();
  for(const entry of rates){
    const total = historyMap?.get(entry.item) ?? 0;
    merged.push({
      ...entry,
      total,
    });
    seen.add(entry.item);
  }
  if(historyMap instanceof Map){
    for(const [item, total] of historyMap.entries()){
      if(seen.has(item)) continue;
      merged.push({ item, rate: 0, total });
    }
  }
  return merged;
}

function mergeTotalsWithHistory(rateTotals = [], historyMap){
  const merged = [];
  const seen = new Set();
  for(const entry of rateTotals){
    const history = historyMap instanceof Map ? historyMap.get(entry.item) : null;
    merged.push({
      ...entry,
      cumulativeProduced: history?.produced ?? 0,
      cumulativeConsumed: history?.consumed ?? 0,
      cumulativeNet: history ? history.produced - history.consumed : entry.net,
    });
    seen.add(entry.item);
  }
  if(historyMap instanceof Map){
    for(const [item, history] of historyMap.entries()){
      if(seen.has(item)) continue;
      merged.push({
        item,
        produced: 0,
        consumed: 0,
        net: 0,
        cumulativeProduced: history.produced,
        cumulativeConsumed: history.consumed,
        cumulativeNet: history.produced - history.consumed,
      });
    }
  }
  merged.sort((a, b) => a.item.localeCompare(b.item));
  return merged;
}

export function calculateClusterThroughput(cluster){
  if(!isCluster(cluster)){
    throw new TypeError('Expected a cloud cluster instance to calculate throughput.');
  }
  const inboundMap = buildInboundLinkMap(cluster);
  const outputItemsMap = new Map();
  for(const [objectId, object] of cluster.objects.entries()){
    outputItemsMap.set(objectId, collectPotentialOutputItems(object));
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
      case FactoryKind.NODE: {
        const nodeOutputs = resolveNodeOutputs(object);
        for(const entry of nodeOutputs){
          pushRate(outputs, entry.item, entry.rate);
          if(entry.item){
            updateTotals(totals, entry.item, entry.rate, 0);
          }
        }
        break;
      }
      case FactoryKind.SMELTER: {
        const recipe = resolveSmelterRecipe(object);
        const outputItem = recipe?.output ?? null;
        const speed = recipe?.speed ?? 0;
        const requirements = recipe?.inputs ?? [];
        const canRun = outputItem && speed > 0 && requirements.every((requirement) => {
          const item = requirement?.item;
          if(!item) return false;
          return isItemSupplied(cluster, inboundMap, outputItemsMap, object.id, item);
        });
        if(!canRun){
          break;
        }
        pushRate(outputs, outputItem, speed);
        if(outputItem){
          updateTotals(totals, outputItem, speed, 0);
        }
        for(const input of requirements){
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
        const requirements = recipe?.inputs ?? [];
        const canRun = outputItem && speed > 0 && requirements.every((requirement) => {
          const item = requirement?.item;
          if(!item) return false;
          return isItemSupplied(cluster, inboundMap, outputItemsMap, object.id, item);
        });
        if(!canRun){
          break;
        }
        pushRate(outputs, outputItem, speed);
        if(outputItem){
          updateTotals(totals, outputItem, speed, 0);
        }
        for(const input of requirements){
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
  const state = getCloudClusterState();
  const accumulator = state.accumulators?.get(cluster.id) ?? null;
  const status = validationReport.issues.some((issue) => issue.severity === 'error')
    ? 'error'
    : validationReport.issues.some((issue) => issue.severity === 'warning')
      ? 'warning'
      : 'ok';
  const totalsWithHistory = accumulator
    ? mergeTotalsWithHistory(throughputReport.totals, accumulator.itemTotals)
    : throughputReport.totals;
  const objectsWithHistory = throughputReport.objects.map((object) => {
    const history = accumulator?.objectTotals?.get(object.id) ?? null;
    const outputs = mergeRatesWithHistory(object.outputs ?? [], history?.outputs);
    const inputs = mergeRatesWithHistory(object.inputs ?? [], history?.inputs);
    const net = mergeRatesWithHistory(object.net ?? [], history?.net);
    const cumulativeProduced = history?.produced ?? 0;
    const cumulativeConsumed = history?.consumed ?? 0;
    const cumulativeNet = cumulativeProduced - cumulativeConsumed;
    return {
      ...object,
      outputs,
      inputs,
      net,
      cumulativeProduced,
      cumulativeConsumed,
      cumulativeNet,
    };
  });
  return {
    id: cluster.id,
    clusterId: cluster.id,
    name: cluster.name,
    description: cluster.description,
    tick,
    status,
    issues: validationReport.issues,
    totals: totalsWithHistory,
    objects: objectsWithHistory,
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
    updateClusterAccumulator(cluster.id, throughput, tick);
    state.validation.set(cluster.id, validation);
    state.throughput.set(cluster.id, throughput);
    snapshots.push(createClusterTelemetry(cluster, { validation, throughput, tick }));
  }

  for(const [id, cluster] of registry.byId.entries()){
    if(seen.has(id)) continue;
    if(!isCluster(cluster)) continue;
    const validation = validateClusterRouting(cluster);
    const throughput = calculateClusterThroughput(cluster);
    updateClusterAccumulator(cluster.id, throughput, tick);
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
