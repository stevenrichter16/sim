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
  visited: null,
  wall: null,
  vent: null,
  fire: null,
  strings: null,
  agents: [],
  clfCanisters: new Map(),
  clfBurners: new Map(),
  foamTimers: new Map(),
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
    fieldTotals: { help:0, route:0, panic:0, safe:0, escape:0 },
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

export function resetWorld(o2BaseValue){
  const size = world.W * world.H;
  world.heat = new Float32Array(size);
  world.o2   = new Float32Array(size);
  world.helpField = new Float32Array(size);
  world.routeField = new Float32Array(size);
  world.panicField = new Float32Array(size);
  world.safeField = new Float32Array(size);
  world.escapeField = new Float32Array(size);
  world.visited = new Float32Array(size);
  world.wall = new Uint8Array(size);
  world.vent = new Uint8Array(size);
  world.fire = new Set();
  world.strings = new Array(size);
  world.agents = [];
  world.clfCanisters = new Map();
  world.clfBurners = new Map();
  world.foamTimers = new Map();
  world.o2.fill(o2BaseValue);
  world.helpField.fill(0);
  world.routeField.fill(0);
  world.panicField.fill(0);
  world.safeField.fill(0);
  world.escapeField.fill(0);
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
