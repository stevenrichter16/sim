let currentSeed = 0x1f123bb5;

function mulberry32(seed){
  let t = seed >>> 0;
  return function(){
    t += 0x6D2B79F5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

let rngState = mulberry32(currentSeed);

export function setSeed(seed){
  currentSeed = seed >>> 0;
  rngState = mulberry32(currentSeed);
  return currentSeed;
}

export function getSeed(){
  return currentSeed >>> 0;
}

export function setGenerator(generator){
  if(typeof generator !== 'function') return () => {};
  const previousState = rngState;
  const previousSeed = currentSeed;
  rngState = () => {
    const value = generator();
    if(!Number.isFinite(value)) return previousState();
    if(value <= 0) return 0;
    if(value >= 1) return 1 - Number.EPSILON;
    return value;
  };
  return () => {
    currentSeed = previousSeed;
    rngState = previousState;
  };
}

export function random(){
  return rngState();
}

export function randomRange(min, max){
  return min + (max - min) * random();
}

export function randomInt(max){
  if(max <= 0) return 0;
  return Math.floor(random() * max);
}

export function randomBoolean(probability = 0.5){
  return random() < probability;
}

export function randomCentered(){
  return random() - 0.5;
}

export function randomSign(){
  return randomBoolean() ? 1 : -1;
}
