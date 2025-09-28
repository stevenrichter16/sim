import { Mode, TAU, DIRS4, clamp01, lerp, wrapTau } from './constants.js';
import { world, idx, inBounds } from './state.js';
import { emitParticleBurst, emitFlash } from './effects.js';

const FOAM_BASE_TTL = 10;
const FOAM_HEAT_CAP = 0.18;
const FOAM_EXPANSION_HEAT = 0.25;
const FOAM_EXPANSION_TTL = 6;
const FOAM_DIAGONALS = Object.freeze([[1,1],[1,-1],[-1,1],[-1,-1]]);

export function baseStringFor(mode){
  switch(mode){
    case Mode.OXYGEN: return { mode, tension:0.55, amplitude:0.2, phase:0.0 };
    case Mode.FIRE:   return { mode, tension:0.10, amplitude:1.0, phase:0.4 };
    case Mode.WATER:  return { mode, tension:0.80, amplitude:0.1, phase:0.2 };
    case Mode.ICE:    return { mode, tension:0.95, amplitude:0.05, phase:0.0 };
    case Mode.CRYOFOAM: return { mode, tension:0.78, amplitude:0.38, phase:0.3 };
    case Mode.ACID:   return { mode, tension:0.50, amplitude:0.6, phase:0.1 };
    case Mode.BASE:   return { mode, tension:0.50, amplitude:0.6, phase:0.6 };
    case Mode.CLF3:   return { mode, tension:0.05, amplitude:0.0, phase:0.0 };
    case Mode.CALM:   return { mode, tension:0.90, amplitude:0.1, phase:0.0 };
    case Mode.PANIC:  return { mode, tension:0.20, amplitude:0.9, phase:0.8 };
    default: return { mode, tension:0.5, amplitude:0.2, phase:Math.random()*TAU };
  }
}

export function Sget(i){
  let S = world.strings[i];
  if(!S){
    S = { mode:0, tension:0.5, amplitude:0, phase:0 };
    world.strings[i] = S;
  }
  return S;
}

export function couple(A,B,k=1.0){
  const d = Math.abs(A.phase - B.phase);
  const dphi = Math.min(d, TAU - d);
  const phaseGain = Math.exp(-(dphi*dphi)/(2*0.25*0.25));
  const gate = 1.0/(0.5 + A.tension + B.tension);
  return k * phaseGain * gate * Math.max(0, A.amplitude + B.amplitude);
}

export function addHeatXY(x,y,dh){
  if(!world.wall[idx(x,y)]){
    world.heat[idx(x,y)] = Math.min(1.0, world.heat[idx(x,y)] + dh);
  }
}

export function modO2XY(x,y,do2){
  if(!world.wall[idx(x,y)]){
    world.o2[idx(x,y)] = Math.max(0, world.o2[idx(x,y)] + do2);
  }
}

function ensureFoamEntry(tileIdx, ttl, permanent){
  const existing = world.foamTimers ? world.foamTimers.get(tileIdx) : null;
  if(existing){
    if(!existing.permanent){
      existing.ttl = Math.max(existing.ttl, ttl);
      existing.permanent = existing.permanent || permanent;
    }
    return existing;
  }
  const prev = {
    string: world.strings[tileIdx],
    wall: world.wall[tileIdx],
    vent: world.vent[tileIdx],
  };
  const entry = { ttl, permanent, prev };
  world.foamTimers.set(tileIdx, entry);
  return entry;
}

function restoreFromFoam(tileIdx, data){
  if(!data) return;
  world.strings[tileIdx] = data.prev?.string;
  world.wall[tileIdx] = data.prev?.wall ?? 0;
  world.vent[tileIdx] = data.prev?.vent ?? 0;
  world.foamTimers.delete(tileIdx);
}

function solidifyFoam(tileIdx){
  world.strings[tileIdx] = baseStringFor(Mode.ICE);
  world.wall[tileIdx] = 1;
  world.foamTimers.delete(tileIdx);
  world.heat[tileIdx] = Math.max(0, world.heat[tileIdx] - 0.05);
}

function scheduleFoamExpansion(targets, nIdx){
  if(world.strings[nIdx]?.mode === Mode.CRYOFOAM) return;
  if(world.wall[nIdx]) return;
  targets.add(nIdx);
}

