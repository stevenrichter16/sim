import { Mode, DIRS4, clamp01 } from './constants.js';
import { world, idx, inBounds } from './state.js';
import { FACTIONS } from './factions.js';
import { baseStringFor } from './materials.js';
import {
  createCloudClusterRegistry,
  ensureRegistry as ensureCloudClusterRegistry,
} from './cloudCluster/registry.js';
import { CloudFactoryPortDirection } from './cloudCluster/domain/factoryObject.js';
import {
  createCluster as createCloudCluster,
  upsertFactoryObject as upsertCloudFactoryObject,
  removeFactoryObject as removeCloudFactoryObject,
  upsertLink as upsertCloudClusterLink,
  removeLink as removeCloudClusterLink,
} from './cloudCluster/domain/cluster.js';
import {
  stepCloudClusterSimulation,
  updateClusterAccumulatorMembership,
} from './cloudCluster/sim/index.js';

export const FactoryKind = Object.freeze({
  NODE: 'node',
  MINER: 'miner',
  BELT: 'belt',
  SMELTER: 'smelter',
  CONSTRUCTOR: 'constructor',
  STORAGE: 'storage',
});

export const FactoryItem = Object.freeze({
  SKIN_PATCH: 'skin_patch',
  BLOOD_VIAL: 'blood_vial',
  ORGAN_MASS: 'organ_mass',
  BODY_SYSTEM: 'body_system',
  HUMAN_SHELL: 'human_shell',
  NERVE_THREAD: 'nerve_thread',
  BONE_FRAGMENT: 'bone_fragment',
  GLAND_SEED: 'gland_seed',
  NEURAL_WEAVE: 'neural_weave',
  SKELETAL_FRAME: 'skeletal_frame',
  GLANDULAR_NETWORK: 'glandular_network',
  CARETAKER_DRONE: 'caretaker_drone',
  EMISSARY_AVATAR: 'emissary_avatar',
});

const ItemStage = Object.freeze({
  HARVEST: 'harvest',
  BIOFORGE: 'bioforge',
  CONSTRUCT: 'construct',
});

