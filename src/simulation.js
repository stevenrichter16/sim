import { Mode, DIRS4, clamp01, wrapTau, lerp, TAU } from './constants.js';
import {
  world,
  idx,
  inBounds,
  resetWorld,
  metricsState,
  getSimSpeed,
  allocateAgentId,
  registerAgentHandle,
  unregisterAgentHandle,
  getAgentById,
  getAgentIndex,
  rebuildAgentIndices,
  markScenarioAgent,
  unmarkScenarioAgent,
  markScenarioFire,
  unmarkScenarioFire,
  clearScenarioOwnership,
} from './state.js';
import { emitParticleBurst, emitFlash } from './effects.js';
import { debugConfig } from './debug.js';
import { createRecorder } from './recorder.js';
import { thresholds, roles, fieldConfig, decayMultiplierFromHalfLife } from './config.js';
import { FACTIONS, DEFAULT_FACTION_ID, factionById, factionByKey, factionAffinity } from './factions.js';
import { MTAG, depositTagged, projectOnto, factionSafePhases, getPresenceCos, getPresenceSin, rebuildPresencePhaseCache } from './memory.js';
import { random, randomCentered, randomInt, randomRange } from './rng.js';
import {
  baseStringFor,
  Sget,
  couple,
  addHeatXY,
  modO2XY,
  scheduleClfBurn,
  triggerClfCanister,
  propagateClf3,
  reactFireO2,
  reactFireWater,
  reactAcidBase,
  stepCryofoam,
  stepMycelium,
} from './materials.js';
import { createScenarioRuntime } from './script/runtime.js';
import { deserialiseCompiledProgram } from './script/bytecode.js';
import { stepFactory, setFactoryWorkerSpawner } from './factory.js';

const medicAssignments = new Map();

const MAX_PHASE_SHOCK = 1.2;
const PANIC_RUN_TICKS = 6;
const PANIC_MIN_HEAT_DROP = 0.005;
const PANIC_FAILURE_LIMIT = 5;
const PANIC_RELIEF_DELTA = 0.05;
const DOOR_STEP_EPS = 0.002;
const MEMORY_DIFFUSION = 0.10;
const MEMORY_DECAY = 0.985;
const MEMORY_EPSILON = 1e-4;

const diagnosticsFrame = {
  fieldTotals: { help:0, route:0, panic:0, safe:0, escape:0, door:0 },
  hotAgents: 0,
  overwhelmedAgents: 0,
};

function normalizeFaction(ref){
  return typeof ref === 'number' ? factionById(ref) : factionByKey(ref);
}

function safePhaseForId(fid){
  return factionSafePhases[fid] ?? factionSafePhases[DEFAULT_FACTION_ID];
}

function safeDepositForFaction(faction){
  return faction.safeDeposit ?? (fieldConfig.safe?.depositBase ?? 0.02);
}

const PRESENCE_DIFFUSION = 0.08;
const PRESENCE_HALFLIFE = 8;
const PRESENCE_DEPOSIT = 0.035;
const FRONTIER_MIN_CONTEST = 0.25;
const FRONTIER_DEPOSIT = 0.02;
const DEBT_DIFFUSION = 0.10;
const DEBT_HALFLIFE = 8;
const DEBT_DEPOSIT = 0.02;
const DEBT_LOSS_HIGH = 0.6;
const DEBT_LOSS_LOW = 0.4;
const REINFORCE_THRESHOLD = 0.49;
const REINFORCE_DEPOSIT = 0.02;
const REINFORCE_DIFFUSION = 0.05;
const REINFORCE_HALFLIFE = 14;
const REINFORCE_FRONTIER_MIN = 0.1;
const REINFORCE_FRONTIER_BOOST = 0.005;

let prevDominant = null;
let prevControl = null;

function updatePresenceControl(){
  if(!world.presenceX || !world.presenceY || !world.dominantFaction || !world.controlLevel) return;
  const px = world.presenceX;
  const py = world.presenceY;
  const dom = world.dominantFaction;
  const ctrl = world.controlLevel;
  const factionCount = FACTIONS.length;
  const cos = getPresenceCos();
  const sin = getPresenceSin();
  for(let i=0;i<px.length;i++){
    if(world.wall && world.wall[i]){
      px[i] = 0;
      py[i] = 0;
      dom[i] = -1;
      ctrl[i] = 0;
      continue;
    }
    let bestId = -1;
    let bestPos = 0;
    let sumPos = 0;
    const x = px[i];
    const y = py[i];
    if(x === 0 && y === 0){
      dom[i] = -1;
      ctrl[i] = 0;
      continue;
    }
    for(let f=0; f<factionCount; f++){
      const proj = x * cos[f] + y * sin[f];
      if(proj > 0){
        sumPos += proj;
        if(proj > bestPos){
          bestPos = proj;
          bestId = f;
        }
      }
    }
    if(bestId >= 0 && sumPos > 0){
      dom[i] = bestId;
      ctrl[i] = clamp01(bestPos / sumPos);
    } else {
      dom[i] = -1;
      ctrl[i] = 0;
    }
  }
}

function updateFrontierFields(){
  if(!world.frontierByFaction || !world.dominantFaction || !world.controlLevel) return;
  const dom = world.dominantFaction;
  const ctrl = world.controlLevel;
  const frontier = world.frontierByFaction;
  const contestVals = new Float32Array(dom.length);
  for(let i=0;i<dom.length;i++){
    if(dom[i] < 0 || (world.wall && world.wall[i])){
      contestVals[i] = 0;
      continue;
    }
    const control = ctrl[i] ?? 0;
    contestVals[i] = 1 - Math.abs(2 * control - 1);
  }
  for(const field of frontier) field.fill(0);
  for(let i=0;i<dom.length;i++){
    const contest = contestVals[i];
    if(contest <= FRONTIER_MIN_CONTEST) continue;
    const x = i % world.W;
    const y = (i / world.W) | 0;
    for(const faction of FACTIONS){
      const fid = faction.id;
      let hasFriendly = false;
      let hasHostile = false;
      for(const [dx,dy] of DIRS4){
        const nx = x + dx;
        const ny = y + dy;
        if(!inBounds(nx, ny)) continue;
        const ni = idx(nx, ny);
        if(world.wall && world.wall[ni]) continue;
        const neighborFaction = dom[ni];
        if(neighborFaction < 0) continue;
        const affinity = factionAffinity(fid, neighborFaction);
        if(neighborFaction === fid || affinity > 0){
          hasFriendly = true;
        } else if(affinity < 0){
          hasHostile = true;
        }
      }
      if(hasFriendly && hasHostile){
        frontier[fid][i] = Math.min(1, frontier[fid][i] + contest * FRONTIER_DEPOSIT);
      }
    }
  }
  const frontierCfg = fieldConfig.safe;
  for(const field of frontier){
    updateField(field, frontierCfg);
    clampField01(field);
  }
}

function seedControlDebt(){
  if(!world.debtByFaction || !world.dominantFaction || !world.controlLevel) return;
  const dom = world.dominantFaction;
  const ctrl = world.controlLevel;
  if(!prevDominant || prevDominant.length !== dom.length){
    prevDominant = new Int16Array(dom.length);
    prevDominant.fill(-1);
  }
  if(!prevControl || prevControl.length !== ctrl.length){
    prevControl = new Float32Array(ctrl.length);
  }
  for(let i=0;i<dom.length;i++){
    if(world.wall && world.wall[i]) continue;
    const was = prevDominant[i];
    const wasConf = prevControl[i] ?? 0;
    const now = dom[i];
    const nowConf = ctrl[i] ?? 0;
    const lost = (was >= 0 && wasConf > DEBT_LOSS_HIGH) && (now !== was || nowConf < DEBT_LOSS_LOW);
    if(!lost) continue;
    const hostile = (now >= 0) ? (factionAffinity(was, now) < 0) : true;
    if(!hostile) continue;
    const deposit = DEBT_DEPOSIT * Math.max(0, wasConf - nowConf);
    if(deposit <= 0) continue;
    const field = world.debtByFaction[was];
    if(field) field[i] = Math.min(1, (field[i] ?? 0) + deposit);
  }
  if(dom.length) prevDominant.set(dom);
  if(ctrl.length) prevControl.set(ctrl);
}

function seedReinforcement(){
  //console.log("in seedReinforcemnt");
  if(!world.reinforceByFaction || !world.dominantFaction || !world.controlLevel) return;
  //console.log("passed the first seedRein...");
  const dom = world.dominantFaction;
  const ctrl = world.controlLevel;
  //console.log("dom length:", dom.length);
  for(let i=0;i<dom.length;i++){
    if(world.wall && world.wall[i]) continue;
    //console.log("after wall check in SeedRien..");
    //console.log("dom:", dom[i]);
    const fid = dom[i];
    //console.log("after setting fid in SeedRien..");
    if(fid < 0) continue;
    //console.log("after fid check in seedRein..");
    const strength = ctrl[i] ?? 0;
    if(strength <= REINFORCE_THRESHOLD) continue;
    //console.log("after strength check in seedRein..");
    const field = world.reinforceByFaction[fid];
    if(!field) continue;
    //console.log("after !field check in seedRein..");
    const deposit = REINFORCE_DEPOSIT * (strength - REINFORCE_THRESHOLD);
    if(deposit <= 0) continue;
    //console.log("after deposit check in seedRein..");
    field[i] = Math.min(1, field[i] + deposit);
    //console.log("Seeding reinforcement");
    if(debugConfig.enableLogs?.reinforceSeed){
      const x = i % world.W;
      const y = (i / world.W) | 0;
      console.log(`[reinforce] deposit`, { tile: `${x},${y}`, faction: fid, ctrl: strength.toFixed(3), deposit: deposit.toFixed(5), value: field[i].toFixed(4) });
    }
  }
}

function maybeBoostFrontierFromReinforce(fromIdx, toIdx, factionId){
  if(!world.reinforceByFaction || !world.frontierByFaction) return;
  const reinforceField = world.reinforceByFaction[factionId];
  const frontierField = world.frontierByFaction[factionId];
  if(!reinforceField || !frontierField) return;
  const fromVal = reinforceField[fromIdx] ?? 0;
  if(fromVal <= REINFORCE_FRONTIER_MIN) return;
  const dom = world.dominantFaction;
  const ctrl = world.controlLevel;
  if(!dom || !ctrl) return;
  const domNext = dom[toIdx];
  const ctrlNext = ctrl[toIdx] ?? 0;
  const contested = (domNext < 0) || (domNext !== factionId && ctrlNext <= REINFORCE_THRESHOLD);
  if(!contested) return;
  const boost = REINFORCE_FRONTIER_BOOST * fromVal;
  if(boost <= 0) return;
  frontierField[toIdx] = Math.min(1, frontierField[toIdx] + boost);
}

function updateField(field, cfg, { skipWalls = true } = {}){
  if(!field || !cfg) return;
  diffuse(field, cfg?.D ?? 0);
  const keep = decayMultiplierFromHalfLife(cfg?.tHalf ?? 1);
  for(let i=0;i<field.length;i++){
    if(skipWalls && world.wall[i]) continue;
    const v = field[i] * keep;
    field[i] = v < 0.0001 ? 0 : v;
  }
}

function clampField01(field){
  if(!field) return;
  for(let i=0;i<field.length;i++){
    const v = field[i];
    if(v <= 0) field[i] = 0;
    else if(v >= 1) field[i] = 1;
  }
}

function sumField(field){
  if(!field) return 0;
  let total = 0;
  for(let i=0;i<field.length;i++) total += field[i];
  return total;
}

function assertField01(name, field){
  if(!field) return;
  for(let i=0;i<field.length;i++){
    const v = field[i];
    if(!(v >= 0 && v <= 1)){
      throw new Error(`${name}[${i}] out of [0,1]: ${v}`);
    }
  }
}

