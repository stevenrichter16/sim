const pendingBursts = [];
const pendingFlashes = [];

export function emitParticleBurst(x, y, { type = 'spark', intensity = 1 } = {}){
  pendingBursts.push({ x, y, type, intensity });
}

export function emitFlash(x, y, { radius = 1, life = 24, colorStart = '#ff4bf0', colorEnd = '#c9c9d6' } = {}){
  pendingFlashes.push({ x, y, radius, life, colorStart, colorEnd });
}

export function drainParticleBursts(){
  if(pendingBursts.length === 0) return [];
  return pendingBursts.splice(0, pendingBursts.length);
}

export function drainFlashes(){
  if(pendingFlashes.length === 0) return [];
  return pendingFlashes.splice(0, pendingFlashes.length);
}
