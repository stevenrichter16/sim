import { Mode, DIRS4, clamp01 } from './constants.js';
import { world, idx, inBounds } from './state.js';
import { baseStringFor } from './materials.js';

export const FactoryKind = Object.freeze({
  NODE: 'node',
  MINER: 'miner',
  BELT: 'belt',
  SMELTER: 'smelter',
  CONSTRUCTOR: 'constructor',
  STORAGE: 'storage',
});

export const FactoryItem = Object.freeze({
  IRON_ORE: 'iron_ore',
  IRON_INGOT: 'iron_ingot',
  PLATE: 'iron_plate',
});

const ORIENTATIONS = Object.freeze(['north', 'east', 'south', 'west']);
const ORIENTATION_LABEL = Object.freeze({
  north: 'North',
  east: 'East',
  south: 'South',
  west: 'West',
});
const ORIENTATION_VECTOR = Object.freeze({
  north: { dx: 0, dy: -1 },
  east: { dx: 1, dy: 0 },
  south: { dx: 0, dy: 1 },
  west: { dx: -1, dy: 0 },
});
const ORIENTATION_ANGLE = Object.freeze({
  east: 0,
  south: Math.PI / 2,
  west: Math.PI,
  north: -Math.PI / 2,
});
const ORIENTATION_OPPOSITE = Object.freeze({
  north: 'south',
  east: 'west',
  south: 'north',
  west: 'east',
});

const FACTORY_MODE_SET = new Set([
  Mode.FACTORY_NODE,
  Mode.FACTORY_MINER,
  Mode.FACTORY_BELT,
  Mode.FACTORY_SMELTER,
  Mode.FACTORY_CONSTRUCTOR,
  Mode.FACTORY_STORAGE,
]);

const MINER_RATE = 0.18;
const BELT_SPEED = 0.35;
const SMELTER_TIME = 8;
const CONSTRUCTOR_TIME = 12;
const CONSTRUCTOR_INPUT = 2;

const FACTORY_KIND_META = Object.freeze({
  [FactoryKind.NODE]: { icon: '🪨', name: 'Ore Node' },
  [FactoryKind.MINER]: { icon: '⛏️', name: 'Miner' },
  [FactoryKind.BELT]: { icon: '➡️', name: 'Conveyor' },
  [FactoryKind.SMELTER]: { icon: '🔥', name: 'Smelter' },
  [FactoryKind.CONSTRUCTOR]: { icon: '🏭', name: 'Constructor' },
  [FactoryKind.STORAGE]: { icon: '📦', name: 'Storage' },
});

function factoryKindMeta(kind){
  return FACTORY_KIND_META[kind] || { icon: '❓', name: kind ?? 'Unknown' };
}

function factoryItemLabel(item){
  switch(item){
    case FactoryItem.IRON_ORE:
      return 'Iron Ore';
    case FactoryItem.IRON_INGOT:
      return 'Iron Ingot';
    case FactoryItem.PLATE:
      return 'Iron Plate';
    default:
      if(typeof item === 'string'){ return item.replace(/_/g,' ').replace(/\b\w/g, ch => ch.toUpperCase()); }
      return '—';
  }
}

function createStructureTelemetry(kind){
  const factory = ensureFactoryState();
  const tick = factory.ticks ?? 0;
  switch(kind){
    case FactoryKind.MINER:
      return {
        kind,
        createdTick: tick,
        jobsQueued: 0,
        oreExtracted: 0,
        totalTicks: 0,
        activeTicks: 0,
        lastJobTick: null,
        lastOutputTick: null,
      };
    case FactoryKind.BELT:
      return {
        kind,
        createdTick: tick,
        totalTicks: 0,
        occupiedTicks: 0,
        itemsReceived: 0,
        itemsMoved: 0,
        itemsPulled: 0,
        lastReceivedTick: null,
        lastMovedTick: null,
        lastReceivedItem: null,
        lastMovedItem: null,
        currentItem: null,
      };
    case FactoryKind.SMELTER:
    case FactoryKind.CONSTRUCTOR:
      return {
        kind,
        createdTick: tick,
        totalTicks: 0,
        activeTicks: 0,
        waitingForInputTicks: 0,
        cyclesStarted: 0,
        cyclesCompleted: 0,
        itemsAccepted: 0,
        itemsConsumed: 0,
        outputRequests: 0,
        inputRequests: 0,
        outputsPicked: 0,
        lastInputTick: null,
        lastOutputTick: null,
        lastCycleStartTick: null,
        lastOutputRequestTick: null,
        outputBuffer: 0,
        inputBuffer: 0,
        lastOutputItem: null,
      };
    case FactoryKind.STORAGE:
      return {
        kind,
        createdTick: tick,
        deliveries: 0,
        lastDeliveryTick: null,
        lastDeliveryItem: null,
      };
    default:
      return { kind, createdTick: tick };
  }
}

function createNodeTelemetry(){
  const factory = ensureFactoryState();
  return {
    createdTick: factory.ticks ?? 0,
    mined: 0,
    lastMinedTick: null,
  };
}

function ensureStructureTelemetry(structure){
  if(!structure) return null;
  if(!structure.telemetry){
    structure.telemetry = createStructureTelemetry(structure.kind);
  }
  return structure.telemetry;
}

function formatTickValue(tick){
  if(tick == null) return '—';
  return `#${tick}`;
}