function movementWeightsFor(agent){
  if(agent?.isMedic){
    return {
      safety:0.22,
      help:0.9,
      route:0.28,
      panic:-0.18,
      safe:0.0,
      escape:0.2,
      visited:-0.05,
      myFrontier:0.15,
      debt:0.10,
      controlGradReward:0.05,
      reinforce:0.06,
      mySafeMem:0.0,
      rivalSafeMem:0.0,
      mySafeField:0.12,
      rivalSafeField:-0.1,
      allyPresence:0.0,
      rivalPresence:-0.05,
      ourTurf:0.12,
      rivalTurf:-0.18,
    };
  }
  return {
    safety:0.45,
    help:-0.32,
    route:0.22,
    panic:-0.6,
    safe:0.0,
    escape:0.2,
    visited:-0.35,
    myFrontier:0.28,
    mySafeMem:0.3,
    rivalSafeMem:-0.28,
    mySafeField:0.5,
    rivalSafeField:-0.24,
    allyPresence:0.38,
    rivalPresence:-0.42,
    ourTurf:0.35,
    rivalTurf:-0.5,
    debt:0.12,
    controlGradReward:0.12,
    reinforce:0.1,
  };
}

function scoredNeighbor(agent, nx, ny, weights){
  if(!inBounds(nx,ny)) return -Infinity;
  const k = idx(nx, ny);
  if(world.wall[k]) return -Infinity;
  const safety = Math.max(0, Math.min(1, safetyScore(nx, ny)));
  const help = world.helpField ? world.helpField[k] ?? 0 : 0;
  const route = world.routeField ? world.routeField[k] ?? 0 : 0;
  const panic = world.panicField ? world.panicField[k] ?? 0 : 0;
  const safe = world.safeField ? world.safeField[k] ?? 0 : 0;
  const escape = world.escapeField ? world.escapeField[k] ?? 0 : 0;
  const visited = world.visited ? world.visited[k] ?? 0 : 0;
  const factionId = agent?.factionId ?? DEFAULT_FACTION_ID;
  const hereIdx = agent ? idx(agent.x, agent.y) : k;
  const mySafeMem = projectOnto(world.memX, world.memY, k, safePhaseForId(factionId));
  const cosArr = getPresenceCos();
  const sinArr = getPresenceSin();
  let allyPresence = 0;
  if(world.presenceX && world.presenceY){
    const selfProj = world.presenceX[k] * cosArr[factionId] + world.presenceY[k] * sinArr[factionId];
    if(selfProj > 0) allyPresence = selfProj;
  }
  let rivalPresence = 0;
  let mySafeField = 0;
  let rivalSafeField = 0;
  let ourTurf = 0;
  let myFrontier = 0;
  let rivalTurf = 0;
  let myDebt = 0;
  let controlGrad = 0;
  let myReinforce = 0;
  if(world.safeFieldsByFaction){
    const myField = world.safeFieldsByFaction[factionId];
    if(myField) mySafeField = myField[k] ?? 0;
  }
  if(world.frontierByFaction){
    const myFrontierField = world.frontierByFaction[factionId];
    if(myFrontierField) myFrontier = myFrontierField[k] ?? 0;
  }
  if(world.debtByFaction){
    const debtField = world.debtByFaction[factionId];
    if(debtField) myDebt = debtField[k] ?? 0;
  }
  if(world.reinforceByFaction){
    const reinforceField = world.reinforceByFaction[factionId];
    if(reinforceField) myReinforce = reinforceField[k] ?? 0;
  }
  if(world.presenceX && world.presenceY){
    const px = world.presenceX[k];
    const py = world.presenceY[k];
    for(const faction of FACTIONS){
      const otherId = faction.id;
      if(otherId === factionId) continue;
      const affinity = factionAffinity(factionId, otherId);
      if(affinity === 0) continue;
      const cos = cosArr[otherId];
      const sin = sinArr[otherId];
      const proj = px * cos + py * sin;
      if(proj <= 0) continue;
      if(affinity > 0){
        allyPresence = Math.min(1, allyPresence + proj * Math.max(0.1, affinity));
      } else if(affinity < 0){
        rivalPresence = Math.min(1, rivalPresence + proj * -affinity);
      }
    }
  }
  if(world.safeFieldsByFaction){
    for(const faction of FACTIONS){
      const otherId = faction.id;
      if(otherId === factionId) continue;
      const affinity = factionAffinity(factionId, otherId);
      const field = world.safeFieldsByFaction[otherId];
      if(!field) continue;
      const val = field[k] ?? 0;
      if(val <= 0) continue;
      if(affinity > 0){
        mySafeField = Math.max(mySafeField, val * affinity);
      } else if(affinity < 0){
        rivalSafeField = Math.max(rivalSafeField, val * -affinity);
      }
    }
  }
  if(world.dominantFaction && world.controlLevel){
    const dom = world.dominantFaction[k];
    const conf = world.controlLevel[k] ?? 0;
    if(dom >= 0 && conf > 0.05){
      const affinity = factionAffinity(factionId, dom);
      if(dom === factionId || affinity > 0){
        ourTurf = Math.max(ourTurf, conf);
      } else if(affinity < 0){
        rivalTurf = Math.max(rivalTurf, conf * -affinity);
      }
    }
    if(agent){
      const domHere = world.dominantFaction[hereIdx];
      const ctrlHere = world.controlLevel[hereIdx] ?? 0;
      const ctrlNext = conf;
      let myHere = 0;
      if(domHere >= 0){
        const affinityHere = factionAffinity(factionId, domHere);
        if(domHere === factionId || affinityHere > 0){
          myHere = ctrlHere;
        }
      }
      let myNext = 0;
      if(dom >= 0){
        const affinityNext = factionAffinity(factionId, dom);
        if(dom === factionId || affinityNext > 0){
          myNext = ctrlNext;
        }
      }
      const delta = myNext - myHere;
      if(delta > 0) controlGrad = delta;
    }
  }
  let rivalSafeMem = 0;
  for(const faction of FACTIONS){
    const otherId = faction.id;
    if(otherId === factionId) continue;
    const affinity = factionAffinity(factionId, otherId);
    if(affinity >= 0) continue;
    const proj = projectOnto(world.memX, world.memY, k, safePhaseForId(otherId));
    if(proj > 0) rivalSafeMem = Math.max(rivalSafeMem, proj * -affinity);
  }
  return (
    (weights.safety ?? 0) * safety +
    (weights.help ?? 0)   * help +
    (weights.route ?? 0)  * route +
    (weights.panic ?? 0)  * panic +
    (weights.safe ?? 0)   * safe +
    (weights.mySafeField ?? 0) * mySafeField +
    (weights.rivalSafeField ?? 0) * rivalSafeField +
    (weights.escape ?? 0) * escape +
    (weights.visited ?? 0) * visited +
    (weights.mySafeMem ?? 0) * mySafeMem +
    (weights.rivalSafeMem ?? 0) * rivalSafeMem +
    (weights.allyPresence ?? 0) * allyPresence +
    (weights.rivalPresence ?? 0) * rivalPresence +
    (weights.ourTurf ?? 0) * ourTurf +
    (weights.rivalTurf ?? 0) * rivalTurf +
    (weights.myFrontier ?? 0) * myFrontier +
    (weights.debt ?? 0) * myDebt +
    (weights.controlGradReward ?? 0) * controlGrad +
    (weights.reinforce ?? 0) * myReinforce
  );
}

function hazardHere(k){
  const heat = world.heat[k] ?? 0;
  const panic = world.panicField ? world.panicField[k] ?? 0 : 0;
  const o2 = world.o2[k] ?? 0;
  return clamp01(0.6 * heat + 0.3 * panic + 0.1 * (1 - o2));
}

function mayExplore(agent){
  const k = idx(agent.x, agent.y);
  const safeHere = world.safeField ? world.safeField[k] ?? 0 : 0;
  const hzHere = hazardHere(k);
  const tension = agent.S?.tension ?? 0.5;
  const amplitude = agent.S?.amplitude ?? 0.2;
  const curiosity = clamp01((tension - 0.5) - (amplitude - 0.3));
  const okSafe = safeHere > 0.65;
  const okHazard = hzHere < 0.25;
  const okMood = curiosity > 0.2;
  return okSafe && okHazard && okMood ? curiosity : 0;
}

function tryCuriosityStep(agent){
  const here = idx(agent.x, agent.y);
  const safeHere = world.safeField ? world.safeField[here] ?? 0 : 0;
  let best = { score: -Infinity, x: agent.x, y: agent.y };
  for(const [dx,dy] of DIRS4){
    const nx = agent.x + dx;
    const ny = agent.y + dy;
    if(!inBounds(nx, ny)) continue;
    const nk = idx(nx, ny);
    if(world.wall[nk]) continue;
    const safeNext = world.safeField ? world.safeField[nk] ?? 0 : 0;
    const edgeBias = Math.max(0, safeHere - safeNext);
    if(edgeBias <= 0) continue;
    const hz = hazardHere(nk);
    if(hz > 0.35) continue;
    const novelty = world.visited ? 1 - (world.visited[nk] ?? 0) : 1;
    const score = 0.5 * edgeBias + 0.8 * novelty - 0.4 * hz + randomCentered() * 0.0005;
    if(score > best.score) best = { score, x: nx, y: ny };
  }
  if(best.score > -Infinity && (best.x !== agent.x || best.y !== agent.y)){
    agent.x = best.x;
    agent.y = best.y;
    return true;
  }
  return false;
}

function localCrowdPenalty(x,y){
  let penalty = 0;
  let seen = 0;
  for(const agent of world.agents){
    const dx = Math.abs(agent.x - x);
    const dy = Math.abs(agent.y - y);
    if(dx > 2 || dy > 2) continue;
    const dist = dx + dy;
    if(dist === 0){
      penalty +=0;// 0.45;
    } else if(dist === 1){
      penalty += 0;//0.28;
    } else if(dist === 2){
      penalty += 0;//0.14;
    }
    if(++seen >= 12) break;
    if(penalty >= 1.0) return 1.0;
  }
  return penalty;
}

function safetyScore(x,y){
  if(!inBounds(x,y)) return -Infinity;
  const k = idx(x,y);
  if(world.wall[k]) return -Infinity;
  const heat = world.heat[k] ?? 0;
  const o2 = world.o2[k] ?? 0;
  const S = world.strings[k];
  const fireAmp = clamp01(S?.mode === Mode.FIRE ? (S?.amplitude ?? 0) : 0);
  const crowd = localCrowdPenalty(x,y);
  return clamp01(0.55 * (1 - heat) + 0.28 * o2 + 0.10 * (1 - fireAmp) - 0.07 * crowd);
}