export function ensureCryofoam(tileIdx, { ttl = FOAM_BASE_TTL, permanent = false } = {}){
  if(!world.foamTimers) world.foamTimers = new Map();
  const entry = ensureFoamEntry(tileIdx, ttl, permanent);
  const current = world.strings[tileIdx];
  if(!current || current.mode !== Mode.CRYOFOAM){
    world.strings[tileIdx] = baseStringFor(Mode.CRYOFOAM);
    emitParticleBurst(tileIdx % world.W, (tileIdx / world.W) | 0, { type:'foam', intensity:0.8 });
  }
  world.wall[tileIdx] = 1;
  world.vent[tileIdx] = 0;
  world.heat[tileIdx] = Math.min(world.heat[tileIdx], FOAM_HEAT_CAP);
  world.fire.delete(tileIdx);
  return entry;
}

export function stepCryofoam(){
  if(!world.foamTimers || !world.foamTimers.size) return;
  const nextFoam = new Map();
  const expansionTargets = new Set();
  for(const [tile,data] of world.foamTimers){
    const S = world.strings[tile];
    if(!S || S.mode !== Mode.CRYOFOAM){
      restoreFromFoam(tile, data);
      continue;
    }
    world.heat[tile] = Math.min(world.heat[tile], FOAM_HEAT_CAP);
    S.amplitude = clamp01(S.amplitude * 0.995);
    const x = tile % world.W;
    const y = (tile / world.W) | 0;
    let ttl = data.permanent ? data.ttl : data.ttl - 1;
    let convertToIce = false;
    for(const [dx,dy] of DIRS4){
      const nx = x + dx;
      const ny = y + dy;
      if(!inBounds(nx,ny)) continue;
      const nIdx = idx(nx,ny);
      const nS = world.strings[nIdx];
      if(nS){
        if((nS.mode === Mode.WATER || nS.mode === Mode.ICE) && world.heat[nIdx] < FOAM_EXPANSION_HEAT){
          const influence = couple(S, nS, 0.04);
          if(influence > 0.003) scheduleFoamExpansion(expansionTargets, nIdx);
        } else if(nS.mode === Mode.ACID){
          const decay = couple(S, nS, 0.05);
          if(decay > 0){
            ttl -= 1 + Math.ceil(decay * 3);
            S.tension = clamp01(S.tension - 0.2 * decay);
            modO2XY(nx, ny, 0.01);
          }
        } else if(nS.mode === Mode.BASE){
          const bind = couple(S, nS, 0.08);
          if(bind > 0.02){
            convertToIce = true;
          }
        }
      }
    }

    for(const [dx,dy] of FOAM_DIAGONALS){
      const nx = x + dx;
      const ny = y + dy;
      if(!inBounds(nx,ny)) continue;
      const nIdx = idx(nx,ny);
      const nS = world.strings[nIdx];
      if(!nS) continue;
      if((nS.mode === Mode.WATER || nS.mode === Mode.ICE) && world.heat[nIdx] < FOAM_EXPANSION_HEAT){
        const influence = couple(S, nS, 0.04);
        if(influence > 0.003) scheduleFoamExpansion(expansionTargets, nIdx);
      }
    }

    if(convertToIce){
      solidifyFoam(tile);
      continue;
    }

    if(data.permanent){
      nextFoam.set(tile, { ...data, permanent:true });
      continue;
    }

    if(ttl > 0){
      nextFoam.set(tile, { ...data, ttl });
    } else {
      restoreFromFoam(tile, data);
    }
  }

  world.foamTimers = nextFoam;

  for(const nIdx of expansionTargets){
    const existing = world.strings[nIdx];
    if(existing && existing.mode === Mode.ACID) continue;
    ensureCryofoam(nIdx, { ttl: FOAM_EXPANSION_TTL });
  }
}

export function scheduleClfBurn(tileIdx, strength=8){
  const existing = world.clfBurners.get(tileIdx) || 0;
  world.clfBurners.set(tileIdx, Math.max(existing, strength));
}

