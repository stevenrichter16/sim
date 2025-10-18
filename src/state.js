import { FACTIONS } from './factions.js';
import { setSeed, getSeed } from './rng.js';

const GRID_WIDTH = 80;
const GRID_HEIGHT = 45;

export const world = {
  W: GRID_WIDTH,
  H: GRID_HEIGHT,
  cell: 9,
  heat: null,
  o2: null,
  helpField: null,
  routeField: null,
  panicField: null,
  safeField: null,
  escapeField: null,
  memX: null,
  memY: null,
  doorField: null,
  doorTiles: new Set(),
  safeFieldsByFaction: null,
  presenceX: null,
  presenceY: null,
  dominantFaction: null,
  controlLevel: null,
  frontierByFaction: null,
  debtByFaction: null,
  reinforceByFaction: null,
  visited: null,
  wall: null,
  vent: null,
  fire: null,
  strings: null,
  agents: [],
  nextAgentId: 1,
  agentHandles: new Map(),
  agentIndexById: new Map(),
  clfCanisters: new Map(),
  clfBurners: new Map(),
  foamTimers: new Map(),
  scenarioAgents: new Set(),
  scenarioFires: new Set(),
  spawnDiagnostics: {
    lastAttempt: null,
  },
  rngSeed: 0x1f123bb5,
};

export const simControl = {
  speedMultiplier: 1,
};

export const metricsState = {
  prevO2Sum: null,
  prevFireSum: null,
  aggregates: {
    avgAmplitude: 0,
    avgTension: 0,
    fireIntensity: 0,
    heatAverage: 0,
    modeCounts: new Map(),
    stuckAgents: 0,
  },
  histograms: {
    amplitude: new Array(20).fill(0),
    tension: new Array(20).fill(0),
    heat: new Array(20).fill(0),
  },
  diagnostics: {
    fieldTotals: { help:0, route:0, panic:0, safe:0, escape:0, door:0 },
    hotAgents: 0,
    overwhelmedAgents: 0,
  },
};

export const uiState = {
  brush: 'fire',
  telemetryEnabled: false,
  inspectActive: false,
  inspectedTile: null,
  paused: false,
};

const viewState = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

export function idx(x,y){
  return y * world.W + x;
}

export function inBounds(x,y){
  return x > 0 && y > 0 && x < world.W - 1 && y < world.H - 1;
}

export function resetWorld(o2BaseValue, options = {}){
  clearScenarioOwnership();
  if(options && typeof options.seed === 'number'){
    world.rngSeed = options.seed >>> 0;
  } else if(typeof world.rngSeed !== 'number'){
    world.rngSeed = getSeed();
  }
  setSeed(world.rngSeed);

  const size = world.W * world.H;
  world.heat = new Float32Array(size);
  world.o2   = new Float32Array(size);
  world.helpField = new Float32Array(size);
  world.routeField = new Float32Array(size);
  world.panicField = new Float32Array(size);
  world.safeField = new Float32Array(size);
  world.escapeField = new Float32Array(size);
  world.memX = new Float32Array(size);
  world.memY = new Float32Array(size);
  world.doorField = new Float32Array(size);
  world.doorTiles = new Set();
  world.safeFieldsByFaction = FACTIONS.map(() => new Float32Array(size));
  world.presenceX = new Float32Array(size);
  world.presenceY = new Float32Array(size);
  world.dominantFaction = new Int16Array(size);
  world.controlLevel = new Float32Array(size);
  world.frontierByFaction = FACTIONS.map(() => new Float32Array(size));
  world.debtByFaction = FACTIONS.map(() => new Float32Array(size));
  world.reinforceByFaction = FACTIONS.map(() => new Float32Array(size));
  world.visited = new Float32Array(size);
  world.wall = new Uint8Array(size);
  world.vent = new Uint8Array(size);
  world.fire = new Set();
  world.strings = new Array(size);
  world.agents = [];
  world.nextAgentId = 1;
  world.agentHandles = new Map();
  world.agentIndexById = new Map();
  world.clfCanisters = new Map();
  world.clfBurners = new Map();
  world.foamTimers = new Map();
  world.scenarioAgents = new Set();
  world.scenarioFires = new Set();
  world.spawnDiagnostics = { lastAttempt: null };
  world.spawnDiagnostics = { lastAttempt: null };
  world.o2.fill(o2BaseValue);
  world.helpField.fill(0);
  world.routeField.fill(0);
  world.panicField.fill(0);
  world.safeField.fill(0);
  world.escapeField.fill(0);
  world.memX.fill(0);
  world.memY.fill(0);
  world.doorField.fill(0);
  if(world.safeFieldsByFaction){
    for(const field of world.safeFieldsByFaction){
      field.fill(0);
    }
  }
  world.presenceX.fill(0);
  world.presenceY.fill(0);
  world.dominantFaction.fill(-1);
  world.controlLevel.fill(0);
  if(world.frontierByFaction){
    for(const field of world.frontierByFaction){
      field.fill(0);
    }
  }
  if(world.debtByFaction){
    for(const field of world.debtByFaction){
      field.fill(0);
    }
  }
  if(world.reinforceByFaction){
    for(const field of world.reinforceByFaction){
      field.fill(0);
    }
  }
  world.visited.fill(0);

  for(let x=0;x<world.W;x++){
    world.wall[idx(x,0)] = 1;
    world.wall[idx(x,world.H-1)] = 1;
  }
  for(let y=0;y<world.H;y++){
    world.wall[idx(0,y)] = 1;
    world.wall[idx(world.W-1,y)] = 1;
  }

  metricsState.prevO2Sum = null;
  metricsState.prevFireSum = null;
  metricsState.aggregates.modeCounts = new Map();
  metricsState.aggregates.avgAmplitude = 0;
  metricsState.aggregates.avgTension = 0;
  metricsState.aggregates.fireIntensity = 0;
  metricsState.aggregates.heatAverage = 0;
  metricsState.histograms.amplitude.fill(0);
  metricsState.histograms.tension.fill(0);
  metricsState.histograms.heat.fill(0);

  uiState.inspectActive = false;
  uiState.inspectedTile = null;
}