function bestDirectionByHeat(x,y,radius=2){
  const hereHeat = world.heat[idx(x,y)] ?? 1;
  let best = { dx:0, dy:0, h: hereHeat };
  for(let r=1; r<=radius; r++){
    for(let dx=-r; dx<=r; dx++){
      for(let dy=-r; dy<=r; dy++){
        if(Math.abs(dx) + Math.abs(dy) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if(!inBounds(nx,ny)) continue;
        const k = idx(nx,ny);
        if(world.wall[k]) continue;
        const h = world.heat[k];
        if(h < best.h - 0.001){
          const stepX = dx === 0 ? 0 : dx / Math.abs(dx);
          const stepY = dy === 0 ? 0 : dy / Math.abs(dy);
          best = { dx: stepX, dy: stepY, h };
        }
      }
    }
    if(best.h < hereHeat - 0.02) break;
  }
  return best;
}

function setHeadingFromVector(S, dx, dy){
  if(dx === 0 && dy === 0) return;
  S.phase = wrapTau(Math.atan2(dy, dx));
}

function stepAlongPhase(agent){
  const ang = agent.S.phase ?? 0;
  let best = { dx:0, dy:0, diff: Infinity };
  for(const [dx,dy] of DIRS4){
    const nx = agent.x + dx;
    const ny = agent.y + dy;
    if(!inBounds(nx,ny) || world.wall[idx(nx,ny)]) continue;
    const dirAng = Math.atan2(dy, dx);
    let diff = Math.abs(ang - dirAng);
    if(diff > Math.PI) diff = TAU - diff;
    if(diff < best.diff){
      best = { dx, dy, diff };
    }
  }
  if(best.diff < Infinity){
    agent.x += best.dx;
    agent.y += best.dy;
    return true;
  }
  return false;
}

function tryRandomStep(agent){
  const dirs = DIRS4;
  for(let attempt=0; attempt<4; attempt++){
    const choice = dirs[randomInt(dirs.length)];
    const [dx,dy]=choice;
    const nx=agent.x+dx, ny=agent.y+dy;
    if(inBounds(nx,ny) && !world.wall[idx(nx,ny)]){
      agent.x=nx; agent.y=ny; return true;
    }
  }
  return false;
}

function twoStepEscapeOK(x,y){
  const hereHeat = world.heat[idx(x,y)] ?? 0;
  for(const [dx,dy] of DIRS4){
    const mx = x + dx;
    const my = y + dy;
    if(!inBounds(mx,my) || world.wall[idx(mx,my)]) continue;
    const midHeat = world.heat[idx(mx,my)] ?? 1;
    if(midHeat > hereHeat + 0.05) continue;
    const best = bestDirectionByHeat(mx,my,2);
    if(best.h < hereHeat - 0.05){
      return { nx: mx, ny: my };
    }
  }
  return null;
}

export class Agent{
  constructor(x,y,mode,factionRef=DEFAULT_FACTION_ID){
    this.x = x;
    this.y = y;
    this.id = allocateAgentId();
    this.S = baseStringFor(mode);
    this.panicLevel = 0;
    this.role = mode;
    this.isMedic = mode === Mode.MEDIC;
    const faction = normalizeFaction(factionRef);
    this.factionId = faction.id;
    this.factionKey = faction.key;
    this.faction = faction.key; // legacy compatibility
    if(this.isMedic){
      this.medicConfig = roles.medic || {
        auraRadius: 3,
        auraTensionBoost: 0.01,
        auraAmplitudeDrop: 0.02,
        burstTensionBoost: 0.1,
        burstAmplitudeDrop: 0.05,
        burstCooldown: 12,
        burstTriggerTension: 0.4,
        stressResistance: { heat:true, social:true, oxygen:false },
      };
      this.medicCooldown = 0;
      this.medicTarget = null;
      this.medicPath = [];
      this.medicScanTimer = 0;
      this.medicRepathTimer = 0;
      this._medicPickNewScoutDir();
    }
    this.phaseShock = 0;
    this.lastRouteIdx = -1;

    // panic escape helpers (set during overwhelmed heat responses)
    this.panicRunTicks = 0;
    this.panicRunDx = 0;
    this.panicRunDy = 0;
    this.panicFailureCount = 0;
  }
  _medicAcquireTarget(){
    const aura = this.medicConfig;
    const limit = aura.maxAssignmentsPerTarget ?? 1;
    let best = null;
    let bestScore = Infinity;
    for(const agent of world.agents){
      if(agent === this || agent.role === Mode.MEDIC) continue;
      const tension = agent.S?.tension ?? 1;
      const amplitude = agent.S?.amplitude ?? 0;
      const isPanicking = agent.S?.mode === Mode.PANIC;
      if(!isPanicking && tension > aura.burstTriggerTension) continue;
      const dist = Math.abs(agent.x - this.x) + Math.abs(agent.y - this.y);
      if(dist > (aura.searchRadius ?? 32)) continue;
      const assigned = medicAssignments.get(agent) ?? 0;
      if(assigned >= limit && this.medicTarget !== agent) continue;
      const score = tension + dist * 0.05 - (isPanicking ? 0.2 : 0);
      if(score < bestScore){
        bestScore = score;
        best = agent;
      }
    }
    if(best !== this.medicTarget){
      this._medicReleaseTarget();
      this.medicTarget = best || null;
      if(this.medicTarget){
        medicAssignments.set(this.medicTarget, (medicAssignments.get(this.medicTarget) ?? 0) + 1);
      }
      this.medicPath = [];
    }
  }

  _medicPlanPath(){
    const target = this.medicTarget;
    if(!target) return;
    const aura = this.medicConfig;
    const maxRange = aura.searchRadius ?? 32;
    const start = idx(this.x, this.y);
    const goal = idx(target.x, target.y);
    const queue = [start];
    const cameFrom = new Map([[start, null]]);
    const limit = maxRange * maxRange;
    while(queue.length && !cameFrom.has(goal) && cameFrom.size < limit){
      const current = queue.shift();
      const cx = current % world.W;
      const cy = (current / world.W) | 0;
      for(const [dx,dy] of DIRS4){
        const nx = cx + dx;
        const ny = cy + dy;
        if(!inBounds(nx, ny)) continue;
        const nIdx = idx(nx, ny);
        if(cameFrom.has(nIdx)) continue;
        if(world.wall[nIdx]) continue;
        if(world.fire.has(nIdx)) continue;
        cameFrom.set(nIdx, current);
        queue.push(nIdx);
      }
    }
    if(!cameFrom.has(goal)){
      this.medicPath = [];
      return;
    }
    const path = [];
    let current = goal;
    while(current !== null && current !== start){
      path.push(current);
      current = cameFrom.get(current) ?? null;
    }
    this.medicPath = path.reverse();
  }

  _medicPickNewScoutDir(){
    const dirs = DIRS4;
    const choice = dirs[randomInt(dirs.length)];
    this.medicScoutDir = { dx: choice[0], dy: choice[1] };
  }

  _resetPanicRun(){
    this.panicRunTicks = 0;
    this.panicRunDx = 0;
    this.panicRunDy = 0;
  }

  _resetPanicFailure(){
    this.panicFailureCount = 0;
  }

  _medicClimbHelp(field){
    if(!field) return false;
    const hereIndex = idx(this.x, this.y);
    const hereValue = field[hereIndex] ?? 0;
    let bestValue = hereValue;
    let bestX = this.x;
    let bestY = this.y;
    for(const [dx,dy] of DIRS4){
      const nx = this.x + dx;
      const ny = this.y + dy;
      if(!inBounds(nx,ny)) continue;
      const ni = idx(nx, ny);
      if(world.wall[ni] || world.fire.has(ni)) continue;
      const val = field[ni] ?? 0;
      if(val > bestValue){
        bestValue = val;
        bestX = nx;
        bestY = ny;
      }
    }
    if(bestValue > hereValue + 0.004){
      if(world.routeField){
        const deposit = fieldConfig.route?.depositBase ?? 0.04;
        world.routeField[hereIndex] = Math.min(1, (world.routeField[hereIndex] || 0) + deposit);
        depositTagged(world.memX, world.memY, hereIndex, deposit, MTAG.ROUTE);
      }
      this.x = bestX;
      this.y = bestY;
      this.medicPath = [];
      if(this.medicTarget){
        this.medicRepathTimer = Math.min(this.medicRepathTimer, 1);
      }
      this.lastRouteIdx = hereIndex;
      return true;
    }
    return false;
  }

  _medicFollowRoute(field){
    if(!field) return false;
    const hereIndex = idx(this.x, this.y);
    const hereValue = field[hereIndex] ?? 0;
    let bestValue = hereValue;
    let bestX = this.x;
    let bestY = this.y;
    for(const [dx,dy] of DIRS4){
      const nx = this.x + dx;
      const ny = this.y + dy;
      if(!inBounds(nx,ny)) continue;
      const ni = idx(nx, ny);
      if(world.wall[ni] || world.fire.has(ni)) continue;
      const val = field[ni] ?? 0;
      if(ni === this.lastRouteIdx && val < hereValue + 0.01) continue;
      if(val > bestValue + 0.002){
        bestValue = val;
        bestX = nx;
        bestY = ny;
      }
    }
    if(bestValue > hereValue + 0.002){
      if(world.routeField){
        const deposit = fieldConfig.route?.depositBase ?? 0.04;
        world.routeField[hereIndex] = Math.min(1, (world.routeField[hereIndex] || 0) + deposit);
        depositTagged(world.memX, world.memY, hereIndex, deposit, MTAG.ROUTE);
      }
      this.x = bestX;
      this.y = bestY;
      this.lastRouteIdx = hereIndex;
      return true;
    }
    return false;
  }

  _medicWander(){
    if(!this.medicScoutDir) this._medicPickNewScoutDir();
    for(let attempt=0; attempt<4; attempt++){
      const dir = this.medicScoutDir;
      const nx = this.x + dir.dx;
      const ny = this.y + dir.dy;
      if(inBounds(nx,ny)){
        const ni = idx(nx, ny);
        if(!world.wall[ni] && !world.fire.has(ni)){
          const hereIndex = idx(this.x, this.y);
          this.x = nx;
          this.y = ny;
          this.lastRouteIdx = hereIndex;
        if(random() < 0.2) this._medicPickNewScoutDir();
          return;
        }
      }
      this._medicPickNewScoutDir();
    }
  }

  _medicAdvance(){
    const helpField = world.helpField;
    if(helpField && this._medicClimbHelp(helpField)){
      return;
    }
    if(!this.medicTarget){
      const routeField = world.routeField;
      if(routeField && this._medicFollowRoute(routeField)) return;
      this._medicWander();
      return;
    }
    const target = this.medicTarget;
    if(target.S?.mode !== Mode.PANIC && target.S?.tension > this.medicConfig.burstTriggerTension){
      this._medicReleaseTarget();
      return;
    }
    if(!this.medicPath.length) return;
    const next = this.medicPath.shift();
    const nx = next % world.W;
    const ny = (next / world.W) | 0;
    if(world.wall[next] || world.fire.has(next)){
      this.medicPath = [];
      return;
    }
    const hereIndex = idx(this.x, this.y);
    if(world.routeField){
      const deposit = fieldConfig.route?.depositBase ?? 0.04;
      world.routeField[hereIndex] = Math.min(1, (world.routeField[hereIndex] || 0) + deposit);
      depositTagged(world.memX, world.memY, hereIndex, deposit, MTAG.ROUTE);
    }
    this.x = nx;
    this.y = ny;
    this.lastRouteIdx = hereIndex;
  }

  _medicReleaseTarget(){
    if(this.medicTarget){
      const current = medicAssignments.get(this.medicTarget) ?? 0;
      if(current <= 1){
        medicAssignments.delete(this.medicTarget);
      } else {
        medicAssignments.set(this.medicTarget, current - 1);
      }
    }
    this.medicTarget = null;
    this.medicPath = [];
  }

  _doStep(bins){
    const hereIdx = idx(this.x, this.y);
    const hereHeat = world.heat[hereIdx] ?? 0;
    if(hereHeat > thresholds.heat.highThreshold){
      diagnosticsFrame.hotAgents += 1;
    }
    let panicWeight = 0;
    if(!this.isMedic){
      panicWeight = clamp01((this.S?.amplitude ?? 0) - 0.3 + (0.6 - (this.S?.tension ?? 0)));
      let escapeDeposited = false;
      let minNeighborHeat = Infinity;
      for(const [dx,dy] of DIRS4){
        const nx = this.x + dx;
        const ny = this.y + dy;
        if(!inBounds(nx,ny)) continue;
        const h = world.heat[idx(nx,ny)] ?? 1;
        if(h < minNeighborHeat) minNeighborHeat = h;
      }
      const overwhelmed = (hereHeat > thresholds.heat.highThreshold) &&
                          (minNeighborHeat >= hereHeat - 0.05) &&
                          ((this.S?.amplitude ?? 0) > 0.6) &&
                          ((this.S?.tension ?? 0) < 0.45);
      if(overwhelmed) diagnosticsFrame.overwhelmedAgents += 1;
      const markEscapeTrail = ()=>{
        if(!world.escapeField) return;
        const newIdx = idx(this.x, this.y);
        const newHeat = world.heat[newIdx] ?? 0;
        if(newHeat < hereHeat){
          const deposit = fieldConfig.escape?.depositBase ?? 0.04;
          world.escapeField[newIdx] = Math.min(1, (world.escapeField[newIdx] || 0) + deposit);
          world.escapeField[hereIdx] = Math.min(1, (world.escapeField[hereIdx] || 0) + deposit * 0.5);
          depositTagged(world.memX, world.memY, newIdx, deposit, MTAG.ESCAPE);
          depositTagged(world.memX, world.memY, hereIdx, deposit * 0.5, MTAG.ESCAPE);
          escapeDeposited = true;
        }
      };
      if(overwhelmed){
        if(world.doorField && world.doorTiles && world.doorTiles.size){
          const hereDoor = world.doorField[hereIdx] ?? 0;
          let bestDoor = hereDoor;
          let doorX = this.x;
          let doorY = this.y;
          for(const [dx,dy] of DIRS4){
            const nx = this.x + dx;
            const ny = this.y + dy;
            if(!inBounds(nx,ny)) continue;
            const nIdx = idx(nx, ny);
            if(world.wall[nIdx]) continue;
            const val = world.doorField[nIdx] ?? 0;
            if(val > bestDoor + DOOR_STEP_EPS){
              bestDoor = val;
              doorX = nx;
              doorY = ny;
            }
          }
          if(bestDoor > hereDoor + DOOR_STEP_EPS){
            this.x = doorX;
            this.y = doorY;
            this._resetPanicRun();
            this._resetPanicFailure();
            markEscapeTrail();
            return;
          }
        }
        let registeredFailure = true;
        const attemptPanicRunStep = () => {
          if(this.panicRunTicks <= 0) return false;
          const nx = this.x + this.panicRunDx;
          const ny = this.y + this.panicRunDy;
          if(!inBounds(nx, ny)){
            this._resetPanicRun();
            return false;
          }
          const nIdx = idx(nx, ny);
          if(world.wall[nIdx] || world.fire.has(nIdx)){
            this._resetPanicRun();
            return false;
          }
          const nextHeat = world.heat[nIdx] ?? 1;
          this.x = nx;
          this.y = ny;
          this.panicRunTicks = Math.max(0, this.panicRunTicks - 1);
          this._resetPanicFailure();
          registeredFailure = false;
          if(nextHeat < hereHeat) markEscapeTrail();
          return true;
        };

        if(this.panicRunTicks > 0 && attemptPanicRunStep()){
          return;
        }

        const dir = bestDirectionByHeat(this.x, this.y, 2);
        const hasDirection = (dir.dx !== 0 || dir.dy !== 0);
        const heatDrop = hereHeat - dir.h;
        if(hasDirection && heatDrop >= PANIC_MIN_HEAT_DROP){
          this.panicRunDx = dir.dx;
          this.panicRunDy = dir.dy;
          this.panicRunTicks = PANIC_RUN_TICKS;
          setHeadingFromVector(this.S, dir.dx, dir.dy);
          if(attemptPanicRunStep()){
            return;
          }
        }

        const tunnel = twoStepEscapeOK(this.x, this.y);
        if(tunnel){
          this._resetPanicRun();
          this._resetPanicFailure();
          this.x = tunnel.nx;
          this.y = tunnel.ny;
          markEscapeTrail();
          return;
        }

        // After sustained failures, allow a desperate move toward stronger relief signals
        if(this.panicFailureCount >= PANIC_FAILURE_LIMIT){
          const safeHere = world.safeField ? world.safeField[hereIdx] ?? 0 : 0;
          const escapeHere = world.escapeField ? world.escapeField[hereIdx] ?? 0 : 0;
          const safetyHere = safetyScore(this.x, this.y);
          const reliefHere = Math.max(safeHere, escapeHere, safetyHere);
          let bestRelief = reliefHere;
          let bestReliefStep = null;
          for(const [dx,dy] of DIRS4){
            const nx = this.x + dx;
            const ny = this.y + dy;
            if(!inBounds(nx,ny)) continue;
            const nIdx = idx(nx, ny);
            if(world.wall[nIdx]) continue;
            const safeNext = world.safeField ? world.safeField[nIdx] ?? 0 : 0;
            const escapeNext = world.escapeField ? world.escapeField[nIdx] ?? 0 : 0;
            const safetyNext = safetyScore(nx, ny);
            const reliefNext = Math.max(safeNext, escapeNext, safetyNext);
            if(reliefNext > bestRelief + PANIC_RELIEF_DELTA){
              bestRelief = reliefNext;
              bestReliefStep = { nx, ny, heat: world.heat[nIdx] ?? 1 };
            }
          }
          if(bestReliefStep){
            this._resetPanicRun();
            this._resetPanicFailure();
            const { nx, ny, heat } = bestReliefStep;
            this.x = nx;
            this.y = ny;
            if(heat < hereHeat) markEscapeTrail();
            return;
          }
        }

        if(stepAlongPhase(this)){
          const steppedIdx = idx(this.x, this.y);
          const steppedHeat = world.heat[steppedIdx] ?? 1;
          this._resetPanicRun();
          if(steppedHeat < hereHeat){
            this._resetPanicFailure();
            markEscapeTrail();
          } else {
            this.panicFailureCount = Math.min(PANIC_FAILURE_LIMIT, this.panicFailureCount + 1);
          }
          return;
        }

        this._resetPanicRun();
        if(registeredFailure){
          this.panicFailureCount = Math.min(PANIC_FAILURE_LIMIT, this.panicFailureCount + 1);
        }
      } else {
        this._resetPanicRun();
        this._resetPanicFailure();
      }
      let moved = false;
      {
        const curiosity = mayExplore(this);
        if(curiosity && random() < (0.12 + 0.5 * curiosity)){
          if(tryCuriosityStep(this)){
            moved = true;
            maybeBoostFrontierFromReinforce(hereIdx, idx(this.x, this.y), this.factionId);
          }
        }
      }
      if(!moved){
        const weights = movementWeightsFor(this);
        let bestX = this.x;
        let bestY = this.y;
        let bestScore = scoredNeighbor(this, this.x, this.y, weights);
        for(const [dx,dy] of DIRS4){
          const nx = this.x + dx;
          const ny = this.y + dy;
          const score = scoredNeighbor(this, nx, ny, weights);
          if(score === -Infinity) continue;
          const jitter = randomCentered() * 0.001;
          if(score + jitter > bestScore + 0.0005){
            bestScore = score + jitter;
            bestX = nx;
            bestY = ny;
          }
        }
        if(bestX !== this.x || bestY !== this.y){
          const toIdx = idx(bestX, bestY);
          maybeBoostFrontierFromReinforce(hereIdx, toIdx, this.factionId);
          this.x = bestX;
          this.y = bestY;
          moved = true;
        }
      }
      if(!moved){
        const randomBias = 0.25 + panicWeight * 0.55;
        if(random() < randomBias){
          moved = tryRandomStep(this);
          if(moved){
            maybeBoostFrontierFromReinforce(hereIdx, idx(this.x, this.y), this.factionId);
          }
        }
      }
      if(!escapeDeposited && overwhelmed && world.escapeField){
        const newIdx = idx(this.x, this.y);
        if(newIdx !== hereIdx){
          const newHeat = world.heat[newIdx] ?? 0;
          if(newHeat < hereHeat){
            const deposit = fieldConfig.escape?.depositBase ?? 0.04;
            world.escapeField[newIdx] = Math.min(1, (world.escapeField[newIdx] || 0) + deposit);
            world.escapeField[hereIdx] = Math.min(1, (world.escapeField[hereIdx] || 0) + deposit * 0.5);
            depositTagged(world.memX, world.memY, newIdx, deposit, MTAG.ESCAPE);
            depositTagged(world.memX, world.memY, hereIdx, deposit * 0.5, MTAG.ESCAPE);
            escapeDeposited = true;
          }
        }
      }
    }
    let acc=0,sumPhase=0,n=0;
    const BIN=4;
    const bx=(this.x/BIN)|0, by=(this.y/BIN)|0;
    const groups = bins? (function(){
      const out=[];
      for(let gy=by-1;gy<=by+1;gy++) for(let gx=bx-1;gx<=bx+1;gx++){
        const g=bins.get(gx+","+gy);
        if(g) out.push(g);
      }
      return out;
    })() : [world.agents];

    if(this.isMedic){
      const aura = this.medicConfig;
      const neighbours = world.agents;
      this.medicScanTimer -= 1;
      this.medicRepathTimer -= 1;
      if(this.medicScanTimer <= 0){
        this.medicScanTimer = aura.scanInterval ?? 6;
        this._medicAcquireTarget();
      }
      if(this.medicTarget && (this.medicRepathTimer <= 0 || !this.medicPath.length)){
        this.medicRepathTimer = aura.repathInterval ?? 12;
        this._medicPlanPath();
      }
      this._medicAdvance();
      for(const agent of neighbours){
        if(agent === this || agent.role === Mode.MEDIC) continue;
        const dist = Math.abs(agent.x - this.x) + Math.abs(agent.y - this.y);
        if(dist <= aura.auraRadius){
          agent.S.tension = clamp01(agent.S.tension + aura.auraTensionBoost);
          agent.S.amplitude = Math.max(0, agent.S.amplitude - aura.auraAmplitudeDrop);
          if(agent.S.tension < aura.burstTriggerTension && this.medicCooldown <= 0){
            agent.S.tension = clamp01(agent.S.tension + aura.burstTensionBoost);
            agent.S.amplitude = Math.max(0, agent.S.amplitude - aura.burstAmplitudeDrop);
            this.medicCooldown = aura.burstCooldown;
          }
        }
      }
      if(this.medicCooldown > 0) this.medicCooldown -= 1;
    }
    for(const g of groups){
      for(const ag of g){
        if(ag===this) continue;
        const d=Math.hypot(ag.x-this.x, ag.y-this.y);
        if(d<=3){ acc+=couple(this.S, ag.S, 0.02); sumPhase+=ag.S.phase; n++; }
      }
    }
    if(this.phaseShock > 0){
      const wobble = randomCentered() * this.phaseShock * 2;
      this.S.phase = wrapTau(this.S.phase + wobble);
    }
    if(n>0){
      this.S.amplitude = clamp01(this.S.amplitude + acc/n);
      const avg=sumPhase/n;
      this.S.phase = lerpPhase(this.S.phase, avg, 0.1);
      // social stress lowers tension slightly when surrounded by agitated peers
      const socialStress = acc / Math.max(1,n);
      if(socialStress > thresholds.socialStress.trigger){
        if(!(this.isMedic && this.medicConfig.stressResistance.social)){
          this.S.tension = clamp01(this.S.tension - socialStress * thresholds.socialStress.tensionMultiplier);
        }
        emitFlash(this.x, this.y, {
          radius: 0.55 + socialStress * 0.6,
          life: 18,
          colorStart: '#ff53f6',
          colorEnd: '#c6ccd8',
        });
      }
    }
    const tileIdx = idx(this.x,this.y);
    const o=world.o2[tileIdx];
    if(!(this.isMedic && this.medicConfig.stressResistance.oxygen)){
      if(o < thresholds.oxygen.lowAmplitudeThreshold) this.S.amplitude = clamp01(this.S.amplitude + thresholds.oxygen.lowAmplitudeRise);
      if(o < thresholds.oxygen.lowTensionThreshold){
      // hypoxia weakens resilience (lower tension)
      this.S.tension = clamp01(this.S.tension - thresholds.oxygen.lowTensionDrop);
      const shock = 0.18 + (thresholds.oxygen.lowTensionThreshold - o) * 1.6;
      this.phaseShock = Math.min(MAX_PHASE_SHOCK, Math.max(this.phaseShock, shock));
      } else if(o > thresholds.oxygen.highTensionThreshold){
      // good oxygen lets them recover a bit
      this.S.tension = clamp01(this.S.tension + thresholds.oxygen.highTensionRecovery);
      }
    }

    const heatLevel = world.heat[tileIdx];
    if(!(this.isMedic && this.medicConfig.stressResistance.heat)){
      if(heatLevel > thresholds.heat.highThreshold){
        this.S.tension = clamp01(this.S.tension - thresholds.heat.highTensionDrop);
        const shock = 0.2 + (heatLevel - thresholds.heat.highThreshold) * 0.8;
        this.phaseShock = Math.min(MAX_PHASE_SHOCK, Math.max(this.phaseShock, shock));
      } else if(heatLevel < thresholds.heat.lowThreshold){
        this.S.tension = clamp01(this.S.tension + thresholds.heat.lowTensionRecovery);
      }
    }

    if(world.presenceX && world.presenceY){
      const faction = factionById(this.factionId ?? DEFAULT_FACTION_ID);
      const cosArr = getPresenceCos();
      const sinArr = getPresenceSin();
      const cos = cosArr[faction.id];
      const sin = sinArr[faction.id];
      const envFactor = clamp01((1 - 0.7 * heatLevel) * (0.6 + 0.4 * (o ?? 0)));
      const amount = PRESENCE_DEPOSIT * envFactor;
      world.presenceX[tileIdx] += cos * amount;
      world.presenceY[tileIdx] += sin * amount;
    }

    this.S.amplitude*=0.998;
    const currentSafety = safetyScore(this.x, this.y);
    if(currentSafety > 0.43){
      this.S.tension = clamp01(this.S.tension + 0.0025);
      this.S.amplitude = Math.max(0, this.S.amplitude - 0.0025);
    }
    if(world.safeField){
      const val = world.safeField[tileIdx] || 0;
      if(currentSafety > 0.62 && (this.S?.tension ?? 0) > 0.6){
        const baseDeposit = fieldConfig.safe?.depositBase ?? 0.02;
        world.safeField[tileIdx] = Math.min(1, val + baseDeposit);
        const faction = factionById(this.factionId ?? DEFAULT_FACTION_ID);
        const myPhase = safePhaseForId(faction.id);
        depositTagged(world.memX, world.memY, tileIdx, baseDeposit, myPhase);
        const factionSafeDeposit = safeDepositForFaction(faction);
        if(world.safeFieldsByFaction){
          const myField = world.safeFieldsByFaction[faction.id];
          if(myField) myField[tileIdx] = Math.min(1, (myField[tileIdx] ?? 0) + factionSafeDeposit);
          for(const other of FACTIONS){
            const affinity = factionAffinity(faction.id, other.id);
            if(other.id === faction.id || affinity === 0) continue;
            const otherPhase = safePhaseForId(other.id);
            if(affinity > 0){
              const support = factionSafeDeposit * affinity * 0.35;
              depositTagged(world.memX, world.memY, tileIdx, support, otherPhase);
              const otherField = world.safeFieldsByFaction[other.id];
              if(otherField) otherField[tileIdx] = Math.min(1, (otherField[tileIdx] ?? 0) + support * 0.5);
            } else if(affinity < 0){
              const penalty = baseDeposit * (-affinity) * 0.4;
              depositTagged(world.memX, world.memY, tileIdx, -penalty, otherPhase);
              const rivalField = world.safeFieldsByFaction[other.id];
              if(rivalField){
                const diminish = factionSafeDeposit * (-affinity) * 0.25;
                rivalField[tileIdx] = Math.max(0, (rivalField[tileIdx] ?? 0) - diminish);
              }
            }
          }
        }
      }
      const safeStrength = world.safeField[tileIdx] || 0;
      if(safeStrength > 0){
        const tensionBoost = fieldConfig.safe?.calmTensionBoost ?? 0;
        const amplitudeDrop = fieldConfig.safe?.calmAmplitudeDrop ?? 0;
        if(tensionBoost > 0){
          this.S.tension = clamp01(this.S.tension + safeStrength * tensionBoost);
        }
        if(amplitudeDrop > 0){
          this.S.amplitude = Math.max(0, this.S.amplitude - safeStrength * amplitudeDrop);
        }
      }
    }
    if(world.visited){
      const prevVisited = world.visited[tileIdx] ?? 0;
      world.visited[tileIdx] = Math.min(1, prevVisited + 0.02);
     // console.log('visited', tileIdx, world.visited[tileIdx])
    }
    const panicIntensity = clamp01((this.S.amplitude - 0.2) * 0.8 + (0.5 - this.S.tension));
    this.panicLevel = panicIntensity;
    if(this.isMedic){
      this.S.mode = Mode.MEDIC;
      this.panicLevel = 0;
    } else {
      if(this.S.amplitude>thresholds.panic.amplitudeHigh && this.S.tension<thresholds.panic.tensionLow) this.S.mode=Mode.PANIC;
      else if(this.S.amplitude<thresholds.panic.amplitudeLow) this.S.mode=Mode.CALM;
    }

    if(this.S?.mode === Mode.PANIC && world.helpField){
      const k = tileIdx;
      const amp = clamp01(this.S?.amplitude ?? 0);
      if(amp > 0){
        const currentHelp = world.helpField[k] || 0;
        const dHelp = (fieldConfig.help?.depositBase ?? 0.1) * amp * (1 - currentHelp);
        if(dHelp > 0){
          world.helpField[k] = Math.min(1, currentHelp + dHelp);
          depositTagged(world.memX, world.memY, k, dHelp, MTAG.HELP);
        }
        if(world.panicField){
          const currentPanic = world.panicField[k] || 0;
          const dPanic = (fieldConfig.panic?.depositBase ?? 0.05) * amp * (1 - currentPanic);
          if(dPanic > 0){
            world.panicField[k] = Math.min(1, currentPanic + dPanic);
            depositTagged(world.memX, world.memY, k, dPanic, MTAG.PANIC);
          }
        }
      }
    }

    if(this.phaseShock > 0){
      this.phaseShock *= 0.7;
      if(this.phaseShock < 0.01) this.phaseShock = 0;
    }
  }
  step(){ this._doStep(null); }
  stepWithBins(bins){ this._doStep(bins); }
}

function lerpPhase(a,b,t){
  return wrapTau(a + (b - a) * t);
}

export function worldInit(o2BaseValue, options = {}){
  resetWorld(o2BaseValue, options);
  const dom = world.dominantFaction;
  const ctrl = world.controlLevel;
  prevDominant = dom ? new Int16Array(dom.length) : null;
  if(prevDominant){
    prevDominant.fill(-1);
  }
  prevControl = ctrl ? new Float32Array(ctrl.length) : null;
}

export function populateDemoScenario(){
  const ly = Math.floor(world.H/2);
  for(let dy=-2; dy<=2; dy++){
    const x=2, y=ly+dy;
    if(inBounds(x,y)) world.vent[idx(x,y)] = 1;
  }
  const cx = Math.floor(world.W/2), cy = Math.floor(world.H/2);
  for(let dx=-8; dx<=8; dx++){
    const top=cy-7, bot=cy+7;
    if(inBounds(cx+dx, top)) world.wall[idx(cx+dx, top)] = 1;
    if(inBounds(cx+dx, bot)) world.wall[idx(cx+dx, bot)] = 1;
  }
  for(let dy=-7; dy<=7; dy++){
    const lef=cx-8, rig=cx+8;
    if(inBounds(lef, cy+dy)) world.wall[idx(lef, cy+dy)] = 1;
    if(inBounds(rig, cy+dy)) world.wall[idx(rig, cy+dy)] = 1;
  }
  world.wall[idx(cx, cy-7)] = 0;
  world.wall[idx(cx, cy+7)] = 0;

  const fireSeeds = [[cx-2,cy],[cx-1,cy],[cx,cy],[cx+2,cy],[cx+1,cy-1]];
  for(const [fx,fy] of fireSeeds){
    if(inBounds(fx,fy)){
      const i=idx(fx,fy);
      igniteTile(i, 1.2);
    }
  }
  for(let dx=-2; dx<=2; dx++) for(let dy=-1; dy<=1; dy++){
    const x=cx+5+dx, y=cy-4+dy;
    if(inBounds(x,y) && !world.wall[idx(x,y)]) world.strings[idx(x,y)] = baseStringFor(Mode.WATER);
  }
  for(let dx=-2; dx<=0; dx++) for(let dy=-1; dy<=1; dy++){
    const x=cx-6+dx, y=cy+4+dy;
    if(inBounds(x,y) && !world.wall[idx(x,y)]) world.strings[idx(x,y)] = baseStringFor(Mode.ACID);
  }
  for(let dx=1; dx<=3; dx++) for(let dy=-1; dy<=1; dy++){
    const x=cx-6+dx, y=cy+4+dy;
    if(inBounds(x,y) && !world.wall[idx(x,y)]) world.strings[idx(x,y)] = baseStringFor(Mode.BASE);
  }
  const calmResult = spawnNPC(Mode.CALM);
  if(calmResult.ok){
    const calmAgent = getAgentById(calmResult.agentId);
    if(calmAgent){
      calmAgent.x = 3;
      calmAgent.y = ly;
    }
  } else {
    console.warn('[demo] unable to spawn calm agent', calmResult);
  }
  const panicResult = spawnNPC(Mode.PANIC);
  if(panicResult.ok){
    const panicAgent = getAgentById(panicResult.agentId);
    if(panicAgent){
      panicAgent.x = cx;
      panicAgent.y = cy+1;
    }
  } else {
    console.warn('[demo] unable to spawn panic agent', panicResult);
  }
}

function tileIndexFromInput(x, y){
  if(typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)){
    const ix = Math.round(x);
    const iy = Math.round(y);
    if(inBounds(ix, iy)){
      return idx(ix, iy);
    }
  }
  return -1;
}