function mapContentsToSummary(contents){
  if(!contents || !contents.size) return 'Empty';
  const parts = [];
  for(const [item, count] of contents.entries()){
    parts.push(`${factoryItemLabel(item)} ${count}`);
  }
  return parts.join(', ');
}

const BRUSH_SPEC = Object.freeze({
  'factory-node': {
    kind: FactoryKind.NODE,
    mode: Mode.FACTORY_NODE,
    resource: FactoryItem.IRON_ORE,
  },
  'factory-miner': {
    kind: FactoryKind.MINER,
    mode: Mode.FACTORY_MINER,
  },
  'factory-belt': {
    kind: FactoryKind.BELT,
    mode: Mode.FACTORY_BELT,
  },
  'factory-smelter': {
    kind: FactoryKind.SMELTER,
    mode: Mode.FACTORY_SMELTER,
  },
  'factory-constructor': {
    kind: FactoryKind.CONSTRUCTOR,
    mode: Mode.FACTORY_CONSTRUCTOR,
  },
  'factory-storage': {
    kind: FactoryKind.STORAGE,
    mode: Mode.FACTORY_STORAGE,
  },
});

function createFactoryState(){
  return {
    orientation: 'east',
    nodes: new Map(),
    structures: new Map(),
    jobs: [],
    workers: [],
    workerAgents: [],
    nextWorkerId: 1,
    ticks: 0,
    stats: {
      produced: Object.create(null),
      stored: Object.create(null),
      delivered: Object.create(null),
      constructorComplete: 0,
      jobsCompleted: 0,
    },
  };
}

export function resetFactoryState(){
  world.factory = createFactoryState();
}

function ensureFactoryState(){
  if(!world.factory){
    resetFactoryState();
  }
  return world.factory;
}

function normaliseOrientation(value){
  if(!value) return 'east';
  if(typeof value === 'string'){
    const lowered = value.toLowerCase();
    if(ORIENTATIONS.includes(lowered)) return lowered;
    switch(lowered){
      case 'n':
      case 'up':
        return 'north';
      case 'e':
      case 'right':
        return 'east';
      case 's':
      case 'down':
        return 'south';
      case 'w':
      case 'left':
        return 'west';
      default:
        break;
    }
  }
  return 'east';
}

function orientationToVector(orientation){
  return ORIENTATION_VECTOR[orientation] || ORIENTATION_VECTOR.east;
}

function orientationToAngle(orientation){
  return ORIENTATION_ANGLE[orientation] ?? 0;
}

function getOrientationLabel(orientation){
  return ORIENTATION_LABEL[orientation] || ORIENTATION_LABEL.east;
}

function incrementCounter(target, key, amount = 1){
  if(!target) return 0;
  const prev = target[key] ?? 0;
  const next = prev + amount;
  target[key] = next;
  return next;
}

function createStructure(kind, orientation){
  const telemetry = createStructureTelemetry(kind);
  switch(kind){
    case FactoryKind.MINER:
      return { kind, orientation, progress: 0, rate: MINER_RATE, jobAssigned: false, telemetry };
    case FactoryKind.BELT:
      return { kind, orientation, progress: 0, speed: BELT_SPEED, item: null, telemetry };
    case FactoryKind.SMELTER:
      return {
        kind,
        orientation,
        input: 0,
        progress: 0,
        active: false,
        outputBuffer: 0,
        pendingInputJob: false,
        pendingOutputJob: false,
        recipe: {
          input: FactoryItem.IRON_ORE,
          inputAmount: 1,
          output: FactoryItem.IRON_INGOT,
          speed: 1 / SMELTER_TIME,
        },
        telemetry,
      };
    case FactoryKind.CONSTRUCTOR:
      return {
        kind,
        orientation,
        input: 0,
        progress: 0,
        active: false,
        outputBuffer: 0,
        pendingInputJob: false,
        pendingOutputJob: false,
        recipe: {
          input: FactoryItem.IRON_INGOT,
          inputAmount: CONSTRUCTOR_INPUT,
          output: FactoryItem.PLATE,
          speed: 1 / CONSTRUCTOR_TIME,
        },
        telemetry,
      };
    case FactoryKind.STORAGE:
      return { kind, orientation, contents: new Map(), telemetry };
    default:
      return { kind, orientation, telemetry };
  }
}

function createNode(resource){
  return { resource, telemetry: createNodeTelemetry() };
}

function neighborIndex(tileIdx, orientation){
  const vec = orientationToVector(orientation);
  const x = tileIdx % world.W;
  const y = (tileIdx / world.W) | 0;
  const nx = x + vec.dx;
  const ny = y + vec.dy;
  if(!inBounds(nx, ny)) return -1;
  return idx(nx, ny);
}

