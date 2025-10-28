export const Mode = Object.freeze({
  OXYGEN: 11,
  WATER: 12,
  ICE: 13,
  CRYOFOAM: 14,
  FIRE: 31,
  ACID: 21,
  BASE: 22,
  CLF3: 41,
  MYCELIUM: 61,
  CALM: 101,
  PANIC: 102,
  MEDIC: 103,
  FACTORY_NODE: 201,
  FACTORY_MINER: 202,
  FACTORY_BELT: 203,
  FACTORY_SMELTER: 204,
  FACTORY_CONSTRUCTOR: 205,
  FACTORY_STORAGE: 206,
});

export const TAU = Math.PI * 2;
export const DIRS4 = Object.freeze([[1,0],[-1,0],[0,1],[0,-1]]);
export const clamp01 = (x)=> Math.max(0, Math.min(1, x));
export const lerp = (a,b,t)=> a + (b - a) * t;
export const wrapTau = (p)=> ((p % TAU) + TAU) % TAU;