function findRandomSpawnTile({ retries = 200 } = {}){
  let tries = Math.max(1, retries | 0);
  while(tries--){
    const x = 1 + randomInt(world.W - 2);
    const y = 1 + randomInt(world.H - 2);
    const tile = idx(x, y);
    if(isSpawnTileOpen(tile)){
      return tile;
    }
  }
  return -1;
}

function isSpawnTileOpen(tileIdx){
  if(tileIdx < 0) return false;
  if(world.wall[tileIdx]) return false;
  if(world.fire.has(tileIdx)) return false;
  if(world.strings[tileIdx]){
    const S = world.strings[tileIdx];
    if(S && S.mode === Mode.FIRE) return false;
  }
  for(const agent of world.agents){
    if(idx(agent.x, agent.y) === tileIdx) return false;
  }
  return true;
}

export function igniteTile(tileIdx, intensity = 1){
  if(typeof tileIdx !== 'number' || tileIdx < 0 || tileIdx >= world.heat.length){
    return { ok:false, error:'out-of-bounds', tileIdx };
  }
  if(world.wall[tileIdx]){
    return { ok:false, error:'blocked', tileIdx };
  }
  const value = Number.isFinite(intensity) ? intensity : 1;
  const clampedIntensity = Math.max(0.1, Math.min(2, value));
  const normalized = Math.min(1, Math.max(0, clampedIntensity / 2));
  const heatTarget = Math.max(world.heat[tileIdx] ?? 0, 0.35 + 0.5 * normalized);
  const o2Drop = 0.03 + 0.05 * normalized;

  world.fire.add(tileIdx);
  const S = Sget(tileIdx);
  const base = baseStringFor(Mode.FIRE);
  S.mode = Mode.FIRE;
  S.phase = base.phase;
  S.tension = Math.min(S.tension ?? base.tension, base.tension);
  S.amplitude = Math.max(S.amplitude ?? 0, clampedIntensity);
  world.heat[tileIdx] = heatTarget;
  const currentO2 = world.o2[tileIdx] ?? 0;
  world.o2[tileIdx] = Math.max(0, currentO2 - o2Drop);

  return { ok:true, tileIdx, intensity: clampedIntensity };
}