const FACTORY_ITEM_META = Object.freeze({
  [FactoryItem.SKIN_PATCH]: {
    label: 'Skin Patch',
    stage: ItemStage.HARVEST,
    description: 'Dermal graft segments shaved from willing faction donors.',
  },
  [FactoryItem.BLOOD_VIAL]: {
    label: 'Blood Vial',
    stage: ItemStage.HARVEST,
    description: 'Stabilised haem reserves suspended in oxygenated gel.',
  },
  [FactoryItem.ORGAN_MASS]: {
    label: 'Organ Mass',
    stage: ItemStage.HARVEST,
    description: 'Amorphous visceral tissue primed for sculpting new anatomy.',
  },
  [FactoryItem.NERVE_THREAD]: {
    label: 'Nerve Thread',
    stage: ItemStage.HARVEST,
    description: 'Axonal spindles teased from synapse nodes for neural looms.',
  },
  [FactoryItem.BONE_FRAGMENT]: {
    label: 'Osteo Fragment',
    stage: ItemStage.HARVEST,
    description: 'Calcified lattice dust, ideal for printing skeletal frames.',
  },
  [FactoryItem.GLAND_SEED]: {
    label: 'Gland Seed',
    stage: ItemStage.HARVEST,
    description: 'Endocrine starter pods infused with hormonal catalysts.',
  },
  [FactoryItem.BODY_SYSTEM]: {
    label: 'Body System Capsule',
    stage: ItemStage.BIOFORGE,
    description: 'Multi-organ capsules ready to dock into a waiting chassis.',
  },
  [FactoryItem.NEURAL_WEAVE]: {
    label: 'Neural Weave',
    stage: ItemStage.BIOFORGE,
    description: 'Bioelectric mesh woven from nerve threads and blood serum.',
  },
  [FactoryItem.SKELETAL_FRAME]: {
    label: 'Skeletal Frame',
    stage: ItemStage.BIOFORGE,
    description: 'Rigid osteo scaffolds pressed into humanoid proportions.',
  },
  [FactoryItem.GLANDULAR_NETWORK]: {
    label: 'Glandular Network',
    stage: ItemStage.BIOFORGE,
    description: 'Regulatory endocrine clusters that temper emergent agents.',
  },
  [FactoryItem.HUMAN_SHELL]: {
    label: 'Constructed Human',
    stage: ItemStage.CONSTRUCT,
    description: 'Baseline faction recruit assembled from modular systems.',
  },
  [FactoryItem.CARETAKER_DRONE]: {
    label: 'Caretaker Drone',
    stage: ItemStage.CONSTRUCT,
    description: 'Med-tech assistant that shepherds newborn agents to safety.',
  },
  [FactoryItem.EMISSARY_AVATAR]: {
    label: 'Emissary Avatar',
    stage: ItemStage.CONSTRUCT,
    description: 'Diplomatic synth grown for negotiation bursts and envoy duty.',
  },
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
const FACTORY_INFLUENCE_THRESHOLD = 0.05;
const CLOUD_CLUSTER_AUTO_LINK_PREFIX = 'auto:faction:';
const NODE_OUTPUT_PORT_ID = 'out';
const SMELTER_INPUT_PORT_ID = 'in';
const SMELTER_OUTPUT_PORT_ID = 'out';
const DEFAULT_INPUT_PORT_ID = 'in';
const DEFAULT_OUTPUT_PORT_ID = 'out';

function createRecipeDefinition({ key, label, description, inputs, output, speed, stage }){
  const map = new Map();
  if(Array.isArray(inputs)){
    for(const [item, amount] of inputs){
      if(item == null || amount == null) continue;
      map.set(item, amount);
    }
  }
  return Object.freeze({ key, label, description, inputs: map, output, speed, stage });
}

const BIOFORGE_RECIPES = Object.freeze({
  body_system: createRecipeDefinition({
    key: 'body_system',
    label: 'Body System Capsule',
    description: 'Tri-fold infusion of dermal, blood, and visceral stock into sealed systems.',
    inputs: [
      [FactoryItem.SKIN_PATCH, 1],
      [FactoryItem.BLOOD_VIAL, 1],
      [FactoryItem.ORGAN_MASS, 1],
    ],
    output: FactoryItem.BODY_SYSTEM,
    speed: 1 / SMELTER_TIME,
    stage: ItemStage.BIOFORGE,
  }),
  neural_weave: createRecipeDefinition({
    key: 'neural_weave',
    label: 'Neural Weave Loom',
    description: 'Spins nerve thread through blood serum into sentient-ready wiring.',
    inputs: [
      [FactoryItem.NERVE_THREAD, 2],
      [FactoryItem.BLOOD_VIAL, 1],
    ],
    output: FactoryItem.NEURAL_WEAVE,
    speed: 1 / (SMELTER_TIME * 1.2),
    stage: ItemStage.BIOFORGE,
  }),
  skeletal_frame: createRecipeDefinition({
    key: 'skeletal_frame',
    label: 'Osteo Frame Press',
    description: 'Compresses osteo fragments and dermal binding into rigid frames.',
    inputs: [
      [FactoryItem.BONE_FRAGMENT, 2],
      [FactoryItem.SKIN_PATCH, 1],
    ],
    output: FactoryItem.SKELETAL_FRAME,
    speed: 1 / (SMELTER_TIME * 1.35),
    stage: ItemStage.BIOFORGE,
  }),
  glandular_network: createRecipeDefinition({
    key: 'glandular_network',
    label: 'Endocrine Bloom',
    description: 'Coaxes gland seeds and organ mass into hormonal regulatory webs.',
    inputs: [
      [FactoryItem.GLAND_SEED, 2],
      [FactoryItem.ORGAN_MASS, 1],
    ],
    output: FactoryItem.GLANDULAR_NETWORK,
    speed: 1 / (SMELTER_TIME * 1.5),
    stage: ItemStage.BIOFORGE,
  }),
});

const CONSTRUCTOR_BLUEPRINTS = Object.freeze({
  human_shell: createRecipeDefinition({
    key: 'human_shell',
    label: 'Baseline Recruit',
    description: 'Standardised recruit frame seeded with three body systems.',
    inputs: [[FactoryItem.BODY_SYSTEM, 3]],
    output: FactoryItem.HUMAN_SHELL,
    speed: 1 / CONSTRUCTOR_TIME,
    stage: ItemStage.CONSTRUCT,
  }),
  caretaker_drone: createRecipeDefinition({
    key: 'caretaker_drone',
    label: 'Caretaker Drone',
    description: 'Pairs neural weave with skeletal frame for med-tech chassis.',
    inputs: [
      [FactoryItem.NEURAL_WEAVE, 1],
      [FactoryItem.SKELETAL_FRAME, 1],
    ],
    output: FactoryItem.CARETAKER_DRONE,
    speed: 1 / (CONSTRUCTOR_TIME * 1.25),
    stage: ItemStage.CONSTRUCT,
  }),
  emissary_avatar: createRecipeDefinition({
    key: 'emissary_avatar',
    label: 'Emissary Avatar',
    description: 'An envoy-grade synth mixing systems with endocrine and neural webs.',
    inputs: [
      [FactoryItem.BODY_SYSTEM, 2],
      [FactoryItem.NEURAL_WEAVE, 1],
      [FactoryItem.GLANDULAR_NETWORK, 1],
    ],
    output: FactoryItem.EMISSARY_AVATAR,
    speed: 1 / (CONSTRUCTOR_TIME * 1.75),
    stage: ItemStage.CONSTRUCT,
  }),
});

const FACTORY_KIND_META = Object.freeze({
  [FactoryKind.NODE]: { icon: '🧬', name: 'Biological Node' },
  [FactoryKind.MINER]: { icon: '🩺', name: 'Harvest Surgeon' },
  [FactoryKind.BELT]: { icon: '🫀', name: 'Vein Conveyor' },
  [FactoryKind.SMELTER]: { icon: '🧪', name: 'Bioforge Vat' },
  [FactoryKind.CONSTRUCTOR]: { icon: '🧍', name: 'Anthropo Constructor' },
  [FactoryKind.STORAGE]: { icon: '🛏️', name: 'Cradle Vault' },
});

const DEFAULT_BIOFORGE_RECIPE = BIOFORGE_RECIPES.body_system;
const DEFAULT_CONSTRUCTOR_BLUEPRINT = CONSTRUCTOR_BLUEPRINTS.human_shell;

function getBioforgeRecipe(key){
  if(key && BIOFORGE_RECIPES[key]){
    return BIOFORGE_RECIPES[key];
  }
  return DEFAULT_BIOFORGE_RECIPE;
}

function getConstructorBlueprint(key){
  if(key && CONSTRUCTOR_BLUEPRINTS[key]){
    return CONSTRUCTOR_BLUEPRINTS[key];
  }
  return DEFAULT_CONSTRUCTOR_BLUEPRINT;
}

function factoryKindMeta(kind){
  return FACTORY_KIND_META[kind] || { icon: '❓', name: kind ?? 'Unknown' };
}

function factoryItemLabel(item){
  const meta = item && FACTORY_ITEM_META[item];
  if(meta?.label){
    return meta.label;
  }
  if(typeof item === 'string'){
    return item.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  return '—';
}

function describeRecipe(recipe){
  if(!recipe) return null;
  return {
    key: recipe.key,
    label: recipe.label ?? factoryItemLabel(recipe.output),
    description: recipe.description ?? '',
    output: recipe.output,
    outputLabel: factoryItemLabel(recipe.output),
    stage: recipe.stage ?? null,
    inputs: normaliseRecipeInputs(recipe.inputs),
  };
}

function snapshotRecipeDefinition(recipe){
  if(!recipe) return null;
  return {
    key: recipe.key,
    label: recipe.label ?? factoryItemLabel(recipe.output),
    description: recipe.description ?? '',
    output: recipe.output,
    outputLabel: factoryItemLabel(recipe.output),
    speed: recipe.speed ?? 0,
    stage: recipe.stage ?? null,
    inputs: normaliseRecipeInputs(recipe.inputs),
  };
}

function normaliseRecipeInputs(inputs){
  const result = [];
  if(!inputs) return result;
  if(inputs instanceof Map){
    for(const [item, amount] of inputs.entries()){
      result.push({ item, amount, label: factoryItemLabel(item) });
    }
    return result;
  }
  if(Array.isArray(inputs)){
    for(const entry of inputs){
      if(entry == null) continue;
      const item = entry.item ?? entry[0] ?? null;
      const amount = Number.isFinite(entry.amount) ? entry.amount : Number.isFinite(entry[1]) ? entry[1] : 1;
      result.push({ item, amount, label: factoryItemLabel(entry.label ?? item) });
    }
    return result;
  }
  if(typeof inputs === 'object'){
    for(const [item, amount] of Object.entries(inputs)){
      result.push({ item, amount, label: factoryItemLabel(item) });
    }
  }
  return result;
}

function getRecipeInputMap(recipe){
  if(!recipe?.inputs) return new Map();
  if(recipe.inputs instanceof Map) return recipe.inputs;
  const map = new Map();
  if(Array.isArray(recipe.inputs)){
    for(const entry of recipe.inputs){
      if(entry == null) continue;
      const item = entry.item ?? entry[0];
      if(item == null) continue;
      const amount = Number.isFinite(entry.amount)
        ? entry.amount
        : Number.isFinite(entry[1])
          ? entry[1]
          : 1;
      map.set(item, amount);
    }
    return map;
  }
  if(typeof recipe.inputs === 'object'){
    for(const [item, value] of Object.entries(recipe.inputs)){
      if(item == null) continue;
      map.set(item, Number.isFinite(value) ? value : 1);
    }
    return map;
  }
  return map;
}

const FACTORY_CATALOG = Object.freeze({
  harvestables: Object.entries(FACTORY_ITEM_META)
    .filter(([, meta]) => meta.stage === ItemStage.HARVEST)
    .map(([item, meta]) => ({
      item,
      label: meta.label,
      description: meta.description,
    })),
  bioforge: Object.values(BIOFORGE_RECIPES).map(describeRecipe),
  constructs: Object.values(CONSTRUCTOR_BLUEPRINTS).map(describeRecipe),
});

function createStructureTelemetry(kind){
  const factory = ensureFactoryState();
  const tick = factory.ticks ?? 0;
  switch(kind){
    case FactoryKind.MINER:
      return {
        kind,
        createdTick: tick,
        jobsQueued: 0,
        essenceExtracted: 0,
        totalTicks: 0,
        activeTicks: 0,
        lastJobTick: null,
        lastOutputTick: null,
        lastOutputItem: null,
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
    lastOutputItem: null,
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

function formatRecipeDisplay(recipe){
  if(!recipe) return '—';
  const inputs = [];
  if(recipe.inputs instanceof Map){
    for(const [item, amount] of recipe.inputs.entries()){
      inputs.push(`${factoryItemLabel(item)} ×${amount}`);
    }
  }
  const inputText = inputs.length ? inputs.join(' + ') : '—';
  return `${inputText} → ${factoryItemLabel(recipe.output)}`;
}

const BRUSH_SPEC = Object.freeze({
  'factory-node': {
    kind: FactoryKind.NODE,
    mode: Mode.FACTORY_NODE,
    resource: FactoryItem.SKIN_PATCH,
    label: 'Dermal Node',
  },
  'factory-node-skin': {
    kind: FactoryKind.NODE,
    mode: Mode.FACTORY_NODE,
    resource: FactoryItem.SKIN_PATCH,
    label: 'Dermal Node',
  },
  'factory-node-blood': {
    kind: FactoryKind.NODE,
    mode: Mode.FACTORY_NODE,
    resource: FactoryItem.BLOOD_VIAL,
    label: 'Bloodwell Node',
  },
  'factory-node-organ': {
    kind: FactoryKind.NODE,
    mode: Mode.FACTORY_NODE,
    resource: FactoryItem.ORGAN_MASS,
    label: 'Organ Bloom Node',
  },
  'factory-node-nerve': {
    kind: FactoryKind.NODE,
    mode: Mode.FACTORY_NODE,
    resource: FactoryItem.NERVE_THREAD,
    label: 'Synapse Node',
  },
  'factory-node-bone': {
    kind: FactoryKind.NODE,
    mode: Mode.FACTORY_NODE,
    resource: FactoryItem.BONE_FRAGMENT,
    label: 'Osteo Node',
  },
  'factory-node-gland': {
    kind: FactoryKind.NODE,
    mode: Mode.FACTORY_NODE,
    resource: FactoryItem.GLAND_SEED,
    label: 'Endocrine Node',
  },
  'factory-miner': {
    kind: FactoryKind.MINER,
    mode: Mode.FACTORY_MINER,
  },
  'factory-belt': {
    kind: FactoryKind.BELT,
    mode: Mode.FACTORY_BELT,
  },
  /* Legacy smelter brushes retained for reference:
  'factory-smelter': {
    kind: FactoryKind.SMELTER,
    mode: Mode.FACTORY_SMELTER,
    recipeKey: 'body_system',
  },
  'factory-smelter-neural': {
    kind: FactoryKind.SMELTER,
    mode: Mode.FACTORY_SMELTER,
    recipeKey: 'neural_weave',
  },
  'factory-smelter-frame': {
    kind: FactoryKind.SMELTER,
    mode: Mode.FACTORY_SMELTER,
    recipeKey: 'skeletal_frame',
  },
  'factory-smelter-gland': {
    kind: FactoryKind.SMELTER,
    mode: Mode.FACTORY_SMELTER,
    recipeKey: 'glandular_network',
  },
  */
  'factory-smelter-omni': {
    kind: FactoryKind.SMELTER,
    mode: Mode.FACTORY_SMELTER,
    recipeKey: 'body_system',
    recipeKeys: ['body_system', 'neural_weave', 'skeletal_frame', 'glandular_network'],
  },
  'factory-constructor': {
    kind: FactoryKind.CONSTRUCTOR,
    mode: Mode.FACTORY_CONSTRUCTOR,
    recipeKey: 'human_shell',
    recipeKeys: ['human_shell', 'caretaker_drone', 'emissary_avatar'],
  },
  'factory-storage': {
    kind: FactoryKind.STORAGE,
    mode: Mode.FACTORY_STORAGE,
  },
});

function createFactoryState(){
  const state = {
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
    cloudClusters: createCloudClusterRegistry(),
    ownershipRecords: [],
    ownershipByFaction: new Map(),
    unassignedOwnership: [],
  };
  return state;
}

export function resetFactoryState(){
  world.factory = createFactoryState();
  refreshFactoryOwnership();
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
        progress: 0,
        active: false,
        outputBuffer: 0,
        inputBuffer: new Map(),
        pendingInputJob: new Set(),
        pendingOutputJob: false,
        currentCycle: null,
        recipe: DEFAULT_BIOFORGE_RECIPE,
        recipeKey: DEFAULT_BIOFORGE_RECIPE.key,
        availableRecipeKeys: null,
        activeRecipeIndex: 0,
        allowedInputItems: null,
        telemetry,
      };
    case FactoryKind.CONSTRUCTOR: {
      const availableKeys = Object.keys(CONSTRUCTOR_BLUEPRINTS);
      const defaultIndex = Math.max(0, availableKeys.indexOf(DEFAULT_CONSTRUCTOR_BLUEPRINT.key));
      return {
        kind,
        orientation,
        progress: 0,
        active: false,
        outputBuffer: 0,
        inputBuffer: new Map(),
        pendingInputJob: new Set(),
        pendingOutputJob: false,
        currentCycle: null,
        recipe: DEFAULT_CONSTRUCTOR_BLUEPRINT,
        recipeKey: DEFAULT_CONSTRUCTOR_BLUEPRINT.key,
        availableRecipeKeys: availableKeys,
        activeRecipeIndex: defaultIndex,
        allowedInputItems: buildAllowedInputItemSet(availableKeys, getConstructorBlueprint),
        telemetry,
      };
    }
    case FactoryKind.STORAGE:
      return { kind, orientation, contents: new Map(), telemetry };
    default:
      return { kind, orientation, telemetry };
  }
}

function createNode(resource){
  return { resource, telemetry: createNodeTelemetry() };
}

function getStructureInputBuffer(structure){
  if(!structure) return new Map();
  if(!structure.inputBuffer){
    structure.inputBuffer = new Map();
  }
  return structure.inputBuffer;
}

function totalInputCount(structure){
  const buffer = getStructureInputBuffer(structure);
  let total = 0;
  for(const value of buffer.values()){
    total += value;
  }
  return total;
}

function adjustInputBuffer(structure, item, delta){
  const buffer = getStructureInputBuffer(structure);
  const prev = buffer.get(item) ?? 0;
  const next = prev + delta;
  if(next <= 0){
    buffer.delete(item);
    return 0;
  }
  buffer.set(item, next);
  return next;
}

function hasRequiredInputs(structure){
  const recipe = structure?.recipe;
  if(!recipe) return false;
  const requirements = getRecipeInputMap(recipe);
  const buffer = getStructureInputBuffer(structure);
  for(const [item, amount] of requirements.entries()){
    if((buffer.get(item) ?? 0) < (amount ?? 0)){
      return false;
    }
  }
  return true;
}

function hasInputsForRecipe(buffer, recipe){
  if(!recipe) return false;
  const requirements = getRecipeInputMap(recipe);
  for(const [item, amount] of requirements.entries()){
    if((buffer.get(item) ?? 0) < (amount ?? 0)){
      return false;
    }
  }
  return true;
}

function computeRecipeMatchScore(buffer, recipe){
  const requirements = getRecipeInputMap(recipe);
  if(!requirements.size) return 0;
  let score = 0;
  for(const [item, amount] of requirements.entries()){
    const have = buffer.get(item) ?? 0;
    if(have <= 0) continue;
    score += Math.min(have / (amount || 1), 1);
  }
  return score / requirements.size;
}

function ensureActiveSmelterRecipe(structure){
  if(!structure || structure.kind !== FactoryKind.SMELTER) return structure?.recipe ?? null;
  const keys = Array.isArray(structure.availableRecipeKeys) ? structure.availableRecipeKeys : null;
  if(!keys || !keys.length) return structure.recipe;
  if(!structure.allowedInputItems){
    structure.allowedInputItems = buildAllowedInputItemSet(keys);
  }
  const buffer = getStructureInputBuffer(structure);
  const startIndex = typeof structure.activeRecipeIndex === 'number' ? structure.activeRecipeIndex : 0;
  let bestRecipe = structure.recipe ?? null;
  let bestScore = bestRecipe ? computeRecipeMatchScore(buffer, bestRecipe) : -1;
  for(let offset = 0; offset < keys.length; offset += 1){
    const index = (startIndex + offset) % keys.length;
    const key = keys[index];
    const candidate = getBioforgeRecipe(key);
    if(!candidate) continue;
    if(hasInputsForRecipe(buffer, candidate)){
      structure.recipe = candidate;
      structure.recipeKey = candidate.key;
      structure.activeRecipeIndex = index;
      return candidate;
    }
    const score = computeRecipeMatchScore(buffer, candidate);
    if(score > bestScore || (!bestRecipe && score >= 0)){
      bestRecipe = candidate;
      bestScore = score;
      structure.activeRecipeIndex = index;
    }
  }
  if(!bestRecipe && keys.length){
    bestRecipe = getBioforgeRecipe(keys[0]);
    structure.activeRecipeIndex = 0;
  }
  if(bestRecipe){
    structure.recipe = bestRecipe;
    structure.recipeKey = bestRecipe.key;
  }
  return structure.recipe;
}

function ensureActiveConstructorBlueprint(structure){
  if(!structure || structure.kind !== FactoryKind.CONSTRUCTOR) return structure?.recipe ?? null;
  const keys = Array.isArray(structure.availableRecipeKeys) ? structure.availableRecipeKeys : null;
  if(!keys || !keys.length) return structure.recipe;
  if(!structure.allowedInputItems){
    structure.allowedInputItems = buildAllowedInputItemSet(keys, getConstructorBlueprint);
  }
  const buffer = getStructureInputBuffer(structure);
  const startIndex = typeof structure.activeRecipeIndex === 'number' ? structure.activeRecipeIndex : 0;
  let bestRecipe = structure.recipe ?? null;
  let bestScore = bestRecipe ? computeRecipeMatchScore(buffer, bestRecipe) : -1;
  for(let offset = 0; offset < keys.length; offset += 1){
    const index = (startIndex + offset) % keys.length;
    const key = keys[index];
    const candidate = getConstructorBlueprint(key);
    if(!candidate) continue;
    if(hasInputsForRecipe(buffer, candidate)){
      structure.recipe = candidate;
      structure.recipeKey = candidate.key;
      structure.activeRecipeIndex = index;
      return candidate;
    }
    const score = computeRecipeMatchScore(buffer, candidate);
    if(score > bestScore || (!bestRecipe && score >= 0)){
      bestRecipe = candidate;
      bestScore = score;
      structure.activeRecipeIndex = index;
    }
  }
  if(!bestRecipe && keys.length){
    bestRecipe = getConstructorBlueprint(keys[0]);
    structure.activeRecipeIndex = 0;
  }
  if(bestRecipe){
    structure.recipe = bestRecipe;
    structure.recipeKey = bestRecipe.key;
  }
  return structure.recipe;
}

function buildAllowedInputItemSet(keys, resolver = getBioforgeRecipe){
  const items = new Set();
  for(const key of keys){
    const recipe = resolver(key);
    const inputs = getRecipeInputMap(recipe);
    for(const item of inputs.keys()){
      items.add(item);
    }
  }
  return items;
}

function consumeRecipeInputs(structure){
  const recipe = structure?.recipe;
  if(!recipe) return new Map();
  const consumed = new Map();
  for(const [item, amount] of getRecipeInputMap(recipe).entries()){
    if(!amount) continue;
    adjustInputBuffer(structure, item, -amount);
    consumed.set(item, amount);
  }
  return consumed;
}

function ensurePendingInputSet(structure){
  if(structure && !(structure.pendingInputJob instanceof Set)){
    structure.pendingInputJob = new Set();
  }
  return structure?.pendingInputJob instanceof Set ? structure.pendingInputJob : new Set();
}

function markPendingInput(structure, item){
  const set = ensurePendingInputSet(structure);
  if(item != null){
    set.add(item);
  }
  return set;
}

function clearPendingInput(structure, item){
  if(structure?.pendingInputJob instanceof Set){
    if(item != null){
      structure.pendingInputJob.delete(item);
    } else {
      structure.pendingInputJob.clear();
    }
  } else if(item == null){
    structure.pendingInputJob = false;
  }
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
      if(structure && !structure.allowedInputItems && Array.isArray(structure.availableRecipeKeys)){
        structure.allowedInputItems = buildAllowedInputItemSet(structure.availableRecipeKeys);
      }
      const recipeInputs = getRecipeInputMap(structure.recipe);
      if(!recipeInputs.has(item) && !(structure.allowedInputItems?.has(item))){
        return false;
      }
      adjustInputBuffer(structure, item, 1);
      if(structure.pendingInputJob instanceof Set){
        structure.pendingInputJob.delete(item);
      }
      if(telemetry){
        telemetry.itemsAccepted = (telemetry.itemsAccepted ?? 0) + 1;
        telemetry.lastInputTick = nowTick;
        telemetry.lastInputItem = item;
        telemetry.inputBuffer = totalInputCount(structure);
      }
      return true;
    case FactoryKind.CONSTRUCTOR:
      if(structure && !structure.allowedInputItems && Array.isArray(structure.availableRecipeKeys)){
        structure.allowedInputItems = buildAllowedInputItemSet(structure.availableRecipeKeys, getConstructorBlueprint);
      }
      const constructorInputs = getRecipeInputMap(structure.recipe);
      if(!constructorInputs.has(item) && !(structure.allowedInputItems?.has(item))){
        return false;
      }
      adjustInputBuffer(structure, item, 1);
      if(structure.pendingInputJob instanceof Set){
        structure.pendingInputJob.delete(item);
      }
      if(telemetry){
        telemetry.itemsAccepted = (telemetry.itemsAccepted ?? 0) + 1;
        telemetry.lastInputTick = nowTick;
        telemetry.lastInputItem = item;
        telemetry.inputBuffer = totalInputCount(structure);
      }
      return true;
    case FactoryKind.STORAGE: {
      const contents = structure.contents;
      contents.set(item, (contents.get(item) ?? 0) + 1);
      incrementCounter(factory.stats.stored, item, 1);
      if(item === FactoryItem.HUMAN_SHELL){
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
  if(hasRequiredInputs(structure)){
    structure.currentCycle = consumeRecipeInputs(structure);
    structure.active = true;
    structure.progress = 0;
    const telemetry = ensureStructureTelemetry(structure);
    if(telemetry){
      telemetry.cyclesStarted = (telemetry.cyclesStarted ?? 0) + 1;
      telemetry.lastCycleStartTick = factory?.ticks ?? 0;
      telemetry.inputBuffer = totalInputCount(structure);
    }
  }
}

function updateRecipeProducer(tileIdx, structure, factory){
  const recipe = structure.kind === FactoryKind.SMELTER
    ? ensureActiveSmelterRecipe(structure)
    : structure.kind === FactoryKind.CONSTRUCTOR
      ? ensureActiveConstructorBlueprint(structure)
      : structure.recipe;
  if(!recipe) return;
  const telemetry = ensureStructureTelemetry(structure);
  if(telemetry){
    telemetry.totalTicks = (telemetry.totalTicks ?? 0) + 1;
    if(structure.active){
      telemetry.activeTicks = (telemetry.activeTicks ?? 0) + 1;
    } else if((structure.pendingInputJob instanceof Set ? structure.pendingInputJob.size : structure.pendingInputJob ? 1 : 0) > 0){
      telemetry.waitingForInputTicks = (telemetry.waitingForInputTicks ?? 0) + 1;
    }
    telemetry.inputBuffer = totalInputCount(structure);
    telemetry.outputBuffer = structure.outputBuffer ?? 0;
  }
  const requirements = getRecipeInputMap(recipe);
  if(!structure.active && requirements.size){
    const opposite = ORIENTATION_OPPOSITE[structure.orientation] || 'west';
    const sourceIdx = neighborIndex(tileIdx, opposite);
    if(sourceIdx >= 0){
      const buffer = getStructureInputBuffer(structure);
      const pending = ensurePendingInputSet(structure);
      for(const [item, amount] of requirements.entries()){
        const have = buffer.get(item) ?? 0;
        if(have < (amount ?? 0) && !pending.has(item)){
          markPendingInput(structure, item);
          enqueueFactoryJob({
            kind: 'pull',
            tileIdx: sourceIdx,
            payload: {
              duration: 1,
              item,
              source: sourceIdx,
              target: tileIdx,
            },
          });
          if(telemetry){
            telemetry.inputRequests = (telemetry.inputRequests ?? 0) + 1;
            telemetry.lastInputTick = factory.ticks ?? 0;
          }
        }
      }
    }
  }
  if(!structure.active){
    if(structure.kind === FactoryKind.SMELTER){
      ensureActiveSmelterRecipe(structure);
    } else if(structure.kind === FactoryKind.CONSTRUCTOR){
      ensureActiveConstructorBlueprint(structure);
    }
    maybeStartJob(structure, factory);
  }
  if(structure.active){
    structure.progress = Math.min(1, (structure.progress ?? 0) + (recipe.speed ?? 0.1));
    if(structure.progress >= 1){
      structure.outputBuffer = (structure.outputBuffer ?? 0) + 1;
      structure.active = false;
      structure.progress = 0;
      incrementCounter(factory.stats.produced, recipe.output, 1);
      const consumedTotals = structure.currentCycle instanceof Map ? [...structure.currentCycle.values()].reduce((sum, value) => sum + value, 0) : 0;
      if(telemetry){
        telemetry.cyclesCompleted = (telemetry.cyclesCompleted ?? 0) + 1;
        telemetry.itemsConsumed = (telemetry.itemsConsumed ?? 0) + consumedTotals;
        telemetry.lastOutputTick = factory.ticks ?? 0;
        telemetry.outputBuffer = structure.outputBuffer ?? 0;
        telemetry.lastOutputItem = recipe.output;
        if(structure.currentCycle instanceof Map){
          telemetry.lastOutputMix = Object.fromEntries(structure.currentCycle.entries());
        }
      }
      structure.lastCompletedCycle = structure.currentCycle;
      structure.currentCycle = null;
      if(Array.isArray(structure.availableRecipeKeys) && structure.availableRecipeKeys.length){
        structure.activeRecipeIndex = (structure.activeRecipeIndex + 1) % structure.availableRecipeKeys.length;
        if(structure.kind === FactoryKind.SMELTER){
          ensureActiveSmelterRecipe(structure);
        } else if(structure.kind === FactoryKind.CONSTRUCTOR){
          ensureActiveConstructorBlueprint(structure);
        }
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
  stepCloudClusterSimulation({ tick: factory.ticks ?? 0 });
  refreshFactoryOwnership();
}

function resolveFactoryOwnershipAtTile(tileIdx){
  if(!Number.isFinite(tileIdx) || tileIdx < 0) return { factionId: null, dominantFactionId: null, control: 0 };
  const dom = world.dominantFaction;
  const ctrl = world.controlLevel;
  if(!dom || !ctrl || tileIdx >= dom.length || tileIdx >= ctrl.length){
    return { factionId: null, dominantFactionId: null, control: 0 };
  }
  const dominantFactionId = dom[tileIdx];
  const control = clamp01(ctrl[tileIdx] ?? 0);
  const validDominant = typeof dominantFactionId === 'number' && dominantFactionId >= 0;
  const hasOwnership = validDominant && control > FACTORY_INFLUENCE_THRESHOLD;
  return {
    factionId: hasOwnership ? dominantFactionId : null,
    dominantFactionId: validDominant ? dominantFactionId : null,
    control,
  };
}

function createOwnershipEntry({ tileIdx, type, kind, control, factionId, dominantFactionId, resource = null, orientation = null }){
  const coords = tileIdxToPoint(tileIdx);
  const entry = {
    id: `${type}:${tileIdx}:${kind ?? 'unknown'}`,
    tileIdx,
    coords,
    type,
    kind,
    control,
    factionId,
    dominantFactionId,
  };
  if(resource != null) entry.resource = resource;
  if(orientation != null) entry.orientation = orientation;
  return entry;
}

function sortOwnershipEntries(list){
  if(!Array.isArray(list)) return list;
  list.sort((a, b) => {
    const tileDelta = (a?.tileIdx ?? 0) - (b?.tileIdx ?? 0);
    if(tileDelta !== 0) return tileDelta;
    const typeDelta = String(a?.type ?? '').localeCompare(String(b?.type ?? ''));
    if(typeDelta !== 0) return typeDelta;
    return String(a?.kind ?? '').localeCompare(String(b?.kind ?? ''));
  });
  return list;
}

function ensureFactoryCloudRegistry(factory){
  const registry = ensureCloudClusterRegistry(factory?.cloudClusters);
  if(factory){
    factory.cloudClusters = registry;
  }
  return registry;
}

function clusterIdForFaction(factionId){
  return `faction-${factionId}-cloud`;
}

function clusterLabelForFaction(faction){
  if(!faction) return 'Faction Cloud';
  const key = faction.key ?? faction.id ?? '?';
  return `Faction ${key} Cloud`;
}

function ensureFactionCloudCluster(factory, faction, registry = ensureFactoryCloudRegistry(factory)){
  const clusterId = clusterIdForFaction(faction.id);
  let cluster = registry.byId.get(clusterId);
  if(!cluster){
    cluster = createCloudCluster({
      id: clusterId,
      name: clusterLabelForFaction(faction),
      description: `Autogenerated cluster for faction ${faction.key ?? faction.id}.`,
      metadata: {
        factionId: faction.id,
        factionKey: faction.key ?? null,
        auto: true,
      },
      objects: [],
      links: [],
    });
    registry.byId.set(clusterId, cluster);
  }
  if(!registry.order.includes(clusterId)){
    registry.order.push(clusterId);
  }
  return cluster;
}

function removeFactionCloudCluster(factory, factionId, registry = ensureFactoryCloudRegistry(factory)){
  const clusterId = clusterIdForFaction(factionId);
  if(!registry.byId.delete(clusterId)){
    return false;
  }
  const orderIndex = registry.order.indexOf(clusterId);
  if(orderIndex >= 0){
    registry.order.splice(orderIndex, 1);
  }
  return true;
}

function clusterObjectIdForEntry(entry){
  if(!entry || !Number.isFinite(entry.tileIdx)) return null;
  const kind = entry.kind ?? 'unknown';
  return `${entry.type ?? 'object'}-${kind}-${entry.tileIdx}`;
}

function resolveNodeResource(factory, entry){
  if(entry?.resource) return entry.resource;
  const node = factory?.nodes?.get(entry?.tileIdx);
  return node?.resource ?? null;
}

function resolveSmelterRecipe(structure){
  if(!structure) return DEFAULT_BIOFORGE_RECIPE;
  if(structure.recipe) return structure.recipe;
  if(structure.recipeKey){
    return getBioforgeRecipe(structure.recipeKey);
  }
  return DEFAULT_BIOFORGE_RECIPE;
}

function resolveConstructorBlueprint(structure){
  if(!structure) return DEFAULT_CONSTRUCTOR_BLUEPRINT;
  if(structure.recipe) return structure.recipe;
  if(structure.recipeKey){
    return getConstructorBlueprint(structure.recipeKey);
  }
  return DEFAULT_CONSTRUCTOR_BLUEPRINT;
}

function buildNodeClusterObject(entry, factory){
  const resource = resolveNodeResource(factory, entry);
  if(!resource) return null;
  const label = `${factoryItemLabel(resource)} Node`;
  return {
    id: clusterObjectIdForEntry(entry),
    kind: FactoryKind.NODE,
    label,
    description: 'Faction-controlled biological node.',
    metadata: {
      tileIdx: entry.tileIdx,
      factionId: entry.factionId,
      resource,
      control: entry.control ?? 0,
      type: entry.type,
      auto: true,
    },
    ports: [
      {
        id: NODE_OUTPUT_PORT_ID,
        direction: CloudFactoryPortDirection.OUTPUT,
        label: `${factoryItemLabel(resource)} Output`,
        itemKeys: [resource],
      },
    ],
  };
}

function buildMinerClusterObject(entry, factory){
  const resource = resolveNodeResource(factory, entry);
  const itemKeys = resource ? [resource] : [];
  const meta = factoryKindMeta(FactoryKind.MINER);
  const label = itemKeys.length
    ? `${meta.name} (${factoryItemLabel(resource)})`
    : meta.name;
  return {
    id: clusterObjectIdForEntry(entry),
    kind: FactoryKind.MINER,
    label,
    description: 'Faction-operated harvest surgeon.',
    metadata: {
      tileIdx: entry.tileIdx,
      factionId: entry.factionId,
      resource: resource ?? null,
      control: entry.control ?? 0,
      auto: true,
    },
    ports: [
      {
        id: DEFAULT_OUTPUT_PORT_ID,
        direction: CloudFactoryPortDirection.OUTPUT,
        label: itemKeys.length ? `${factoryItemLabel(resource)} Output` : 'Output',
        itemKeys,
      },
    ],
  };
}

function buildBeltClusterObject(entry){
  const meta = factoryKindMeta(FactoryKind.BELT);
  return {
    id: clusterObjectIdForEntry(entry),
    kind: FactoryKind.BELT,
    label: meta.name,
    description: 'Faction-controlled conveyor segment.',
    metadata: {
      tileIdx: entry.tileIdx,
      factionId: entry.factionId,
      control: entry.control ?? 0,
      auto: true,
    },
    ports: [
      {
        id: DEFAULT_INPUT_PORT_ID,
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Intake',
        itemKeys: [],
      },
      {
        id: DEFAULT_OUTPUT_PORT_ID,
        direction: CloudFactoryPortDirection.OUTPUT,
        label: 'Output',
        itemKeys: [],
      },
    ],
  };
}

function buildSmelterClusterObject(entry, factory){
  const structure = factory?.structures?.get(entry.tileIdx);
  const recipe = resolveSmelterRecipe(structure);
  const requiredItems = Array.from(getRecipeInputMap(recipe).keys());
  const outputItems = recipe?.output ? [recipe.output] : [];
  const meta = factoryKindMeta(FactoryKind.SMELTER);
  return {
    id: clusterObjectIdForEntry(entry),
    kind: FactoryKind.SMELTER,
    label: meta.name,
    description: 'Faction bioforge vat.',
    metadata: {
      tileIdx: entry.tileIdx,
      factionId: entry.factionId,
      recipeKey: recipe?.key ?? null,
      output: recipe?.output ?? null,
      control: entry.control ?? 0,
      auto: true,
    },
    ports: [
      {
        id: SMELTER_INPUT_PORT_ID,
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Bioforge Intake',
        itemKeys: requiredItems,
      },
      {
        id: SMELTER_OUTPUT_PORT_ID,
        direction: CloudFactoryPortDirection.OUTPUT,
        label: 'Bioforge Output',
        itemKeys: outputItems,
      },
    ],
  };
}

function buildConstructorClusterObject(entry, factory){
  const structure = factory?.structures?.get(entry.tileIdx);
  const blueprint = resolveConstructorBlueprint(structure);
  const requirements = Array.from(getRecipeInputMap(blueprint).keys());
  const outputItems = blueprint?.output ? [blueprint.output] : [];
  const meta = factoryKindMeta(FactoryKind.CONSTRUCTOR);
  const ports = [];
  if(requirements.length){
    requirements.forEach((item, index) => {
      ports.push({
        id: `${DEFAULT_INPUT_PORT_ID}-${index}`,
        direction: CloudFactoryPortDirection.INPUT,
        label: `${factoryItemLabel(item)} Intake`,
        itemKeys: item ? [item] : [],
      });
    });
  } else {
    ports.push({
      id: DEFAULT_INPUT_PORT_ID,
      direction: CloudFactoryPortDirection.INPUT,
      label: 'Intake',
      itemKeys: [],
    });
  }
  ports.push({
    id: DEFAULT_OUTPUT_PORT_ID,
    direction: CloudFactoryPortDirection.OUTPUT,
    label: outputItems.length ? `${factoryItemLabel(outputItems[0])} Output` : 'Output',
    itemKeys: outputItems,
  });
  return {
    id: clusterObjectIdForEntry(entry),
    kind: FactoryKind.CONSTRUCTOR,
    label: meta.name,
    description: 'Faction constructor array.',
    metadata: {
      tileIdx: entry.tileIdx,
      factionId: entry.factionId,
      blueprintKey: blueprint?.key ?? null,
      output: blueprint?.output ?? null,
      control: entry.control ?? 0,
      auto: true,
    },
    ports,
  };
}

function buildStorageClusterObject(entry){
  const meta = factoryKindMeta(FactoryKind.STORAGE);
  return {
    id: clusterObjectIdForEntry(entry),
    kind: FactoryKind.STORAGE,
    label: meta.name,
    description: 'Faction storage cradle.',
    metadata: {
      tileIdx: entry.tileIdx,
      factionId: entry.factionId,
      control: entry.control ?? 0,
      auto: true,
    },
    ports: [
      {
        id: DEFAULT_INPUT_PORT_ID,
        direction: CloudFactoryPortDirection.INPUT,
        label: 'Intake',
        itemKeys: [],
      },
      {
        id: DEFAULT_OUTPUT_PORT_ID,
        direction: CloudFactoryPortDirection.OUTPUT,
        label: 'Output',
        itemKeys: [],
      },
    ],
  };
}

function buildClusterObjectForOwnership(entry, factory){
  if(!entry || entry.factionId == null) return null;
  if(entry.type === 'node'){
    return buildNodeClusterObject(entry, factory);
  }
  if(entry.type !== 'structure') return null;
  switch(entry.kind){
    case FactoryKind.MINER:
      return buildMinerClusterObject(entry, factory);
    case FactoryKind.BELT:
      return buildBeltClusterObject(entry, factory);
    case FactoryKind.SMELTER:
      return buildSmelterClusterObject(entry, factory);
    case FactoryKind.CONSTRUCTOR:
      return buildConstructorClusterObject(entry, factory);
    case FactoryKind.STORAGE:
      return buildStorageClusterObject(entry);
    default:
      return {
        id: clusterObjectIdForEntry(entry),
        kind: entry.kind,
        label: factoryKindMeta(entry.kind).name,
        description: 'Faction-controlled factory object.',
        metadata: {
          tileIdx: entry.tileIdx,
          factionId: entry.factionId,
          control: entry.control ?? 0,
          auto: true,
        },
        ports: [],
      };
  }
}

function rebuildFactionClusterLinks(cluster, entries, factory){
  const autoLinkIds = [];
  for(const [linkId, link] of cluster.links.entries()){
    if(typeof linkId === 'string' && linkId.startsWith(CLOUD_CLUSTER_AUTO_LINK_PREFIX)){
      autoLinkIds.push(linkId);
      continue;
    }
    if(link?.metadata?.auto){
      autoLinkIds.push(linkId);
    }
  }
  for(const linkId of autoLinkIds){
    removeCloudClusterLink(cluster, linkId);
  }

  const nodesByItem = new Map();
  for(const entry of entries){
    if(entry.kind !== FactoryKind.NODE) continue;
    const resource = resolveNodeResource(factory, entry);
    if(!resource) continue;
    const objectId = clusterObjectIdForEntry(entry);
    if(!cluster.objects.has(objectId)) continue;
    if(!nodesByItem.has(resource)){
      nodesByItem.set(resource, []);
    }
    nodesByItem.get(resource).push({ objectId, portId: NODE_OUTPUT_PORT_ID });
  }

  for(const entry of entries){
    if(entry.kind !== FactoryKind.SMELTER) continue;
    const structure = factory?.structures?.get(entry.tileIdx);
    const recipe = resolveSmelterRecipe(structure);
    if(!recipe) continue;
    const requiredItems = Array.from(getRecipeInputMap(recipe).keys());
    if(requiredItems.length === 0) continue;
    const smelterObjectId = clusterObjectIdForEntry(entry);
    if(!cluster.objects.has(smelterObjectId)) continue;
    for(const item of requiredItems){
      const providers = nodesByItem.get(item);
      if(!providers) continue;
      for(const provider of providers){
        const linkId = `${CLOUD_CLUSTER_AUTO_LINK_PREFIX}${cluster.id}:${provider.objectId}->${smelterObjectId}:${item}`;
        upsertCloudClusterLink(cluster, {
          id: linkId,
          source: { objectId: provider.objectId, portId: provider.portId },
          target: { objectId: smelterObjectId, portId: SMELTER_INPUT_PORT_ID },
          metadata: {
            auto: true,
            factionClusterId: cluster.id,
            item,
          },
        });
      }
    }
  }
}

function updateFactionCluster(cluster, entries, factory){
  const desired = new Map();
  for(const entry of entries){
    const objectDef = buildClusterObjectForOwnership(entry, factory);
    if(!objectDef || !objectDef.id) continue;
    desired.set(objectDef.id, objectDef);
  }

  const removed = [];
  for(const objectId of Array.from(cluster.objects.keys())){
    if(!desired.has(objectId)){
      removeCloudFactoryObject(cluster, objectId);
      removed.push(objectId);
    }
  }

  const added = [];
  for(const [objectId, def] of desired.entries()){
    const existed = cluster.objects.has(objectId);
    upsertCloudFactoryObject(cluster, def);
    if(!existed){
      added.push(objectId);
    }
  }

  if(added.length || removed.length){
    updateClusterAccumulatorMembership(cluster.id, { added, removed });
  }

  rebuildFactionClusterLinks(cluster, entries, factory);
}

function syncFactionCloudClusters(factory, ownershipByFaction){
  if(!factory) return;
  const registry = ensureFactoryCloudRegistry(factory);
  if(!(ownershipByFaction instanceof Map)){
    ownershipByFaction = factory.ownershipByFaction instanceof Map ? factory.ownershipByFaction : new Map();
  }
  for(const faction of FACTIONS){
    const clusterId = clusterIdForFaction(faction.id);
    const entries = ownershipByFaction.get(faction.id) ?? [];
    let cluster = registry.byId.get(clusterId);
    if(entries.length > 0){
      cluster = ensureFactionCloudCluster(factory, faction, registry);
      updateFactionCluster(cluster, entries, factory);
      continue;
    }
    if(!cluster) continue;
    updateFactionCluster(cluster, [], factory);
    const hasObjects = (cluster.objects?.size ?? 0) > 0;
    const hasLinks = (cluster.links?.size ?? 0) > 0;
    if(!hasObjects && !hasLinks){
      removeFactionCloudCluster(factory, faction.id, registry);
    }
  }
}

function refreshFactoryOwnership(){
  const factory = ensureFactoryState();
  const byFaction = new Map();
  const unassigned = [];
  const entries = [];

  const registerEntry = (entry) => {
    if(!entry) return;
    entries.push(entry);
    if(entry.factionId != null){
      let list = byFaction.get(entry.factionId);
      if(!list){
        list = [];
        byFaction.set(entry.factionId, list);
      }
      list.push(entry);
    } else {
      unassigned.push(entry);
    }
  };

  for(const [key, node] of factory.nodes.entries()){
    const tileIdx = Number(key);
    if(!Number.isFinite(tileIdx) || tileIdx < 0) continue;
    const { factionId, dominantFactionId, control } = resolveFactoryOwnershipAtTile(tileIdx);
    const entry = createOwnershipEntry({
      tileIdx,
      type: 'node',
      kind: FactoryKind.NODE,
      control,
      factionId,
      dominantFactionId,
      resource: node?.resource ?? null,
    });
    registerEntry(entry);
  }

  for(const [key, structure] of factory.structures.entries()){
    const tileIdx = Number(key);
    if(!Number.isFinite(tileIdx) || tileIdx < 0) continue;
    const { factionId, dominantFactionId, control } = resolveFactoryOwnershipAtTile(tileIdx);
    const entry = createOwnershipEntry({
      tileIdx,
      type: 'structure',
      kind: structure?.kind ?? null,
      control,
      factionId,
      dominantFactionId,
      orientation: structure?.orientation ?? null,
    });
    registerEntry(entry);
  }

  sortOwnershipEntries(entries);
  sortOwnershipEntries(unassigned);
  for(const list of byFaction.values()){
    sortOwnershipEntries(list);
  }

  factory.ownershipRecords = entries;
  factory.ownershipByFaction = byFaction;
  factory.unassignedOwnership = unassigned;
  syncFactionCloudClusters(factory, byFaction);
}

function cloneOwnershipEntry(entry){
  if(!entry) return null;
  const clone = {
    id: entry.id,
    tileIdx: entry.tileIdx,
    type: entry.type,
    kind: entry.kind,
    control: entry.control,
    factionId: entry.factionId,
    dominantFactionId: entry.dominantFactionId ?? null,
  };
  if(entry.coords){
    clone.coords = { ...entry.coords };
  }
  if(entry.resource != null) clone.resource = entry.resource;
  if(entry.orientation != null) clone.orientation = entry.orientation;
  return clone;
}

export function getFactoryOwnership(){
  refreshFactoryOwnership();
  const factory = ensureFactoryState();
  const byFactionMap = factory.ownershipByFaction instanceof Map ? factory.ownershipByFaction : new Map();
  const allEntries = Array.isArray(factory.ownershipRecords) ? factory.ownershipRecords : [];
  const unassigned = Array.isArray(factory.unassignedOwnership) ? factory.unassignedOwnership : [];
  const byFaction = FACTIONS.map((faction) => ({
    factionId: faction.id,
    factionKey: faction.key,
    color: faction.color,
    objects: (byFactionMap.get(faction.id) ?? []).map(cloneOwnershipEntry).filter(Boolean),
  }));
  return {
    byFaction,
    unassigned: unassigned.map(cloneOwnershipEntry).filter(Boolean),
    all: allEntries.map(cloneOwnershipEntry).filter(Boolean),
  };
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
    factory.nodes.set(tileIdx, createNode(spec.resource || FactoryItem.SKIN_PATCH));
    world.strings[tileIdx] = baseStringFor(spec.mode);
    refreshFactoryOwnership();
    return { ok: true, kind: FactoryKind.NODE };
  }
  const dir = normaliseOrientation(orientation ?? factory.orientation);
  if(spec.kind === FactoryKind.MINER && !factory.nodes.has(tileIdx)){
    return {
      ok: false,
      error: 'miner-needs-node',
      message: 'Harvest Surgeons must graft onto a biological node.',
    };
  }
  removeFactoryStructure(tileIdx, { removeNode: false });
  if(world.wall) world.wall[tileIdx] = 0;
  if(world.vent) world.vent[tileIdx] = 0;
  if(world.fire) world.fire.delete(tileIdx);
  const structure = createStructure(spec.kind, dir);
  if(structure && Array.isArray(spec.recipeKeys) && spec.recipeKeys.length){
    structure.availableRecipeKeys = spec.recipeKeys.slice();
    if(structure.kind === FactoryKind.SMELTER){
      const firstKey = structure.availableRecipeKeys[0];
      const firstRecipe = firstKey ? getBioforgeRecipe(firstKey) : null;
      if(firstRecipe){
        structure.recipe = firstRecipe;
        structure.recipeKey = firstRecipe.key;
        structure.activeRecipeIndex = 0;
      }
      structure.allowedInputItems = buildAllowedInputItemSet(structure.availableRecipeKeys);
    } else if(structure.kind === FactoryKind.CONSTRUCTOR){
      const firstKey = structure.availableRecipeKeys[0];
      const firstBlueprint = firstKey ? getConstructorBlueprint(firstKey) : null;
      if(firstBlueprint){
        structure.recipe = firstBlueprint;
        structure.recipeKey = firstBlueprint.key;
        structure.activeRecipeIndex = 0;
      }
      structure.allowedInputItems = buildAllowedInputItemSet(structure.availableRecipeKeys, getConstructorBlueprint);
    }
  }
  if(structure && spec.recipeKey){
    if(structure.kind === FactoryKind.SMELTER){
      const recipe = getBioforgeRecipe(spec.recipeKey);
      structure.recipe = recipe;
      structure.recipeKey = recipe.key;
      if(Array.isArray(structure.availableRecipeKeys)){
        const index = structure.availableRecipeKeys.indexOf(recipe.key);
        structure.activeRecipeIndex = index >= 0 ? index : 0;
      }
      if(structure.availableRecipeKeys){
        structure.allowedInputItems = buildAllowedInputItemSet(structure.availableRecipeKeys);
      }
    } else if(structure.kind === FactoryKind.CONSTRUCTOR){
      const recipe = getConstructorBlueprint(spec.recipeKey);
      structure.recipe = recipe;
      structure.recipeKey = recipe.key;
      if(Array.isArray(structure.availableRecipeKeys)){
        const index = structure.availableRecipeKeys.indexOf(recipe.key);
        structure.activeRecipeIndex = index >= 0 ? index : 0;
      }
      if(structure.availableRecipeKeys){
        structure.allowedInputItems = buildAllowedInputItemSet(structure.availableRecipeKeys, getConstructorBlueprint);
      }
    }
  }
  factory.structures.set(tileIdx, structure);
  world.strings[tileIdx] = baseStringFor(spec.mode);
  refreshFactoryOwnership();
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
  refreshFactoryOwnership();
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
      summary: `${factoryItemLabel(node.resource)} harvested ${mined}`,
      stats: [
        { label: 'Resource', value: factoryItemLabel(node.resource) },
        { label: 'Harvested', value: String(mined) },
        { label: 'Avg / tick', value: average.toFixed(3) },
        { label: 'Last harvest', value: formatTickValue(telemetry.lastMinedTick) },
        { label: 'Last sample', value: factoryItemLabel(telemetry.lastOutputItem ?? null) },
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
        const resourceName = factoryItemLabel(node?.resource ?? FactoryItem.SKIN_PATCH);
        const totalTicks = telemetry?.totalTicks ?? 0;
        const uptime = totalTicks > 0 ? (telemetry.activeTicks ?? 0) / totalTicks : 0;
        entries.push({
          tileIdx,
          kind: structure.kind,
          title: `${meta.icon} ${meta.name} (${orientationLabel})`,
          coords,
          summary: `${telemetry?.essenceExtracted ?? 0} ${resourceName} harvested`,
          stats: [
            { label: 'Resource', value: resourceName },
            { label: 'Orientation', value: orientationLabel },
            { label: 'Jobs queued', value: String(telemetry?.jobsQueued ?? 0) },
            { label: 'Harvested', value: String(telemetry?.essenceExtracted ?? 0) },
            { label: 'Uptime', value: `${Math.round(uptime * 100)}%` },
            { label: 'Last output', value: formatTickValue(telemetry?.lastOutputTick ?? null) },
            { label: 'Last item', value: factoryItemLabel(telemetry?.lastOutputItem ?? null) },
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
        const recipeLabel = formatRecipeDisplay(recipe);
        const totalTicks = telemetry?.totalTicks ?? 0;
        const uptime = totalTicks > 0 ? (telemetry.activeTicks ?? 0) / totalTicks : 0;
        const waiting = totalTicks > 0 ? (telemetry.waitingForInputTicks ?? 0) / totalTicks : 0;
        const bufferDetails = structure.inputBuffer instanceof Map ? mapContentsToSummary(structure.inputBuffer) : String(totalInputCount(structure));
        const cycleMix = telemetry?.lastOutputMix ? mapContentsToSummary(new Map(Object.entries(telemetry.lastOutputMix).map(([key, value]) => [key, value]))) : '—';
        entries.push({
          tileIdx,
          kind: structure.kind,
          title: `${meta.icon} ${meta.name} (${orientationLabel})`,
          coords,
          summary: `${telemetry?.cyclesCompleted ?? 0} cycles complete`,
          stats: [
            { label: 'Recipe', value: recipeLabel },
            { label: 'Orientation', value: orientationLabel },
            { label: 'Input buffer', value: bufferDetails },
            { label: 'Output buffer', value: String(structure.outputBuffer ?? 0) },
            { label: 'Cycles done', value: String(telemetry?.cyclesCompleted ?? 0) },
            { label: 'Consumed', value: String(telemetry?.itemsConsumed ?? 0) },
            { label: 'Uptime', value: `${Math.round(uptime * 100)}%` },
            { label: 'Waiting', value: `${Math.round(waiting * 100)}%` },
            { label: 'Last output', value: formatTickValue(telemetry?.lastOutputTick ?? null) },
            { label: 'Last mix', value: cycleMix },
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

export function getFactoryCatalog(){
  return {
    harvestables: FACTORY_CATALOG.harvestables.map((entry) => ({ ...entry })),
    bioforge: FACTORY_CATALOG.bioforge.map((recipe) => ({
      ...recipe,
      inputs: recipe.inputs.map((input) => ({ ...input })),
    })),
    constructs: FACTORY_CATALOG.constructs.map((recipe) => ({
      ...recipe,
      inputs: recipe.inputs.map((input) => ({ ...input })),
    })),
  };
}

export function getFactoryStatus(){
  const factory = ensureFactoryState();
  const produced = factory.stats.produced || {};
  const stored = factory.stats.stored || {};
  const deliveredStats = factory.stats.delivered || {};
  const countStat = (bucket, item) => bucket?.[item] ?? 0;
  return {
    orientation: factory.orientation,
    orientationLabel: getOrientationLabel(factory.orientation),
    produced: {
      skin: countStat(produced, FactoryItem.SKIN_PATCH),
      blood: countStat(produced, FactoryItem.BLOOD_VIAL),
      organs: countStat(produced, FactoryItem.ORGAN_MASS),
      nerves: countStat(produced, FactoryItem.NERVE_THREAD),
      bone: countStat(produced, FactoryItem.BONE_FRAGMENT),
      glands: countStat(produced, FactoryItem.GLAND_SEED),
      systems: countStat(produced, FactoryItem.BODY_SYSTEM),
      neural: countStat(produced, FactoryItem.NEURAL_WEAVE),
      frames: countStat(produced, FactoryItem.SKELETAL_FRAME),
      endocrine: countStat(produced, FactoryItem.GLANDULAR_NETWORK),
      humans: countStat(produced, FactoryItem.HUMAN_SHELL),
      caretakers: countStat(produced, FactoryItem.CARETAKER_DRONE),
      emissaries: countStat(produced, FactoryItem.EMISSARY_AVATAR),
    },
    stored: {
      skin: countStat(stored, FactoryItem.SKIN_PATCH),
      blood: countStat(stored, FactoryItem.BLOOD_VIAL),
      organs: countStat(stored, FactoryItem.ORGAN_MASS),
      nerves: countStat(stored, FactoryItem.NERVE_THREAD),
      bone: countStat(stored, FactoryItem.BONE_FRAGMENT),
      glands: countStat(stored, FactoryItem.GLAND_SEED),
      systems: countStat(stored, FactoryItem.BODY_SYSTEM),
      neural: countStat(stored, FactoryItem.NEURAL_WEAVE),
      frames: countStat(stored, FactoryItem.SKELETAL_FRAME),
      endocrine: countStat(stored, FactoryItem.GLANDULAR_NETWORK),
      humans: countStat(stored, FactoryItem.HUMAN_SHELL),
      caretakers: countStat(stored, FactoryItem.CARETAKER_DRONE),
      emissaries: countStat(stored, FactoryItem.EMISSARY_AVATAR),
    },
    delivered: {
      skin: countStat(deliveredStats, FactoryItem.SKIN_PATCH),
      blood: countStat(deliveredStats, FactoryItem.BLOOD_VIAL),
      organs: countStat(deliveredStats, FactoryItem.ORGAN_MASS),
      nerves: countStat(deliveredStats, FactoryItem.NERVE_THREAD),
      bone: countStat(deliveredStats, FactoryItem.BONE_FRAGMENT),
      glands: countStat(deliveredStats, FactoryItem.GLAND_SEED),
      systems: countStat(deliveredStats, FactoryItem.BODY_SYSTEM),
      neural: countStat(deliveredStats, FactoryItem.NEURAL_WEAVE),
      frames: countStat(deliveredStats, FactoryItem.SKELETAL_FRAME),
      endocrine: countStat(deliveredStats, FactoryItem.GLANDULAR_NETWORK),
      humans: countStat(deliveredStats, FactoryItem.HUMAN_SHELL),
      caretakers: countStat(deliveredStats, FactoryItem.CARETAKER_DRONE),
      emissaries: countStat(deliveredStats, FactoryItem.EMISSARY_AVATAR),
    },
    nodes: factory.nodes.size,
    structures: factory.structures.size,
    constructorComplete: factory.stats.constructorComplete ?? (stored[FactoryItem.HUMAN_SHELL] ?? 0),
    jobsCompleted: factory.stats.jobsCompleted ?? 0,
    extended: {
      harvest: FACTORY_CATALOG.harvestables.map(({ item, label }) => ({
        item,
        label,
        produced: countStat(produced, item),
        stored: countStat(stored, item),
        delivered: countStat(deliveredStats, item),
      })),
      bioforge: FACTORY_CATALOG.bioforge.map((recipe) => ({
        key: recipe.key,
        label: recipe.label,
        output: recipe.output,
        produced: countStat(produced, recipe.output),
        stored: countStat(stored, recipe.output),
        delivered: countStat(deliveredStats, recipe.output),
      })),
      constructs: FACTORY_CATALOG.constructs.map((recipe) => ({
        key: recipe.key,
        label: recipe.label,
        output: recipe.output,
        produced: countStat(produced, recipe.output),
        stored: countStat(stored, recipe.output),
        delivered: countStat(deliveredStats, recipe.output),
      })),
    },
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
      const nodeTile = job.tileIdx;
      const node = typeof nodeTile === 'number' ? factory.nodes.get(nodeTile) : null;
      const resource = node?.resource ?? FactoryItem.SKIN_PATCH;
      worker.carriedItem = resource;
      incrementCounter(factory.stats.produced, resource, 1);
      const source = job.payload?.sourceStructure;
      if(typeof source === 'number'){
        const miner = factory.structures.get(source);
        if(miner){
          miner.jobAssigned = false;
          const minerTelemetry = ensureStructureTelemetry(miner);
          if(minerTelemetry){
            minerTelemetry.essenceExtracted = (minerTelemetry.essenceExtracted ?? 0) + 1;
            minerTelemetry.lastOutputTick = factory.ticks ?? 0;
            minerTelemetry.lastOutputItem = resource;
          }
        }
      }
      if(node){
        if(!node.telemetry){
          node.telemetry = createNodeTelemetry();
        }
        node.telemetry.mined = (node.telemetry.mined ?? 0) + 1;
        node.telemetry.lastMinedTick = factory.ticks ?? 0;
        node.telemetry.lastOutputItem = resource;
      }
      const targetTile = job.payload?.targetStructure;
      if(targetTile != null){
        enqueueFactoryJob({
          kind: 'deliver',
          tileIdx: targetTile,
          payload: {
            item: resource,
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
        if(targetStructure) clearPendingInput(targetStructure, requiredItem);
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
      const carryItem = outputItem ?? FactoryItem.BODY_SYSTEM;
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
            clearPendingInput(target, delivered);
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

export function getBioforgeRecipeDefinition(key){
  return snapshotRecipeDefinition(getBioforgeRecipe(key));
}

export function getConstructorBlueprintDefinition(key){
  return snapshotRecipeDefinition(getConstructorBlueprint(key));
}

export function getDefaultBioforgeRecipeDefinition(){
  return getBioforgeRecipeDefinition(DEFAULT_BIOFORGE_RECIPE.key);
}

export function getDefaultConstructorBlueprintDefinition(){
  return getConstructorBlueprintDefinition(DEFAULT_CONSTRUCTOR_BLUEPRINT.key);
}

export function getMinerExtractionRate(){
  return MINER_RATE;
}

export function getBeltBaseSpeed(){
  return BELT_SPEED;
}

export function getSmelterCycleTime(){
  return SMELTER_TIME;
}

export function getConstructorCycleTime(){
  return CONSTRUCTOR_TIME;
}
