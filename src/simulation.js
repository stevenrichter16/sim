import { Mode, DIRS4, clamp01, wrapTau } from './constants.js';
import { world, idx, inBounds, resetWorld, metricsState } from './state.js';
import { emitParticleBurst, emitFlash } from './effects.js';
import { debugConfig } from './debug.js';
import { createRecorder } from './recorder.js';
import { thresholds, roles } from './config.js';
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
} from './materials.js';

const medicAssignments = new Map();

const HELP_DIFF = 0.12;
const HELP_DECAY = 0.02;
const HELP_DEPOSIT = 0.10;

export class Agent{
  constructor(x,y,mode){
    this.x = x;
    this.y = y;
    this.S = baseStringFor(mode);
    this.panicLevel = 0;
    this.role = mode;
    this.isMedic = mode === Mode.MEDIC;
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
    const choice = dirs[(Math.random()*dirs.length)|0];
    this.medicScoutDir = { dx: choice[0], dy: choice[1] };
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
      this.x = bestX;
      this.y = bestY;
      this.medicPath = [];
      if(this.medicTarget){
        this.medicRepathTimer = Math.min(this.medicRepathTimer, 1);
      }
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
          this.x = nx;
          this.y = ny;
          if(Math.random() < 0.2) this._medicPickNewScoutDir();
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
    this.x = nx;
    this.y = ny;
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
    if(!this.isMedic && Math.random()<0.45){
      const dirs = DIRS4;
      const [dx,dy]=dirs[(Math.random()*dirs.length)|0];
      const nx=this.x+dx, ny=this.y+dy;
      if(inBounds(nx,ny)&&!world.wall[idx(nx,ny)]){ this.x=nx; this.y=ny; }
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
    const o=world.o2[idx(this.x,this.y)];
    if(!(this.isMedic && this.medicConfig.stressResistance.oxygen)){
      if(o < thresholds.oxygen.lowAmplitudeThreshold) this.S.amplitude = clamp01(this.S.amplitude + thresholds.oxygen.lowAmplitudeRise);
      if(o < thresholds.oxygen.lowTensionThreshold){
      // hypoxia weakens resilience (lower tension)
      this.S.tension = clamp01(this.S.tension - thresholds.oxygen.lowTensionDrop);
      } else if(o > thresholds.oxygen.highTensionThreshold){
      // good oxygen lets them recover a bit
      this.S.tension = clamp01(this.S.tension + thresholds.oxygen.highTensionRecovery);
      }
    }

    const heatLevel = world.heat[idx(this.x,this.y)];
    if(!(this.isMedic && this.medicConfig.stressResistance.heat)){
      if(heatLevel > thresholds.heat.highThreshold){
        this.S.tension = clamp01(this.S.tension - thresholds.heat.highTensionDrop);
      } else if(heatLevel < thresholds.heat.lowThreshold){
        this.S.tension = clamp01(this.S.tension + thresholds.heat.lowTensionRecovery);
      }
    }

    this.S.amplitude*=0.998;
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
      const intensity = this.panicLevel ?? 0;
      if(intensity > 0){
        const k = idx(this.x, this.y);
        const current = world.helpField[k] || 0;
        const deficit = clamp01(1 - current);
        if(deficit > 0){
          const baseDeposit = HELP_DEPOSIT * intensity * deficit;
          const jitter = (Math.random() - 0.5) * baseDeposit * 0.4;
          const delta = Math.max(0, baseDeposit + jitter);
          world.helpField[k] = clamp01(current + delta);
        }
      }
    }
  }
  step(){ this._doStep(null); }
  stepWithBins(bins){ this._doStep(bins); }
}

function lerpPhase(a,b,t){
  return wrapTau(a + (b - a) * t);
}

export function worldInit(o2BaseValue){
  resetWorld(o2BaseValue);
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
      world.fire.add(i);
      world.strings[i]=baseStringFor(Mode.FIRE);
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
  spawnNPC(Mode.CALM);
  world.agents[world.agents.length-1].x = 3;
  world.agents[world.agents.length-1].y = ly;
  spawnNPC(Mode.PANIC);
  world.agents[world.agents.length-1].x = cx;
  world.agents[world.agents.length-1].y = cy+1;
}

export function spawnNPC(mode){
  let tries=200;
  while(tries--){
    const x=1+((Math.random()*(world.W-2))|0);
    const y=1+((Math.random()*(world.H-2))|0);
    if(!world.wall[idx(x,y)]){
      world.agents.push(new Agent(x,y,mode));
      break;
    }
  }
}

export function randomFires(n){
  for(let k=0;k<n;k++){
    const x=1+((Math.random()*(world.W-2))|0);
    const y=1+((Math.random()*(world.H-2))|0);
    const i=idx(x,y);
    if(!world.wall[i]){
      world.fire.add(i);
      world.strings[i]=baseStringFor(Mode.FIRE);
    }
  }
}

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

  function ensureRecorder(){
    if(!debugConfig.enableRecorder) return null;
    if(!recorder){
      recorder = createRecorder({ size: debugConfig.recorderSize });
    }
    return recorder;
  }

  function stepSimulation(settings, { force=false } = {}){
    if(paused && !force) return false;
    diffuse(world.heat, settings.dHeat);
    diffuse(world.o2, settings.dO2);
    if(world.helpField){
      diffuse(world.helpField, HELP_DIFF);
      const keep = 1 - HELP_DECAY;
      for(let i=0;i<world.helpField.length;i++){
        if(world.wall[i]) continue;
        const v = world.helpField[i] * keep;
        world.helpField[i] = v < 0.0001 ? 0 : v;
      }
    }
    const base = settings.o2Base;
    for(let i=0;i<world.o2.length;i++) if(!world.wall[i]&&!world.vent[i]) world.o2[i]+= (base - world.o2[i]) * 0.002;
    for(let i=0;i<world.vent.length;i++) if(world.vent[i]) world.o2[i] = Math.min(base, world.o2[i] + 0.02);

    handlePhaseTransitions();
    stepCryofoam();

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
          if(Math.random() < prob) toIgnite.push(j);
        }
      }
    }
    for(const j of toIgnite){
      world.fire.add(j);
      world.strings[j]=baseStringFor(Mode.FIRE);
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
        S.phase = wrapTau(S.phase + 0.01*(Math.random()-0.5));
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

    if(updateMetrics){
      updateMetrics({ reset:false });
    }
    stepCount++;
    simTime += 100;
    const rec = ensureRecorder();
    if(rec){
      rec.record({
        frame: stepCount,
        time: simTime,
        settings,
      });
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
    while(acc >= 100){
      stepSimulation(settings);
      acc -= 100;
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
    setPaused(value){ paused = value; if(!paused){ last=performance.now(); } },
    worldInit,
    seedDemoScenario(){ populateDemoScenario(); if(updateMetrics){ updateMetrics({ reset:true }); } },
    resetWorld(o2BaseValue){
      worldInit(o2BaseValue);
      simTime = 0;
      stepCount = 0;
      acidBasePairs = new Set();
      medicAssignments.clear();
      if(recorder) recorder.clear();
      if(updateMetrics){ updateMetrics({ reset:true }); }
    },
    spawnNPC,
    randomFires,
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