export function spawnNPC(mode, factionRef=DEFAULT_FACTION_ID, options = {}){
  const faction = normalizeFaction(factionRef);
  const requested = {
    tileIdx: typeof options?.tileIdx === 'number' ? options.tileIdx | 0 : null,
    x: typeof options?.x === 'number' ? options.x : null,
    y: typeof options?.y === 'number' ? options.y : null,
    retries: typeof options?.retries === 'number' ? options.retries : undefined,
    scenarioOwned: !!options?.scenarioOwned,
  };
  const recordAttempt = (data)=>{
    const payload = {
      mode,
      factionId: faction?.id ?? null,
      requested,
      timestamp: Date.now(),
      ...data,
    };
    world.spawnDiagnostics.lastAttempt = payload;
    return payload;
  };

  if(typeof faction !== 'object' || faction == null){
    return recordAttempt({ ok: false, error: 'invalid-faction', tileIdx: requested.tileIdx ?? -1 });
  }

  let tile = -1;
  if(requested.tileIdx != null && requested.tileIdx >= 0 && requested.tileIdx < world.heat.length){
    tile = requested.tileIdx;
  }
  if(tile < 0 && requested.x != null && requested.y != null){
    tile = tileIndexFromInput(requested.x, requested.y);
  }
  if(tile >= 0 && !isSpawnTileOpen(tile)){
    return recordAttempt({ ok: false, error: 'tile-occupied', tileIdx: tile });
  }
  if(tile < 0){
    tile = findRandomSpawnTile({ retries: requested.retries ?? 200 });
    if(tile < 0){
      return recordAttempt({ ok: false, error: 'no-open-tile', tileIdx: -1 });
    }
  }

  const x = tile % world.W;
  const y = (tile / world.W) | 0;
  const agent = new Agent(x, y, mode, faction.id);
  world.agents.push(agent);
  registerAgentHandle(agent, world.agents.length - 1);
  if(requested.scenarioOwned){
    markScenarioAgent(agent.id);
  }
  return recordAttempt({ ok: true, agentId: agent.id, tileIdx: tile, scenarioOwned: requested.scenarioOwned });
}