function acceptItem(structure, tileIdx, item, factory){
  const telemetry = ensureStructureTelemetry(structure);
  const nowTick = factory?.ticks ?? 0;
  switch(structure.kind){
    case FactoryKind.BELT:
      if(structure.item) return false;
      structure.item = item;
      structure.progress = 0;
      if(telemetry){
        telemetry.itemsReceived = (telemetry.itemsReceived ?? 0) + 1;
        telemetry.lastReceivedTick = nowTick;
        telemetry.lastReceivedItem = item;
        telemetry.currentItem = item;
      }
      return true;
    case FactoryKind.SMELTER:
      if(item !== structure.recipe.input) return false;
      structure.input += 1;
      if(telemetry){
        telemetry.itemsAccepted = (telemetry.itemsAccepted ?? 0) + 1;
        telemetry.lastInputTick = nowTick;
        telemetry.inputBuffer = structure.input;
      }
      return true;
    case FactoryKind.CONSTRUCTOR:
      if(item !== structure.recipe.input) return false;
      structure.input += 1;
      if(telemetry){
        telemetry.itemsAccepted = (telemetry.itemsAccepted ?? 0) + 1;
        telemetry.lastInputTick = nowTick;
        telemetry.inputBuffer = structure.input;
      }
      return true;
    case FactoryKind.STORAGE: {
      const contents = structure.contents;
      contents.set(item, (contents.get(item) ?? 0) + 1);
      incrementCounter(factory.stats.stored, item, 1);
      if(item === FactoryItem.PLATE){
        incrementCounter(factory.stats.delivered, item, 1);
        factory.stats.constructorComplete = (factory.stats.constructorComplete ?? 0) + 1;
      }
      if(telemetry){
        telemetry.deliveries = (telemetry.deliveries ?? 0) + 1;
        telemetry.lastDeliveryTick = nowTick;
        telemetry.lastDeliveryItem = item;
      }
      return true;
    }
    default:
      return false;
  }
}

function pushItemFrom(tileIdx, orientation, item, factory){
  const targetIdx = neighborIndex(tileIdx, orientation);
  if(targetIdx < 0) return false;
  const target = factory.structures.get(targetIdx);
  if(!target) return false;
  return acceptItem(target, targetIdx, item, factory);
}

function updateMiner(tileIdx, structure, factory){
  const telemetry = ensureStructureTelemetry(structure);
  if(telemetry){
    telemetry.totalTicks = (telemetry.totalTicks ?? 0) + 1;
    if(structure.jobAssigned){
      telemetry.activeTicks = (telemetry.activeTicks ?? 0) + 1;
    }
  }
  if(!factory.nodes.has(tileIdx)){
    structure.progress = 0;
    return;
  }
  structure.active = true;
  if(!structure.jobAssigned){
    const target = neighborIndex(tileIdx, structure.orientation);
    enqueueFactoryJob({
      kind: 'mine',
      tileIdx,
      payload: {
        duration: 3,
        targetStructure: target,
        sourceStructure: tileIdx,
      },
    });
    structure.jobAssigned = true;
    if(telemetry){
      telemetry.jobsQueued = (telemetry.jobsQueued ?? 0) + 1;
      telemetry.lastJobTick = factory.ticks ?? 0;
    }
  }
}

function updateBelt(tileIdx, structure, factory){
  const telemetry = ensureStructureTelemetry(structure);
  if(telemetry){
    telemetry.totalTicks = (telemetry.totalTicks ?? 0) + 1;
    telemetry.currentItem = structure.item;
    if(structure.item){
      telemetry.occupiedTicks = (telemetry.occupiedTicks ?? 0) + 1;
    }
  }
  if(!structure.item){
    structure.progress = 0;
    return;
  }
  structure.progress = Math.min(1, (structure.progress ?? 0) + (structure.speed ?? BELT_SPEED));
  if(structure.progress >= 1){
    const movedItem = structure.item;
    if(pushItemFrom(tileIdx, structure.orientation, movedItem, factory)){
      if(telemetry){
        telemetry.itemsMoved = (telemetry.itemsMoved ?? 0) + 1;
        telemetry.lastMovedTick = factory.ticks ?? 0;
        telemetry.lastMovedItem = movedItem;
        telemetry.currentItem = null;
      }
      structure.item = null;
      structure.progress = 0;
    }
  }
}

function maybeStartJob(structure, factory){
  if(structure.active) return;
  const recipe = structure.recipe;
  if(!recipe) return;
  if(structure.input >= (recipe.inputAmount ?? 1)){
    structure.input -= recipe.inputAmount ?? 1;
    structure.active = true;
    structure.progress = 0;
    const telemetry = ensureStructureTelemetry(structure);
    if(telemetry){
      telemetry.cyclesStarted = (telemetry.cyclesStarted ?? 0) + 1;
      telemetry.lastCycleStartTick = factory?.ticks ?? 0;
      telemetry.inputBuffer = structure.input;
    }
  }
}

