const TWO_PI = Math.PI * 2;
const BUCKETS = 16;

const angleForBucket = index => index * (TWO_PI / BUCKETS);

export const MTAG = Object.freeze({
  SAFE:   angleForBucket(0),
  ROUTE:  angleForBucket(2),
  HELP:   angleForBucket(4),
  PANIC:  angleForBucket(6),
  ESCAPE: angleForBucket(8),
  FIRE:   angleForBucket(10),
  WATER:  angleForBucket(12),
});

export function depositTagged(memX, memY, idx, weight, phase){
  if(!memX || !memY || weight === 0) return;
  memX[idx] += weight * Math.cos(phase);
  memY[idx] += weight * Math.sin(phase);
}

export function projectOnto(memX, memY, idx, phase){
  if(!memX || !memY) return 0;
  return memX[idx] * Math.cos(phase) + memY[idx] * Math.sin(phase);
}