export function canSpawnAt(tileIdx){
  return isSpawnTileOpen(tileIdx);
}

export function randomFires(n){
  for(let k=0;k<n;k++){
    const x = 1 + randomInt(world.W - 2);
    const y = 1 + randomInt(world.H - 2);
    const i=idx(x,y);
    if(!world.wall[i]){
      igniteTile(i, 1);
    }
  }
}

export function scenarioIgnite(tileIdx, intensity = 1){
  const result = igniteTile(tileIdx, intensity);
  if(result.ok){
    markScenarioFire(result.tileIdx);
  }
  return result;
}

function resolveScenarioField(name){
  switch(name){
    case 'help': return world.helpField;
    case 'route': return world.routeField;
    case 'panic': return world.panicField;
    case 'safe': return world.safeField;
    case 'escape': return world.escapeField;
    case 'door': return world.doorField;
    case 'heat': return world.heat;
    case 'o2': return world.o2;
    default:
      return null;
  }
}

function scenarioFieldBoundsOk(tileIdx, field){
  if(!field) return false;
  return typeof tileIdx === 'number' && tileIdx >= 0 && tileIdx < field.length;
}

export function scenarioReadField(tileIdx, fieldName){
  const field = resolveScenarioField(fieldName);
  if(!field){
    return { ok: false, error: 'unknown-field', field: fieldName };
  }
  if(!scenarioFieldBoundsOk(tileIdx, field)){
    return { ok: false, error: 'out-of-bounds', tileIdx };
  }
  return { ok: true, value: field[tileIdx] ?? 0 };
}

export function scenarioWriteField(tileIdx, fieldName, value){
  const field = resolveScenarioField(fieldName);
  if(!field){
    return { ok: false, error: 'unknown-field', field: fieldName };
  }
  if(!scenarioFieldBoundsOk(tileIdx, field)){
    return { ok: false, error: 'out-of-bounds', tileIdx };
  }
  const numeric = Number(value);
  const clamped = Number.isFinite(numeric) ? clamp01(numeric) : 0;
  field[tileIdx] = clamped;
  return { ok: true, value: clamped };
}

export function scenarioSwitchFaction(agentId, factionRef){
  const agent = getAgentById(agentId);
  if(!agent){
    return { ok: false, error: 'agent-not-found', agentId };
  }
  const faction = normalizeFaction(factionRef);
  if(!faction){
    return { ok: false, error: 'invalid-faction', agentId };
  }
  agent.factionId = faction.id;
  agent.factionKey = faction.key;
  agent.faction = faction.key;
  return { ok: true, agentId, factionId: faction.id };
}

export function scenarioAgentTile(agentId){
  const agent = getAgentById(agentId);
  if(!agent){
    return { ok: false, error: 'agent-not-found', agentId };
  }
  return { ok: true, value: idx(agent.x, agent.y) };
}

export function scenarioAgentCount(factionRef){
  let factionId = null;
  if(factionRef !== undefined){
    const faction = normalizeFaction(factionRef);
    if(!faction){
      return { ok: false, error: 'invalid-faction', faction: factionRef };
    }
    factionId = faction.id;
  }
  let count = 0;
  for(const agent of world.agents){
    if(!agent) continue;
    if(factionId != null && agent.factionId !== factionId) continue;
    count += 1;
  }
  return { ok: true, value: count };
}

function normaliseModeFilter(value){
  if(value == null) return null;
  if(typeof value === 'number' && Number.isFinite(value)) return value;
  const key = String(value).toUpperCase();
  return Object.prototype.hasOwnProperty.call(Mode, key) ? Mode[key] : null;
}

export function scenarioAgentIds(filterSpec = {}){
  const filter = (filterSpec && typeof filterSpec === 'object') ? filterSpec : {};
  let factionId = null;
  if(filter.faction !== undefined || filter.factionId !== undefined){
    const faction = normalizeFaction(filter.faction ?? filter.factionId);
    if(!faction){
      return { ok: false, error: 'invalid-faction', faction: filter.faction ?? filter.factionId };
    }
    factionId = faction.id;
  }
  const modeFilter = filter.mode !== undefined ? normaliseModeFilter(filter.mode) : null;
  if(filter.mode !== undefined && modeFilter == null){
    return { ok: false, error: 'invalid-mode', mode: filter.mode };
  }
  const onlyScenarioOwned = filter.scenarioOwned === true;
  const limit = Math.max(1, Math.min(Number.isFinite(filter.limit) ? filter.limit : 64, 256));

  const ids = [];
  for(const agent of world.agents){
    if(!agent) continue;
    if(factionId != null && agent.factionId !== factionId) continue;
    if(modeFilter != null && agent.role !== modeFilter && agent.S?.mode !== modeFilter) continue;
    if(onlyScenarioOwned && !world.scenarioAgents?.has(agent.id)) continue;
    ids.push(agent.id);
    if(ids.length >= limit) break;
  }
  return { ok: true, value: ids };
}

export function scenarioEmitEffect(effectType, x, y, options = {}){
  const kind = typeof effectType === 'string' ? effectType.toLowerCase() : 'burst';
  const nx = Number(x);
  const ny = Number(y);
  if(!Number.isFinite(nx) || !Number.isFinite(ny)){
    return { ok: false, error: 'invalid-coordinates' };
  }
  const opts = (options && typeof options === 'object') ? options : {};
  if(kind === 'flash'){
    const radius = Number.isFinite(opts.radius) ? Math.max(0, opts.radius) : 1;
    const life = Number.isFinite(opts.life) ? Math.max(1, opts.life) : 24;
    const colorStart = typeof opts.colorStart === 'string' ? opts.colorStart : '#ff4bf0';
    const colorEnd = typeof opts.colorEnd === 'string' ? opts.colorEnd : '#c9c9d6';
    emitFlash(nx, ny, { radius, life, colorStart, colorEnd });
  } else {
    const burstType = typeof opts.type === 'string' ? opts.type : 'spark';
    const intensityValue = Number(opts.intensity);
    const intensity = Number.isFinite(intensityValue) ? clamp01(intensityValue) : 1;
    emitParticleBurst(nx, ny, { type: burstType, intensity });
  }
  return { ok: true, value: null };
}

function scenarioTileMatchesFilter(tileIdx, filterKey){
  if(tileIdx == null || tileIdx < 0 || tileIdx >= world.heat.length){
    return false;
  }
  switch(filterKey){
    case 'open':
      return isSpawnTileOpen(tileIdx);
    case 'fireFree':
      return !world.fire.has(tileIdx);
    case 'door':
      return !!world.doorField?.[tileIdx];
    case 'any':
    default:
      return true;
  }
}

export function scenarioRandTile(filterKey = 'open'){
  const total = world.W * world.H;
  const attempts = Math.max(1, Math.min(total * 2, 2000));
  for(let i = 0; i < attempts; i++){
    const tile = randomInt(total);
    if(scenarioTileMatchesFilter(tile, filterKey)){
      return { ok: true, value: tile };
    }
  }
  for(let tile = 0; tile < total; tile++){
    if(scenarioTileMatchesFilter(tile, filterKey)){
      return { ok: true, value: tile };
    }
  }
  return { ok: false, error: 'no-matching-tile', filter: filterKey };
}

export function despawnAgent(agentId){
  const index = getAgentIndex(agentId);
  if(index == null || index < 0) return false;
  const agent = world.agents[index];
  if(!agent) return false;
  unregisterAgentHandle(agentId);
  world.agents.splice(index, 1);
  rebuildAgentIndices();
  unmarkScenarioAgent(agentId);
  return true;
}

export function cleanupScenarioArtifacts(){
  const agentIds = Array.from(world.scenarioAgents ?? []);
  for(const agentId of agentIds){
    despawnAgent(agentId);
  }
  const fireTiles = Array.from(world.scenarioFires ?? []);
  for(const tile of fireTiles){
    if(world.fire.delete(tile)){
      unmarkScenarioFire(tile);
    } else {
      unmarkScenarioFire(tile);
    }
    const S = world.strings[tile];
    if(S && S.mode === Mode.FIRE){
      world.strings[tile] = undefined;
    }
  }
  world.scenarioAgents?.clear();
  world.scenarioFires?.clear();
  if(world.spawnDiagnostics){
    world.spawnDiagnostics.lastAttempt = null;
  }
}

world.despawnAgent = despawnAgent;
world.cleanupScenarioArtifacts = cleanupScenarioArtifacts;

setFactoryWorkerSpawner((tileIdx) => {
  if(tileIdx == null) return null;
  const x = tileIdx % world.W;
  const y = (tileIdx / world.W) | 0;
  const agent = new Agent(x, y, Mode.CALM);
  agent.worker = true;
  world.agents.push(agent);
  registerAgentHandle(agent, world.agents.length - 1);
  markScenarioAgent(agent.id);
  return agent;
});

