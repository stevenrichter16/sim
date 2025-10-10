import { FACTIONS } from './factions.js';

const TWO_PI = Math.PI * 2;
export const MEMORY_BUCKETS = 48;

const angleForBucket = index => index * (TWO_PI / MEMORY_BUCKETS);

const BASE_TAGS = Object.freeze({
  ROUTE:  angleForBucket(12),
  HELP:   angleForBucket(18),
  PANIC:  angleForBucket(24),
  ESCAPE: angleForBucket(30),
  FIRE:   angleForBucket(36),
  WATER:  angleForBucket(42),
});

export const factionSafePhases = FACTIONS.map(f => angleForBucket(f.safePhaseBucket));

export const MTAG = Object.freeze({
  ...BASE_TAGS,
  factionSafePhases,
});

let presenceCosByFaction = factionSafePhases.map(Math.cos);
let presenceSinByFaction = factionSafePhases.map(Math.sin);

export function rebuildPresencePhaseCache(){
  presenceCosByFaction = factionSafePhases.map(Math.cos);
  presenceSinByFaction = factionSafePhases.map(Math.sin);
}

export function getPresenceCos(){ return presenceCosByFaction; }
export function getPresenceSin(){ return presenceSinByFaction; }

export function depositTagged(memX, memY, idx, weight, phase){
  if(!memX || !memY || weight === 0) return;
  memX[idx] += weight * Math.cos(phase);
  memY[idx] += weight * Math.sin(phase);
}

export function projectOnto(memX, memY, idx, phase){
  if(!memX || !memY) return 0;
  return memX[idx] * Math.cos(phase) + memY[idx] * Math.sin(phase);
}