function updateRecipeProducer(tileIdx, structure, factory){
  const recipe = structure.recipe;
  if(!recipe) return;
  const telemetry = ensureStructureTelemetry(structure);
  if(telemetry){
    telemetry.totalTicks = (telemetry.totalTicks ?? 0) + 1;
    if(structure.active){
      telemetry.activeTicks = (telemetry.activeTicks ?? 0) + 1;
    } else if(structure.pendingInputJob){
      telemetry.waitingForInputTicks = (telemetry.waitingForInputTicks ?? 0) + 1;
    }
    telemetry.inputBuffer = structure.input;
    telemetry.outputBuffer = structure.outputBuffer ?? 0;
  }
  const opposite = ORIENTATION_OPPOSITE[structure.orientation] || 'west';
  const sourceIdx = neighborIndex(tileIdx, opposite);
  if(!structure.pendingInputJob && !structure.active && structure.input < (recipe.inputAmount ?? 1) && sourceIdx >= 0){
    structure.pendingInputJob = true;
    enqueueFactoryJob({
      kind: 'pull',
      tileIdx: sourceIdx,
      payload: {
        duration: 1,
        item: recipe.input,
        source: sourceIdx,
        target: tileIdx,
      },
    });
    if(telemetry){
      telemetry.inputRequests = (telemetry.inputRequests ?? 0) + 1;
      telemetry.lastInputTick = factory.ticks ?? 0;
    }
  }
  if(!structure.active){
    maybeStartJob(structure, factory);
  }
  if(structure.active){
    structure.progress = Math.min(1, (structure.progress ?? 0) + (recipe.speed ?? 0.1));
    if(structure.progress >= 1){
      structure.outputBuffer = (structure.outputBuffer ?? 0) + 1;
      structure.active = false;
      structure.progress = 0;
      incrementCounter(factory.stats.produced, recipe.output, 1);
      if(telemetry){
        telemetry.cyclesCompleted = (telemetry.cyclesCompleted ?? 0) + 1;
        telemetry.itemsConsumed = (telemetry.itemsConsumed ?? 0) + (recipe.inputAmount ?? 1);
        telemetry.lastOutputTick = factory.ticks ?? 0;
        telemetry.outputBuffer = structure.outputBuffer ?? 0;
        telemetry.lastOutputItem = recipe.output;
      }
      maybeStartJob(structure, factory);
    }
  }
  const outputTarget = neighborIndex(tileIdx, structure.orientation);
  if(structure.outputBuffer > 0 && !structure.pendingOutputJob && outputTarget >= 0){
    structure.pendingOutputJob = true;
    enqueueFactoryJob({
      kind: 'pickup-output',
      tileIdx,
      payload: {
        duration: 1,
        item: recipe.output,
        target: outputTarget,
      },
    });
    if(telemetry){
      telemetry.outputRequests = (telemetry.outputRequests ?? 0) + 1;
      telemetry.outputBuffer = structure.outputBuffer ?? 0;
      telemetry.lastOutputRequestTick = factory.ticks ?? 0;
    }
  }
}

function updateConstructor(tileIdx, structure, factory){
  updateRecipeProducer(tileIdx, structure, factory);
}

function updateSmelter(tileIdx, structure, factory){
  updateRecipeProducer(tileIdx, structure, factory);
}

export function stepFactory(){
  const factory = ensureFactoryState();
  factory.ticks = (factory.ticks ?? 0) + 1;
  if(factory.structures.size){
    const beltEntries = [];
    for(const entry of factory.structures.entries()){
      if(entry[1]?.kind === FactoryKind.BELT){
        beltEntries.push(entry);
      }
    }
    for(const [tileIdx, structure] of beltEntries){
      updateBelt(tileIdx, structure, factory);
    }
    for(const [tileIdx, structure] of factory.structures.entries()){
      switch(structure.kind){
        case FactoryKind.MINER:
          updateMiner(tileIdx, structure, factory);
          break;
        case FactoryKind.SMELTER:
          updateSmelter(tileIdx, structure, factory);
          break;
        case FactoryKind.CONSTRUCTOR:
          updateConstructor(tileIdx, structure, factory);
          break;
        default:
          break;
      }
    }
  }
  stepFactoryWorkers();
}

export function isFactoryBrush(brush){
  return Object.prototype.hasOwnProperty.call(BRUSH_SPEC, brush);
}

export function getFactoryBrushKeys(){
  return Object.keys(BRUSH_SPEC);
}

export function placeFactoryStructure(tileIdx, brush, { orientation } = {}){
  const spec = BRUSH_SPEC[brush];
  if(!spec){
    return { ok: false, error: 'unknown-brush', brush };
  }
  const factory = ensureFactoryState();
  if(spec.kind === FactoryKind.NODE){
    removeFactoryStructure(tileIdx, { removeNode: true });
    if(world.wall) world.wall[tileIdx] = 0;
    if(world.vent) world.vent[tileIdx] = 0;
    if(world.fire) world.fire.delete(tileIdx);
    factory.nodes.set(tileIdx, createNode(spec.resource || FactoryItem.IRON_ORE));
    world.strings[tileIdx] = baseStringFor(spec.mode);
    return { ok: true, kind: FactoryKind.NODE };
  }
  const dir = normaliseOrientation(orientation ?? factory.orientation);
  if(spec.kind === FactoryKind.MINER && !factory.nodes.has(tileIdx)){
    return {
      ok: false,
      error: 'miner-needs-node',
      message: 'Miners must be placed on an ore node.',
    };
  }
  removeFactoryStructure(tileIdx, { removeNode: false });
  if(world.wall) world.wall[tileIdx] = 0;
  if(world.vent) world.vent[tileIdx] = 0;
  if(world.fire) world.fire.delete(tileIdx);
  const structure = createStructure(spec.kind, dir);
  factory.structures.set(tileIdx, structure);
  world.strings[tileIdx] = baseStringFor(spec.mode);
  return { ok: true, kind: spec.kind, orientation: dir };
}

