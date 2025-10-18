import { FACTIONS } from './factions.js';

const overlayDefaults = {
  heat: false,
  amplitude: false,
  tension: false,
  help: true,
  panic: true,
  safe: true,
  escape: true,
  route: true,
  memory: false,
  door: false,
  control: false,
  reinforce: false,
  frontier: false,
};

for(const faction of FACTIONS){
  overlayDefaults[`safeFaction${faction.id}`] = false;
}

export const debugConfig = {
  enableRecorder: false,
  recorderSize: 120,
  logReactions: false,
  assertions: false,
  overlay: overlayDefaults,
  enableLogs: {
    reinforceSeed: false,
  },
};

export function setDebugFlag(path, value){
  const parts = Array.isArray(path)? path : String(path).split('.');
  let ref = debugConfig;
  for(let i=0;i<parts.length-1;i++){
    const key = parts[i];
    if(!(key in ref)) return;
    ref = ref[key];
  }
  const last = parts[parts.length-1];
  if(last in ref) ref[last] = value;
}

export function getDebugFlag(path){
  const parts = Array.isArray(path)? path : String(path).split('.');
  let ref = debugConfig;
  for(const key of parts){
    if(ref == null || !(key in ref)) return undefined;
    ref = ref[key];
  }
  return ref;
}