export function allocateAgentId(){
  const id = world.nextAgentId++;
  return id;
}

export function registerAgentHandle(agent, index){
  if(!agent || typeof agent.id !== 'number') return;
  world.agentHandles.set(agent.id, agent);
  if(typeof index === 'number'){
    world.agentIndexById.set(agent.id, index);
  }
}

export function updateAgentIndex(agentId, index){
  if(world.agentHandles.has(agentId) && typeof index === 'number'){
    world.agentIndexById.set(agentId, index);
  }
}

export function unregisterAgentHandle(agentId){
  world.agentHandles.delete(agentId);
  world.agentIndexById.delete(agentId);
}

export function markScenarioAgent(agentId){
  if(agentId == null) return;
  world.scenarioAgents?.add(agentId);
}

export function unmarkScenarioAgent(agentId){
  if(agentId == null) return;
  world.scenarioAgents?.delete(agentId);
}

export function markScenarioFire(tileIdx){
  if(tileIdx == null) return;
  world.scenarioFires?.add(tileIdx);
}

export function unmarkScenarioFire(tileIdx){
  if(tileIdx == null) return;
  world.scenarioFires?.delete(tileIdx);
}

export function clearScenarioOwnership(){
  world.scenarioAgents?.clear();
  world.scenarioFires?.clear();
  if(world.spawnDiagnostics){
    world.spawnDiagnostics.lastAttempt = null;
  }
}

export function getAgentById(agentId){
  return world.agentHandles.get(agentId) ?? null;
}

export function getAgentIndex(agentId){
  const index = world.agentIndexById.get(agentId);
  return typeof index === 'number' ? index : -1;
}

export function rebuildAgentIndices(){
  world.agentIndexById.clear();
  for(let i=0; i<world.agents.length; i++){
    const agent = world.agents[i];
    if(agent && typeof agent.id === 'number'){
      world.agentIndexById.set(agent.id, i);
      world.agentHandles.set(agent.id, agent);
    }
  }
}

export function setWorldSeed(seed){
  world.rngSeed = seed >>> 0;
  setSeed(world.rngSeed);
}

export function getWorldSeed(){
  return world.rngSeed >>> 0;
}

export function setBrush(value){
  uiState.brush = value;
}

export function getBrush(){
  return uiState.brush;
}

export function setTelemetryEnabled(value){
  uiState.telemetryEnabled = !!value;
  if(!uiState.telemetryEnabled){
    uiState.inspectActive = false;
    uiState.inspectedTile = null;
  }
}

export function isTelemetryEnabled(){
  return uiState.telemetryEnabled;
}

export function setInspectActive(value){
  uiState.inspectActive = !!value;
}

export function isInspectActive(){
  return uiState.inspectActive;
}

export function setInspectedTile(tileIdx){
  uiState.inspectedTile = tileIdx;
}

export function getInspectedTile(){
  return uiState.inspectedTile;
}

export function getViewState(){
  return { ...viewState };
}

export function setPaused(value){
  uiState.paused = !!value;
}

export function setSimSpeed(mult){
  simControl.speedMultiplier = Math.max(1, Math.min(10, Math.floor(mult)));
}

export function getSimSpeed(){
  return simControl.speedMultiplier;
}

export function isPaused(){
  return uiState.paused;
}

export function setViewScale(scale){
  viewState.scale = scale;
}

export function setViewOffset(x,y){
  viewState.offsetX = x;
  viewState.offsetY = y;
}