function diffuse(field, diff){
  const MAX_ALPHA = 0.22;
  const steps = Math.max(1, Math.ceil(diff / MAX_ALPHA));
  const alpha = diff / steps;
  const N = field.length;
  let cur = field;
  let tmp = new Float32Array(N);
  for(let s=0; s<steps; s++){
    for(let y=1;y<world.H-1;y++){
      for(let x=1;x<world.W-1;x++){
        const i=y*world.W+x;
        if(world.wall[i]){ tmp[i] = cur[i]; continue; }
        const c = cur[i];
        const l = world.wall[y*world.W + (x-1)] ? c : cur[y*world.W + (x-1)];
        const r = world.wall[y*world.W + (x+1)] ? c : cur[y*world.W + (x+1)];
        const u = world.wall[(y-1)*world.W + x] ? c : cur[(y-1)*world.W + x];
        const d = world.wall[(y+1)*world.W + x] ? c : cur[(y+1)*world.W + x];
        const lap = (l+r+u+d - 4*c);
        tmp[i] = c + alpha * lap;
      }
    }
    for(let y=1;y<world.H-1;y++){
      for(let x=1;x<world.W-1;x++){
        const i=y*world.W+x;
        if(world.wall[i]) continue;
        const n = (tmp[i-1]+tmp[i+1]+tmp[i-world.W]+tmp[i+world.W])*0.25;
        tmp[i] = tmp[i]*0.96 + n*0.04;
      }
    }
    const swap = cur; cur = tmp; tmp = swap;
  }
  if(cur !== field) field.set(cur);
}