export function triggerClfCanister(tileIdx){
  const state = world.clfCanisters.get(tileIdx);
  if(!state) return;
  world.clfCanisters.delete(tileIdx);
  const ox = tileIdx % world.W;
  const oy = (tileIdx / world.W) | 0;
  propagateClf3(ox, oy, state.yield ?? 5);
}

export function propagateClf3(ox, oy, intensity){
  const maxRadius = Math.max(3, Math.min(6, intensity + 3));
  const visited = new Set();
  const queue = [[ox, oy, 0]];
  while(queue.length){
    const [x,y,d] = queue.shift();
    if(!inBounds(x,y)) continue;
    const k = idx(x,y);
    if(visited.has(k)) continue;
    visited.add(k);
    world.wall[k] = 0;
    const s = Sget(k);
    s.mode = Mode.FIRE;
    s.amplitude = Math.max(s.amplitude, 1.1);
    s.tension = Math.max(0.05, s.tension * 0.8);
    world.heat[k] = 1.0;
    const depletion = 0.03 * (intensity + Math.max(0, maxRadius - d));
    world.o2[k] = Math.max(0, world.o2[k] - depletion);
    world.fire.add(k);
    scheduleClfBurn(k, Math.max(6, intensity + (maxRadius - d)));
    if(d < maxRadius){
      for(const [dx,dy] of DIRS4){
        const nx = x + dx;
        const ny = y + dy;
        if(!inBounds(nx,ny)) continue;
        queue.push([nx,ny,d+1]);
      }
    }
  }
}

export function reactFireO2(i, settings){
  const F = Sget(i);
  if(F.mode !== Mode.FIRE) return;
  const o = world.o2[i];
  const O = { mode:Mode.OXYGEN, tension:0.55, amplitude:clamp01(o/0.30), phase:0.0 };
  const s = couple(F,O,0.06);
  const isClfInferno = world.clfBurners.has(i);
  const gain = isClfInferno ? 1.4 : 0.8;
  F.amplitude += gain*s;
  addHeatXY(i % world.W, (i / world.W) | 0, 12*s);
  const drop = (isClfInferno ? 0.18 : 0.5) * s;
  world.o2[i] = Math.max(0, world.o2[i] - drop);
  const cut = settings.o2Cut;
  if(!isClfInferno && world.o2[i] < cut){
    world.fire.delete(i);
    F.amplitude *= 0.5;
  }
  if(isClfInferno){
    F.amplitude = Math.max(F.amplitude, 1.2);
  }
  const mid = wrapTau((F.phase + O.phase) / 2);
  F.phase = lerp(F.phase, mid, 0.1*s);
}

export function reactFireWater(i,j){
  const F = Sget(i);
  const Wt = Sget(j);
  const s = couple(F, Wt, 0.05);
  F.phase = wrapTau(F.phase + Math.PI*0.6);
  F.amplitude = Math.max(0, F.amplitude - 1.2*s);
  addHeatXY(j % world.W, (j / world.W) | 0, 0.2*s);
  emitParticleBurst(j % world.W, (j / world.W) | 0, { type:'steam', intensity: Math.min(1, s*14) });
  if(F.amplitude < 0.2) world.fire.delete(i);
}

export function reactAcidBase(i,j,{ triggerFlash = true } = {}){
  const Aci = Sget(i);
  const Bas = Sget(j);
  const s = couple(Aci,Bas,0.08);
  Aci.tension = clamp01(Aci.tension - 0.6*s);
  Bas.tension = clamp01(Bas.tension - 0.6*s);
  addHeatXY(j % world.W, (j / world.W) | 0, 6*s);
  if(triggerFlash){
    emitParticleBurst(j % world.W, (j / world.W) | 0, { type:'spark', intensity: Math.min(1.2, s*10) });
    const ax = i % world.W;
    const ay = (i / world.W) | 0;
    const bx = j % world.W;
    const by = (j / world.W) | 0;
    const flashIntensity = clamp01(s * 6);
    const baseRadius = 1.0 + flashIntensity * 0.7;
    emitFlash(ax, ay, { radius: baseRadius, life: 26, colorStart:'#ff4bf8', colorEnd:'#d4dae4' });
    emitFlash(bx, by, { radius: baseRadius, life: 26, colorStart:'#ff4bf8', colorEnd:'#d4dae4' });
  }
}