export function removeFactoryStructure(tileIdx, { removeNode = false } = {}){
  const factory = ensureFactoryState();
  const result = {
    handled: false,
    nodeRemaining: false,
    removedStructure: null,
    removedNode: false,
  };
  const structure = factory.structures.get(tileIdx);
  if(structure){
    factory.structures.delete(tileIdx);
    result.handled = true;
    result.removedStructure = structure.kind;
    if(structure.kind === FactoryKind.BELT){
      structure.item = null;
    }
  }
  const node = factory.nodes.get(tileIdx);
  if(node){
    if(removeNode){
      factory.nodes.delete(tileIdx);
      result.removedNode = true;
      result.handled = true;
    } else {
      result.nodeRemaining = true;
      result.handled = true;
    }
  }
  if(result.nodeRemaining){
    world.strings[tileIdx] = baseStringFor(Mode.FACTORY_NODE);
  } else if(result.handled){
    world.strings[tileIdx] = undefined;
  }
  return result;
}

export function getFactoryStructures(){
  return ensureFactoryState().structures;
}

export function getFactoryNodes(){
  return ensureFactoryState().nodes;
}

export function getFactoryJobQueue(){
  const factory = ensureFactoryState();
  return factory.jobs;
}

function normaliseJobPayload(job){
  if(!job || typeof job !== 'object') return null;
  const kind = typeof job.kind === 'string' ? job.kind : null;
  if(!kind) return null;
  return {
    kind,
    tileIdx: Number.isFinite(job.tileIdx) ? job.tileIdx | 0 : null,
    payload: job.payload ?? null,
  };
}

export function enqueueFactoryJob(job){
  const payload = normaliseJobPayload(job);
  if(!payload) return false;
  const factory = ensureFactoryState();
  factory.jobs.push(payload);
  return true;
}

export function peekFactoryJob(){
  const factory = ensureFactoryState();
  if(!factory.jobs.length) return null;
  return factory.jobs[0];
}

export function popFactoryJob(){
  const factory = ensureFactoryState();
  if(!factory.jobs.length) return null;
  return factory.jobs.shift() ?? null;
}

export function getFactoryDiagnostics(limit = 8){
  const factory = ensureFactoryState();
  const queue = factory.jobs ?? [];
  const workers = factory.workers ?? [];
  return {
    queueLength: queue.length,
    queue: queue.slice(0, limit).map((job, index) => ({
      index,
      kind: job.kind,
      tileIdx: job.tileIdx ?? null,
      item: job.payload?.item ?? null,
    })),
    workers: workers.map((worker) => ({
      id: worker.id,
      state: worker.state,
      tileIdx: worker.tileIdx ?? null,
      carrying: worker.carriedItem ?? null,
      jobKind: worker.job?.kind ?? null,
    })),
  };
}

