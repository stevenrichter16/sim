export const Mode = Object.freeze({
  OXYGEN: 11,
  WATER: 12,
  ICE: 13,
  CRYOFOAM: 14,
  FIRE: 31,
  ACID: 21,
  BASE: 22,
  CLF3: 41,
  CALM: 101,
  PANIC: 102,
});

export const TAU = Math.PI * 2;
export const DIRS4 = Object.freeze([[1,0],[-1,0],[0,1],[0,-1]]);
export const clamp01 = (x)=> Math.max(0, Math.min(1, x));
export const lerp = (a,b,t)=> a + (b - a) * t;
export const wrapTau = (p)=> ((p % TAU) + TAU) % TAU;