export function createSimulation({ getSettings, updateMetrics, draw }){
  let paused = false;
  let acc = 0;
  let last = performance.now();
  let simTime = 0;
  let stepCount = 0;
let recorder = debugConfig.enableRecorder ? createRecorder({ size: debugConfig.recorderSize }) : null;
let acidBasePairs = new Set();

  const scenarioContext = {
    runtime: null,
    diagnostics: [],
    active: false,
    seed: null,
    source: null,
    asset: null,
  };

  function makeScenarioDiagnosticsLogger(delegate){
    return {
      log: (event) => {
        scenarioContext.diagnostics.push(event);
        if(delegate && typeof delegate.log === 'function'){
          delegate.log(event);
        }
      },
    };
  }

  function scenarioSpawnAgentHost(factionRef, mode, tileIdx){
    const options = { scenarioOwned: true };
    if(typeof tileIdx === 'number' && Number.isFinite(tileIdx)){
      options.tileIdx = tileIdx | 0;
    }
    return spawnNPC(mode, factionRef, options);
  }

  function createScenarioHost(overrides = {}){
    const baseHost = {
      ignite: (tileIdx, intensity, meta) => scenarioIgnite(tileIdx, intensity),
      spawnAgent: (factionRef, mode, tileIdx, meta) => scenarioSpawnAgentHost(factionRef, mode, tileIdx),
      switchFaction: (agentId, factionRef, meta) => scenarioSwitchFaction(agentId, factionRef),
      agentTile: (agentId, meta) => scenarioAgentTile(agentId),
      agentCount: (factionRef, meta) => scenarioAgentCount(factionRef),
      agentIds: (filterSpec, meta) => scenarioAgentIds(filterSpec),
      field: (tileIdx, fieldName, meta) => scenarioReadField(tileIdx, fieldName),
      fieldWrite: (tileIdx, fieldName, value, meta) => scenarioWriteField(tileIdx, fieldName, value),
      randTile: (filterKey, meta) => scenarioRandTile(filterKey),
      emitEffect: (effectType, x, y, options, meta) => scenarioEmitEffect(effectType, x, y, options),
    };
    return { ...baseHost, ...overrides };
  }

  function disposeScenarioRuntime(){
    if(scenarioContext.runtime && typeof scenarioContext.runtime.dispose === 'function'){
      scenarioContext.runtime.dispose();
    }
    scenarioContext.runtime = null;
    scenarioContext.active = false;
    scenarioContext.seed = null;
    scenarioContext.diagnostics = [];
    scenarioContext.asset = null;
  }

  function instantiateScenarioRuntime(){
    if(!scenarioContext.source) return { status: 'error', error: { message: 'No scenario loaded.' } };
    const { compiled, options } = scenarioContext.source;
    const {
      capabilities,
      diagnostics,
      natives,
      rng: rngOption,
      seed,
      host: hostOverrides,
    } = options ?? {};
    scenarioContext.diagnostics = [];
    const diagnosticsLogger = makeScenarioDiagnosticsLogger(diagnostics);
    const runtime = createScenarioRuntime({
      compiled,
      capabilities,
      diagnostics: diagnosticsLogger,
      natives,
      rng: rngOption ?? { random, range: randomRange },
      host: createScenarioHost(hostOverrides),
    });
    scenarioContext.runtime = runtime;
    scenarioContext.seed = seed ?? world.rngSeed ?? 0;
    scenarioContext.active = !runtime.bootstrapError;
    if(!scenarioContext.active){
      return { status: 'error', error: runtime.bootstrapError };
    }
    const initResult = runtime.runInit(scenarioContext.seed);
    if(initResult.status === 'error'){
      scenarioContext.active = false;
    }
    return initResult;
  }

  function loadScenarioRuntimeSource(compiled, options = {}){
    scenarioContext.source = { compiled, options };
    cleanupScenarioArtifacts();
    disposeScenarioRuntime();
    return instantiateScenarioRuntime();
  }

  function loadScenarioFromAsset(asset){
    if(!asset || typeof asset !== 'object'){
      return { status: 'error', error: { message: 'Invalid scenario asset.' } };
    }
    if(!asset.bytecode){
      return { status: 'error', error: { message: 'Scenario asset missing bytecode.' } };
    }
    const compiled = deserialiseCompiledProgram(asset.bytecode);
    const options = {
      capabilities: asset.capabilities,
      seed: asset.seed,
      diagnostics: asset.diagnostics,
      natives: asset.natives,
      host: asset.host,
      rng: asset.rng,
      meta: asset.meta ?? { name: asset.name },
    };
    const result = loadScenarioRuntimeSource(compiled, options);
    if(result.status === 'ok'){
      scenarioContext.asset = asset;
    }
    return result;
  }

  function tickScenario(frame, dt){
    if(!scenarioContext.runtime || !scenarioContext.active){
      return;
    }
    const result = scenarioContext.runtime.tick(frame, dt);
    if(result.status === 'error'){
      scenarioContext.active = false;
    }
  }

  function ensureRecorder(){
    if(!debugConfig.enableRecorder) return null;
    if(!recorder){
      recorder = createRecorder({ size: debugConfig.recorderSize });
    }
    return recorder;
  }

  function stepSimulation(settings, { force=false } = {}){
    if(paused && !force) return false;
    const speedMultiplier = force ? 1 : getSimSpeed();
    for(let speedStep = 0; speedStep < speedMultiplier; speedStep++){
      diagnosticsFrame.hotAgents = 0;
      diagnosticsFrame.overwhelmedAgents = 0;

      if(paused && !force) return false;

      const frameIndex = stepCount + speedStep;
      const dtSeconds = typeof settings?.dt === 'number' ? settings.dt : 1;
      tickScenario(frameIndex, dtSeconds);

      diffuse(world.heat, settings.dHeat);
      diffuse(world.o2, settings.dO2);
      updateField(world.helpField, fieldConfig.help);
      updateField(world.routeField, fieldConfig.route);
      updateField(world.panicField, fieldConfig.panic);
      updateField(world.safeField, fieldConfig.safe);
      updateField(world.escapeField, fieldConfig.escape);
      if(world.safeFieldsByFaction){
        for(const field of world.safeFieldsByFaction){
          updateField(field, fieldConfig.safe);
        }
      }
      if(world.doorField){
        if(world.doorTiles && world.doorTiles.size){
          for(const k of world.doorTiles){
            world.doorField[k] = 1;
          }
        }
        updateField(world.doorField, fieldConfig.door);
        if(world.doorTiles && world.doorTiles.size){
          for(const k of world.doorTiles){
            world.doorField[k] = 1;
          }
        }
      }
      updateField(world.visited, fieldConfig.visited, { skipWalls: false });
      clampField01(world.helpField);
      clampField01(world.routeField);
      clampField01(world.panicField);
      clampField01(world.safeField);
      clampField01(world.escapeField);
      if(world.safeFieldsByFaction){
        for(const field of world.safeFieldsByFaction){
          clampField01(field);
        }
      }
      if(world.doorField) clampField01(world.doorField);
      clampField01(world.visited);
      if(world.memX && world.memY){
        diffuse(world.memX, MEMORY_DIFFUSION);
        diffuse(world.memY, MEMORY_DIFFUSION);
        for(let i=0;i<world.memX.length;i++){
          const mx = world.memX[i] * MEMORY_DECAY;
          const my = world.memY[i] * MEMORY_DECAY;
          world.memX[i] = Math.abs(mx) < MEMORY_EPSILON ? 0 : mx;
          world.memY[i] = Math.abs(my) < MEMORY_EPSILON ? 0 : my;
        }
      }
      if(world.presenceX && world.presenceY){
        diffuse(world.presenceX, PRESENCE_DIFFUSION);
        diffuse(world.presenceY, PRESENCE_DIFFUSION);
        const keepPresence = decayMultiplierFromHalfLife(PRESENCE_HALFLIFE);
        for(let i=0;i<world.presenceX.length;i++){
          world.presenceX[i] *= keepPresence;
          world.presenceY[i] *= keepPresence;
        }
      }
      updatePresenceControl();
      seedControlDebt();
      updateFrontierFields();
      seedReinforcement();
      //console.log("After calling seedReinforment");
      if(world.reinforceByFaction){
        const reinforceCfg = { D: REINFORCE_DIFFUSION, tHalf: REINFORCE_HALFLIFE };
        for(const field of world.reinforceByFaction){
          updateField(field, reinforceCfg);
          clampField01(field);
        }
      }
      if(world.debtByFaction){
        const debtCfg = { D: DEBT_DIFFUSION, tHalf: DEBT_HALFLIFE };
        for(const field of world.debtByFaction){
          updateField(field, debtCfg);
          clampField01(field);
        }
      }
      const shouldAssert = debugConfig?.assertions && (typeof process === 'undefined' || process.env.NODE_ENV !== 'production');
      if(shouldAssert){
        assertField01('help', world.helpField);
        assertField01('route', world.routeField);
        assertField01('panic', world.panicField);
        assertField01('safe', world.safeField);
        assertField01('escape', world.escapeField);
        if(world.safeFieldsByFaction){
          world.safeFieldsByFaction.forEach((field, idx)=> assertField01(`safeFaction${idx}`, field));
        }
        if(world.debtByFaction){
          world.debtByFaction.forEach((field, idx)=> assertField01(`debtFaction${idx}`, field));
        }
        if(world.reinforceByFaction){
          world.reinforceByFaction.forEach((field, idx)=> assertField01(`reinforceFaction${idx}`, field));
        }
        assertField01('door', world.doorField);
        assertField01('visited', world.visited);
      }
    const base = settings.o2Base;
    for(let i=0;i<world.o2.length;i++) if(!world.wall[i]&&!world.vent[i]) world.o2[i]+= (base - world.o2[i]) * 0.002;
    for(let i=0;i<world.vent.length;i++) if(world.vent[i]) world.o2[i] = Math.min(base, world.o2[i] + 0.02);

    stepMycelium();
    handlePhaseTransitions();
    stepCryofoam();
    stepFactory();

    const toIgnite=[];
    const baseO2 = settings.o2Base || 0.21;
    for(const i of world.fire){
      reactFireO2(i, { o2Cut: settings.o2Cut });
      const x=i%world.W, y=(i/world.W)|0;
      for(const [dx,dy] of DIRS4){
        const nx=x+dx, ny=y+dy; if(!inBounds(nx,ny)) continue; const j=idx(nx,ny); if(world.wall[j]) continue;
        const Sj=world.strings[j];
        if(Sj && Sj.mode===Mode.WATER) reactFireWater(i,j);
        if(Sj && (Sj.mode===Mode.ACID || Sj.mode===Mode.BASE)){
          const Si=world.strings[i];
          if(Si && (Si.mode===Mode.ACID||Si.mode===Mode.BASE) && Si.mode!==Sj.mode) reactAcidBase(i,j);
        }
        if(!world.strings[j]){
          const prob = Math.min(0.6, (world.o2[j]/baseO2) * 0.3);
          if(random() < prob) toIgnite.push(j);
        }
      }
    }
    for(const j of toIgnite){
      igniteTile(j, 0.9);
    }

    if(world.clfCanisters.size){
      const compromised=[];
      for(const [tile,state] of world.clfCanisters){
        if(world.fire.has(tile) || world.clfBurners.has(tile) || world.heat[tile] > 0.9){ compromised.push(tile); continue; }
        const x = tile % world.W;
        const y = (tile / world.W) | 0;
        let contacted = false;
        for(const [dx,dy] of DIRS4){
          const nx = x + dx;
          const ny = y + dy;
          if(!inBounds(nx,ny)) continue;
          const nIdx = idx(nx,ny);
          if(world.fire.has(nIdx) || world.clfBurners.has(nIdx)){ contacted = true; break; }
          const Snb = world.strings[nIdx];
          if(Snb && Snb.mode===Mode.FIRE){ contacted = true; break; }
        }
        if(contacted){ compromised.push(tile); continue; }
        if(world.heat[tile] > 0.65){ state.integrity -= 0.08; }
        else if(world.heat[tile] > 0.35){ state.integrity -= 0.03; }
        else { state.integrity = Math.min(1, state.integrity + 0.01); }
        state.integrity = Math.max(0, state.integrity);
        if(state.integrity <= 0){ compromised.push(tile); }
      }
      for(const tile of compromised) triggerClfCanister(tile);
    }

    if(world.clfBurners.size){
      const nextBurners = new Map();
      for(const [tile,timer] of world.clfBurners){
        const x = tile % world.W;
        const y = (tile / world.W) | 0;
        world.wall[tile] = 0;
        world.fire.add(tile);
        world.heat[tile] = 1.0;
        world.o2[tile] = Math.max(0, world.o2[tile] - 0.05);
        const s = Sget(tile);
        s.mode = Mode.FIRE;
        s.amplitude = Math.max(s.amplitude, 1.3);
        s.tension = Math.max(0.05, s.tension * 0.9);
        const newTimer = timer - 1;
        if(newTimer > 0) nextBurners.set(tile, newTimer);
        if(newTimer > 2){
          for(const [dx,dy] of DIRS4){
            const nx = x + dx;
            const ny = y + dy;
            if(!inBounds(nx,ny)) continue;
            const nIdx = idx(nx,ny);
            if(world.wall[nIdx]) world.wall[nIdx] = 0;
            world.heat[nIdx] = Math.max(world.heat[nIdx], 0.7);
            world.o2[nIdx] = Math.max(0, world.o2[nIdx] - 0.02);
          }
        }
      }
      world.clfBurners = nextBurners;
    }

    const BIN=4;
    const bins=new Map();
    const bkey=(x,y)=> ((x/BIN)|0)+","+((y/BIN)|0);
    for(const a of world.agents){
      const k=bkey(a.x,a.y);
      let g=bins.get(k);
      if(!g){ g=[]; bins.set(k,g); }
      g.push(a);
    }
    for(const a of world.agents){
      if(typeof a.stepWithBins === 'function') a.stepWithBins(bins);
      else a.step();
    }

    // Acid/Base neutralization pulses (adjacent pairs)
    const nextPairs = new Set();
    const width = world.W;
    for(let y=1;y<world.H-1;y++){
      for(let x=1;x<world.W-1;x++){
        const idx0 = y*width + x;
        const S0 = world.strings[idx0];
        if(!S0) continue;
        if(S0.mode !== Mode.ACID && S0.mode !== Mode.BASE) continue;
        const neighbors = [idx0 + 1, idx0 + width];
        for(const nIdx of neighbors){
          if(nIdx >= world.strings.length) continue;
          const Sn = world.strings[nIdx];
          if(!Sn) continue;
          if(Sn.mode === S0.mode) continue;
          if(Sn.mode !== Mode.ACID && Sn.mode !== Mode.BASE) continue;
          const key = idx0 < nIdx ? `${idx0}-${nIdx}` : `${nIdx}-${idx0}`;
          const isNew = !acidBasePairs.has(key);
          reactAcidBase(idx0, nIdx, { triggerFlash:isNew });
          nextPairs.add(key);
        }
      }
    }
    acidBasePairs = nextPairs;

    for(const i of world.fire){
      const S=world.strings[i];
      if(S){
        S.phase = wrapTau(S.phase + 0.01 * randomCentered());
        S.amplitude = Math.min(2.0, S.amplitude*0.999);
      }
    }
    for(let i=0;i<world.strings.length;i++){
      const S=world.strings[i];
      if(!S) continue;
      if(S.mode===Mode.WATER || S.mode===Mode.OXYGEN) S.amplitude*=0.999;
    }

    for(let i=0;i<world.o2.length;i++){
      if(world.wall[i]) continue;
      const baseClamp = settings.o2Base || 0.21;
      world.o2[i]   = Math.max(0, Math.min(baseClamp, world.o2[i]));
      world.heat[i] = Math.max(0, Math.min(1, world.heat[i]));
    }

        }
    let stuckAgents = 0;
    const HOT_THRESH = thresholds.heat.highThreshold ?? 0.75;
    const EPS = 0.01;
    for(const agent of world.agents){
      const k = idx(agent.x, agent.y);
      const heatHere = world.heat[k] ?? 0;
      if(heatHere <= HOT_THRESH) continue;
      let trapped = true;
      for(const [dx,dy] of DIRS4){
        const nx = agent.x + dx;
        const ny = agent.y + dy;
        if(!inBounds(nx,ny)) continue;
        const nk = idx(nx, ny);
        if(world.wall[nk]) continue;
        const nh = world.heat[nk] ?? 1;
        if(nh < heatHere - EPS){ trapped = false; break; }
      }
      if(trapped) stuckAgents += 1;
    }

    const totals = {
      help: sumField(world.helpField),
      route: sumField(world.routeField),
      panic: sumField(world.panicField),
      safe: sumField(world.safeField),
      escape: sumField(world.escapeField),
      door: sumField(world.doorField),
    };
    if(world.safeFieldsByFaction){
      world.safeFieldsByFaction.forEach((field, idx)=>{
        totals[`safeFaction${idx}`] = sumField(field);
      });
    }
    if(world.debtByFaction){
      world.debtByFaction.forEach((field, idx)=>{
        totals[`debtFaction${idx}`] = sumField(field);
      });
    }
    if(world.reinforceByFaction){
      world.reinforceByFaction.forEach((field, idx)=>{
        totals[`reinforceFaction${idx}`] = sumField(field);
      });
    }
    diagnosticsFrame.fieldTotals = totals;
    const diagnosticsPayload = {
      fieldTotals: totals,
      hotAgents: diagnosticsFrame.hotAgents,
      overwhelmedAgents: diagnosticsFrame.overwhelmedAgents,
      stuckAgents,
    };
    if(updateMetrics){ updateMetrics({ reset:false, diagnostics: diagnosticsPayload }); }
    stepCount += speedMultiplier;
    simTime += 100 * speedMultiplier;
    const rec = ensureRecorder();
    if(rec){
      rec.record({ frame: stepCount, time: simTime, settings });
    }
    return true;
  }

  function frame(t){
    const dt = Math.min(50, t - last);
    last = t;
    if(paused){
      requestAnimationFrame(frame);
      return;
    }
    acc += dt;
    const settings = getSettings();
    const speed = getSimSpeed();
    let ticks = 0;
    while(acc >= 100 && ticks < speed){
      stepSimulation(settings);
      acc -= 100;
      ticks++;
    }
    if(acc >= 100){
      // prevent large backlog by dropping extra accumulated time
      acc = 0;
    }
    draw();
    requestAnimationFrame(frame);
  }

  return {
    start(){ last = performance.now(); requestAnimationFrame(frame); },
    pause(){ paused = true; },
    resume(){ if(!paused) return; paused=false; last=performance.now(); },
    stepOnce(){
      const settings=getSettings();
      if(stepSimulation(settings, { force:true })){
        draw();
      }
    },
    fastForward(mult=10){
      const settings = getSettings();
      for(let i=0;i<mult;i++){
        stepSimulation(settings, { force:true });
      }
      draw();
    },
    setPaused(value){ paused = value; if(!paused){ last=performance.now(); } },
    worldInit,
    seedDemoScenario(){ populateDemoScenario(); if(updateMetrics){ updateMetrics({ reset:true }); } },
    resetWorld(o2BaseValue, options = {}){
      const seed =
        (typeof options.rngSeed === 'number' && Number.isFinite(options.rngSeed)) ? options.rngSeed :
        (typeof options.scenarioSeed === 'number' && Number.isFinite(options.scenarioSeed)) ? options.scenarioSeed :
        undefined;
      const worldOptions = seed != null ? { seed } : {};
      worldInit(o2BaseValue, worldOptions);
      simTime = 0;
      stepCount = 0;
      acidBasePairs = new Set();
      medicAssignments.clear();
      if(recorder) recorder.clear();
      if(scenarioContext.source){
        const previous = scenarioContext.source;
        disposeScenarioRuntime();
        scenarioContext.source = {
          compiled: previous.compiled,
          options: {
            ...previous.options,
            seed: (typeof options.scenarioSeed === 'number' && Number.isFinite(options.scenarioSeed))
              ? options.scenarioSeed
              : (seed ?? world.rngSeed ?? 0),
          },
        };
        instantiateScenarioRuntime();
      }
      if(updateMetrics){ updateMetrics({ reset:true }); }
    },
    spawnNPC,
    randomFires,
    loadScenarioRuntime({ compiled, ...options } = {}){
      if(!compiled){
        throw new Error('loadScenarioRuntime requires compiled scenario bytecode.');
      }
      return loadScenarioRuntimeSource(compiled, options);
    },
    loadScenarioAsset(asset){
      return loadScenarioFromAsset(asset);
    },
    unloadScenarioRuntime(){
      cleanupScenarioArtifacts();
      disposeScenarioRuntime();
      scenarioContext.source = null;
    },
    getScenarioDiagnostics(){
      return [...scenarioContext.diagnostics];
    },
    drainScenarioDiagnostics(){
      const events = scenarioContext.diagnostics ? [...scenarioContext.diagnostics] : [];
      scenarioContext.diagnostics = [];
      return events;
    },
    getScenarioStatus(){
      if(!scenarioContext.runtime){
        return null;
      }
      return scenarioContext.runtime.getStatus();
    },
    setRecorderEnabled(value){
      if(value){
        debugConfig.enableRecorder = true;
        if(!recorder) recorder = createRecorder({ size: debugConfig.recorderSize });
      } else {
        debugConfig.enableRecorder = false;
        recorder = null;
      }
    },
    getRecorderFrame(offset){
      if(!recorder) return null;
      return recorder.getFrame(offset);
    },
    getRecorderCount(){
      return recorder ? recorder.getCount() : 0;
    },
  };
}

function handlePhaseTransitions(){
  for(let i=0;i<world.strings.length;i++){
    const S = world.strings[i];
    if(!S) continue;
    const x = i % world.W;
    const y = (i / world.W) | 0;
    if(S.mode === Mode.WATER && world.heat[i] <= thresholds.freezePoint){
      world.strings[i] = baseStringFor(Mode.ICE);
      emitParticleBurst(x, y, { type:'freeze', intensity: clamp01((thresholds.freezePoint - world.heat[i]) * 8) });
      world.heat[i] = Math.min(1, world.heat[i] + 0.02); // latent heat release of fusion
    } else if(S.mode === Mode.ICE && world.heat[i] >= thresholds.meltPoint){
      world.strings[i] = baseStringFor(Mode.WATER);
      emitParticleBurst(x, y, { type:'thaw', intensity: clamp01((world.heat[i] - thresholds.meltPoint) * 8) });
      world.heat[i] = Math.max(0, world.heat[i] - 0.02); // latent heat absorption during melting
    }
  }
}

export { handlePhaseTransitions };