export function getFactoryTelemetry(){
  const factory = ensureFactoryState();
  const ticks = factory.ticks ?? 0;
  const entries = [];

  for(const [tileIdx, node] of factory.nodes.entries()){
    if(!node.telemetry){
      node.telemetry = createNodeTelemetry();
    }
    const telemetry = node.telemetry;
    const coords = tileIdxToPoint(tileIdx);
    const meta = factoryKindMeta(FactoryKind.NODE);
    const lifetime = Math.max(1, (ticks - (telemetry.createdTick ?? ticks)) + 1);
    const mined = telemetry.mined ?? 0;
    const average = mined / lifetime;
    entries.push({
      tileIdx,
      kind: FactoryKind.NODE,
      title: `${meta.icon} ${meta.name}`,
      coords,
      summary: `${factoryItemLabel(node.resource)} mined ${mined}`,
      stats: [
        { label: 'Resource', value: factoryItemLabel(node.resource) },
        { label: 'Mined', value: String(mined) },
        { label: 'Avg / tick', value: average.toFixed(3) },
        { label: 'Last mined', value: formatTickValue(telemetry.lastMinedTick) },
      ],
    });
  }

  for(const [tileIdx, structure] of factory.structures.entries()){
    const telemetry = ensureStructureTelemetry(structure);
    const coords = tileIdxToPoint(tileIdx);
    const meta = factoryKindMeta(structure.kind);
    const orientationLabel = getOrientationLabel(structure.orientation);
    const lifetime = Math.max(1, (ticks - (telemetry?.createdTick ?? ticks)) + 1);
    switch(structure.kind){
      case FactoryKind.MINER: {
        const node = factory.nodes.get(tileIdx);
        const resourceName = factoryItemLabel(node?.resource ?? FactoryItem.IRON_ORE);
        const totalTicks = telemetry?.totalTicks ?? 0;
        const uptime = totalTicks > 0 ? (telemetry.activeTicks ?? 0) / totalTicks : 0;
        entries.push({
          tileIdx,
          kind: structure.kind,
          title: `${meta.icon} ${meta.name} (${orientationLabel})`,
          coords,
          summary: `${telemetry?.oreExtracted ?? 0} ${resourceName} extracted`,
          stats: [
            { label: 'Resource', value: resourceName },
            { label: 'Orientation', value: orientationLabel },
            { label: 'Jobs queued', value: String(telemetry?.jobsQueued ?? 0) },
            { label: 'Ore extracted', value: String(telemetry?.oreExtracted ?? 0) },
            { label: 'Uptime', value: `${Math.round(uptime * 100)}%` },
            { label: 'Last output', value: formatTickValue(telemetry?.lastOutputTick ?? null) },
            { label: 'State', value: structure.jobAssigned ? 'Working' : 'Idle' },
          ],
        });
        break;
      }
      case FactoryKind.BELT: {
        const totalTicks = telemetry?.totalTicks ?? 0;
        const occupied = telemetry?.occupiedTicks ?? 0;
        const moved = telemetry?.itemsMoved ?? 0;
        const pulled = telemetry?.itemsPulled ?? 0;
        const throughput = totalTicks > 0 ? moved / totalTicks : 0;
        const occupancy = totalTicks > 0 ? occupied / totalTicks : 0;
        const currentItem = structure.item ? `${factoryItemLabel(structure.item)} (${Math.round(clamp01(structure.progress ?? 0) * 100)}%)` : 'Empty';
        entries.push({
          tileIdx,
          kind: structure.kind,
          title: `${meta.icon} ${meta.name} (${orientationLabel})`,
          coords,
          summary: `${moved} items moved (${throughput.toFixed(3)}/tick)`,
          stats: [
            { label: 'Orientation', value: orientationLabel },
            { label: 'Speed', value: (structure.speed ?? BELT_SPEED).toFixed(2) },
            { label: 'Current', value: currentItem },
            { label: 'Items moved', value: String(moved) },
            { label: 'Items pulled', value: String(pulled) },
            { label: 'Avg / tick', value: throughput.toFixed(3) },
            { label: 'Occupancy', value: `${Math.round(occupancy * 100)}%` },
            { label: 'Last move', value: formatTickValue(telemetry?.lastMovedTick ?? null) },
          ],
        });
        break;
      }
      case FactoryKind.SMELTER:
      case FactoryKind.CONSTRUCTOR: {
        const recipe = structure.recipe;
        const recipeLabel = recipe ? `${factoryItemLabel(recipe.input)} → ${factoryItemLabel(recipe.output)}` : '—';
        const totalTicks = telemetry?.totalTicks ?? 0;
        const uptime = totalTicks > 0 ? (telemetry.activeTicks ?? 0) / totalTicks : 0;
        const waiting = totalTicks > 0 ? (telemetry.waitingForInputTicks ?? 0) / totalTicks : 0;
        entries.push({
          tileIdx,
          kind: structure.kind,
          title: `${meta.icon} ${meta.name} (${orientationLabel})`,
          coords,
          summary: `${telemetry?.cyclesCompleted ?? 0} cycles complete`,
          stats: [
            { label: 'Recipe', value: recipeLabel },
            { label: 'Orientation', value: orientationLabel },
            { label: 'Input buffer', value: String(structure.input ?? 0) },
            { label: 'Output buffer', value: String(structure.outputBuffer ?? 0) },
            { label: 'Cycles done', value: String(telemetry?.cyclesCompleted ?? 0) },
            { label: 'Consumed', value: String(telemetry?.itemsConsumed ?? 0) },
            { label: 'Uptime', value: `${Math.round(uptime * 100)}%` },
            { label: 'Waiting', value: `${Math.round(waiting * 100)}%` },
            { label: 'Last output', value: formatTickValue(telemetry?.lastOutputTick ?? null) },
          ],
        });
        break;
      }
      case FactoryKind.STORAGE: {
        const contents = structure.contents ?? new Map();
        const totalStored = [...contents.values()].reduce((sum, value) => sum + value, 0);
        entries.push({
          tileIdx,
          kind: structure.kind,
          title: `${meta.icon} ${meta.name} (${orientationLabel})`,
          coords,
          summary: `${totalStored} items stored`,
          stats: [
            { label: 'Orientation', value: orientationLabel },
            { label: 'Stored total', value: String(totalStored) },
            { label: 'Contents', value: mapContentsToSummary(contents) },
            { label: 'Deliveries', value: String(telemetry?.deliveries ?? 0) },
            { label: 'Last delivery', value: formatTickValue(telemetry?.lastDeliveryTick ?? null) },
            { label: 'Last item', value: factoryItemLabel(telemetry?.lastDeliveryItem ?? null) },
          ],
        });
        break;
      }
      default: {
        entries.push({
          tileIdx,
          kind: structure.kind,
          title: `${meta.icon} ${meta.name} (${orientationLabel})`,
          coords,
          summary: `Created ${lifetime} ticks ago`,
          stats: [
            { label: 'Orientation', value: orientationLabel },
            { label: 'Lifetime ticks', value: String(lifetime) },
          ],
        });
        break;
      }
    }
  }

  entries.sort((a, b) => (a.tileIdx ?? 0) - (b.tileIdx ?? 0));

  return { tick: ticks, entries };
}

export function getFactoryStatus(){
  const factory = ensureFactoryState();
  const produced = factory.stats.produced || {};
  const stored = factory.stats.stored || {};
  return {
    orientation: factory.orientation,
    orientationLabel: getOrientationLabel(factory.orientation),
    produced: {
      ore: produced[FactoryItem.IRON_ORE] ?? 0,
      ingot: produced[FactoryItem.IRON_INGOT] ?? 0,
      plate: produced[FactoryItem.PLATE] ?? 0,
    },
    stored: {
      ore: stored[FactoryItem.IRON_ORE] ?? 0,
      ingot: stored[FactoryItem.IRON_INGOT] ?? 0,
      plate: stored[FactoryItem.PLATE] ?? 0,
    },
    nodes: factory.nodes.size,
    structures: factory.structures.size,
    constructorComplete: factory.stats.constructorComplete ?? (stored[FactoryItem.PLATE] ?? 0),
    jobsCompleted: factory.stats.jobsCompleted ?? 0,
  };
}

export function getActiveOrientation(){
  const factory = ensureFactoryState();
  return factory.orientation;
}

export function setActiveOrientation(value){
  const factory = ensureFactoryState();
  factory.orientation = normaliseOrientation(value);
  return factory.orientation;
}

export function rotateActiveOrientation(step = 1){
  const factory = ensureFactoryState();
  const current = normaliseOrientation(factory.orientation);
  const index = ORIENTATIONS.indexOf(current);
  const next = ORIENTATIONS[(index + step + ORIENTATIONS.length) % ORIENTATIONS.length];
  factory.orientation = next;
  return next;
}

export function getOrientationLabelText(){
  return getOrientationLabel(getActiveOrientation());
}

export function getOrientationVector(orientation){
  return orientationToVector(normaliseOrientation(orientation));
}

export function getOrientationAngle(orientation){
  return orientationToAngle(normaliseOrientation(orientation));
}

export function isFactoryMode(mode){
  return FACTORY_MODE_SET.has(mode);
}

let workerSpawner = null;

export function setFactoryWorkerSpawner(fn){
  workerSpawner = typeof fn === 'function' ? fn : null;
}

export function getFactoryWorkers(){
  const factory = ensureFactoryState();
  return {
    workers: factory.workers,
    agents: factory.workerAgents ?? [],
  };
}

export function spawnFactoryWorker(tileIdx){
  const factory = ensureFactoryState();
  const id = (factory.nextWorkerId = ((factory.nextWorkerId ?? 1) + 1));
  const agent = instantiateWorkerAgent(tileIdx);
  const worker = {
    id,
    tileIdx: Number.isFinite(tileIdx) ? tileIdx | 0 : null,
    state: 'idle',
    job: null,
    dwell: 0,
    carriedItem: null,
    pendingDuration: 0,
    path: [],
    agentId: agent?.id ?? null,
  };
  factory.workers.push(worker);
  if(agent){
    if(!factory.workerAgents){
      factory.workerAgents = [];
    }
    factory.workerAgents.push({ workerId: id, agent });
  }
  if(worker.tileIdx != null){
    setWorkerPosition(worker, worker.tileIdx);
  }
  return { ok: true, worker };
}

function assignJobToWorker(worker, factory){
  if(worker.state !== 'idle') return;
  const job = popFactoryJob();
  if(!job) return;
  worker.job = job;
  const payload = job.payload ?? {};
  const duration = Number.isFinite(payload.duration) && payload.duration > 0 ? Math.floor(payload.duration) : 1;
  worker.pendingDuration = duration;
  worker.path = [];
  if(job.tileIdx != null){
    const startIdx = worker.tileIdx ?? job.tileIdx;
    const path = findFactoryPath(startIdx, job.tileIdx);
    if(path == null){
      enqueueFactoryJob(job);
      worker.job = null;
      worker.pendingDuration = 0;
      return;
    }
    if(path.length){
      worker.path = path;
      worker.state = 'moving';
      return;
    }
  }
  startWorkerAction(worker);
}

function completeWorkerJob(worker, factory){
  if(worker.job){
    handleWorkerJobEffect(worker, factory);
    factory.stats.jobsCompleted = (factory.stats.jobsCompleted ?? 0) + 1;
  }
  worker.job = null;
  worker.state = 'idle';
  worker.dwell = 0;
  worker.pendingDuration = 0;
  worker.path = [];
}

export function stepFactoryWorkers(){
  const factory = ensureFactoryState();
  if(!factory.workers.length) return;
  for(const worker of factory.workers){
    if(worker.state === 'idle'){
      assignJobToWorker(worker, factory);
    }
    if(worker.state === 'moving'){
      if(worker.path.length === 0){
        startWorkerAction(worker);
      } else {
        const nextTile = worker.path.shift();
        setWorkerPosition(worker, nextTile);
        if(worker.path.length === 0){
          startWorkerAction(worker);
        }
      }
    }
    if(worker.state === 'working'){
      worker.dwell = Math.max(0, (worker.dwell ?? 0) - 1);
      if(worker.dwell === 0){
        completeWorkerJob(worker, factory);
      }
    }
  }
}

function instantiateWorkerAgent(tileIdx){
  if(workerSpawner){
    return workerSpawner(tileIdx);
  }
  return null;
}

function startWorkerAction(worker){
  worker.state = 'working';
  worker.dwell = worker.pendingDuration > 0 ? worker.pendingDuration : 1;
  worker.pendingDuration = 0;
}

function handleWorkerJobEffect(worker, factory){
  const job = worker.job;
  if(!job) return;
  switch(job.kind){
    case 'mine': {
      worker.carriedItem = FactoryItem.IRON_ORE;
      incrementCounter(factory.stats.produced, FactoryItem.IRON_ORE, 1);
      const source = job.payload?.sourceStructure;
      if(typeof source === 'number'){
        const miner = factory.structures.get(source);
        if(miner){
          miner.jobAssigned = false;
          const minerTelemetry = ensureStructureTelemetry(miner);
          if(minerTelemetry){
            minerTelemetry.oreExtracted = (minerTelemetry.oreExtracted ?? 0) + 1;
            minerTelemetry.lastOutputTick = factory.ticks ?? 0;
          }
        }
      }
      const nodeTile = job.tileIdx;
      if(typeof nodeTile === 'number'){
        const node = factory.nodes.get(nodeTile);
        if(node){
          if(!node.telemetry){
            node.telemetry = createNodeTelemetry();
          }
          node.telemetry.mined = (node.telemetry.mined ?? 0) + 1;
          node.telemetry.lastMinedTick = factory.ticks ?? 0;
        }
      }
      const targetTile = job.payload?.targetStructure;
      if(targetTile != null){
        enqueueFactoryJob({
          kind: 'deliver',
          tileIdx: targetTile,
          payload: {
            item: FactoryItem.IRON_ORE,
            duration: 1,
            targetStructure: targetTile,
          },
        });
      }
      break;
    }
    case 'pull': {
      const sourceIdx = job.payload?.source ?? job.tileIdx;
      const targetIdx = job.payload?.target;
      const requiredItem = job.payload?.item;
      const sourceStructure = factory.structures.get(sourceIdx ?? -1);
      if(!sourceStructure){
        const targetStructure = factory.structures.get(targetIdx ?? -1);
        if(targetStructure) targetStructure.pendingInputJob = false;
        return;
      }
      let itemTaken = null;
      if(sourceStructure.kind === FactoryKind.BELT && sourceStructure.item){
        if(!requiredItem || sourceStructure.item === requiredItem){
          itemTaken = sourceStructure.item;
          sourceStructure.item = null;
          sourceStructure.progress = 0;
          const beltTelemetry = ensureStructureTelemetry(sourceStructure);
          if(beltTelemetry){
            beltTelemetry.itemsPulled = (beltTelemetry.itemsPulled ?? 0) + 1;
            beltTelemetry.lastMovedTick = factory.ticks ?? 0;
            beltTelemetry.lastMovedItem = itemTaken;
            beltTelemetry.currentItem = null;
          }
        }
      }
      if(itemTaken){
        worker.carriedItem = itemTaken;
        enqueueFactoryJob({
          kind: 'deliver',
          tileIdx: targetIdx,
          payload: {
            item: itemTaken,
            duration: job.payload?.duration ?? 1,
            targetStructure: targetIdx,
          },
        });
      } else {
        const targetStructure = factory.structures.get(targetIdx ?? -1);
        if(targetStructure) targetStructure.pendingInputJob = false;
        enqueueFactoryJob(job);
      }
      break;
    }
    case 'pickup-output': {
      const structure = factory.structures.get(job.tileIdx ?? -1);
      const outputItem = job.payload?.item ?? null;
      if(!structure || !structure.outputBuffer){
        if(structure) structure.pendingOutputJob = false;
        return;
      }
      structure.outputBuffer -= 1;
      structure.pendingOutputJob = false;
      const telemetry = ensureStructureTelemetry(structure);
      if(telemetry){
        telemetry.outputBuffer = structure.outputBuffer ?? 0;
        telemetry.outputsPicked = (telemetry.outputsPicked ?? 0) + 1;
      }
      const carryItem = outputItem ?? FactoryItem.IRON_INGOT;
      worker.carriedItem = carryItem;
      const targetIdx = job.payload?.target;
      if(targetIdx != null){
        enqueueFactoryJob({
          kind: 'deliver',
          tileIdx: targetIdx,
          payload: {
            item: carryItem,
            duration: job.payload?.duration ?? 1,
            targetStructure: targetIdx,
          },
        });
      }
      break;
    }
    case 'deliver': {
      if(job.payload?.item){
        const delivered = job.payload.item;
        const target = factory.structures.get(job.tileIdx ?? -1);
        if(target){
          const accepted = acceptItem(target, job.tileIdx, delivered, factory);
          if(accepted){
            worker.carriedItem = null;
            if('pendingInputJob' in target){
              target.pendingInputJob = false;
            }
          } else {
            enqueueFactoryJob(job);
            return;
          }
        } else {
          enqueueFactoryJob(job);
          return;
        }
      }
      break;
    }
    default:
      break;
  }
}

function tileIdxToPoint(tileIdx){
  return {
    x: tileIdx % world.W,
    y: (tileIdx / world.W) | 0,
  };
}

function setWorkerPosition(worker, tileIdx){
  worker.tileIdx = tileIdx;
  const agentRef = ensureFactoryState().workerAgents?.find(entry => entry.workerId === worker.id);
  if(agentRef && agentRef.agent){
    const coords = tileIdxToPoint(tileIdx);
    if(agentRef.agent.x != null) agentRef.agent.x = coords.x;
    if(agentRef.agent.y != null) agentRef.agent.y = coords.y;
  }
}

function findFactoryPath(startIdx, targetIdx){
  if(startIdx == null || targetIdx == null) return null;
  if(startIdx === targetIdx) return [];
  const queue = [startIdx];
  const cameFrom = new Map([[startIdx, null]]);
  while(queue.length){
    const current = queue.shift();
    if(current === targetIdx){
      const path = [];
      let node = targetIdx;
      while(node !== startIdx && node != null){
        path.push(node);
        node = cameFrom.get(node) ?? null;
      }
      path.reverse();
      return path;
    }
    const cx = current % world.W;
    const cy = (current / world.W) | 0;
    for(const [dx,dy] of DIRS4){
      const nx = cx + dx;
      const ny = cy + dy;
      if(!inBounds(nx, ny)) continue;
      const ni = idx(nx, ny);
      if(world.wall?.[ni]) continue;
      if(!cameFrom.has(ni)){
        cameFrom.set(ni, current);
        queue.push(ni);
      }
    }
  }
  return null;
}
