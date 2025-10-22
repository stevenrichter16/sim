import { Mode, TAU, clamp01 } from './constants.js';
import { world, idx, inBounds, getViewState, setViewOffset, isTelemetryEnabled, getInspectedTile } from './state.js';
import { drainParticleBursts, drainFlashes } from './effects.js';
import { debugConfig } from './debug.js';
import { roles } from './config.js';
import { FACTIONS, DEFAULT_FACTION_ID, factionById } from './factions.js';
import { getFactoryStructures, FactoryKind, getOrientationAngle, getOrientationVector, FactoryItem } from './factory.js';

const clamp255 = (value) => Math.max(0, Math.min(255, Math.round(value)));

let canvas = null;
let ctx = null;
let offscreen = null;
let offctx = null;
let frameTicker = 0;
const particles = [];
const flashes = [];
let customCanvasSize = null;

export function initRenderer(canvasElement){
  canvas = canvasElement;
  ctx = canvas.getContext('2d');
  offscreen = document.createElement('canvas');
  offctx = offscreen.getContext('2d');
  return ctx;
}

export function setCustomCanvasSize(size){
  if(size && (Number.isNaN(size.width) || Number.isNaN(size.height))){
    customCanvasSize = null;
  } else {
    customCanvasSize = size;
  }
  if(customCanvasSize && customCanvasSize.width && customCanvasSize.height){
    document.documentElement.style.setProperty('--canvas-column-width', `${customCanvasSize.width}px`);
  } else {
    document.documentElement.style.removeProperty('--canvas-column-width');
  }
  fitCanvas();
}

export function getCustomCanvasSize(){
  return customCanvasSize;
}

export function getContext(){
  return ctx;
}

export function fitCanvas(){
  if(!canvas) return;
  let targetWidth;
  let targetHeight;
  if(customCanvasSize && customCanvasSize.width && customCanvasSize.height){
    targetWidth = customCanvasSize.width;
    targetHeight = customCanvasSize.height;
  } else {
    targetWidth = Math.min(window.innerWidth - 24, 3200);
    targetHeight = Math.min(window.innerHeight - 80, 1800);
  }
  targetWidth = Math.max(480, targetWidth);
  targetHeight = Math.max(360, targetHeight);
  canvas.width = Math.floor(targetWidth);
  canvas.height = Math.floor(targetHeight);
  world.cell = Math.max(1, Math.floor(Math.min(canvas.width / world.W, canvas.height / world.H)));
  clampViewToCanvas();
}

export function draw(){
  if(!ctx || !offctx) return;
  frameTicker++;
  offscreen.width = world.W;
  offscreen.height = world.H;
  const img = offctx.createImageData(world.W, world.H);
  const factoryStructures = getFactoryStructures();
  for(let i=0;i<world.W*world.H;i++){
    const h = Math.min(1, world.heat[i]);
    const o = Math.max(0, Math.min(0.30, world.o2[i]))/0.30;
    let r = Math.floor(255*h);
    let g = Math.floor(255*0.9*o);
    let b = Math.floor(255*o);
    if(world.fire.has(i)){
      const S = world.strings[i];
      const hue = ((S?S.phase:0)/ (Math.PI*2));
      const [hr,hg,hb] = hslToRgb(hue,0.7,0.5);
      r = clamp255(r*0.6+hr*0.6);
      g = clamp255(g*0.6+hg*0.6);
      b = clamp255(b*0.6+hb*0.6);
    }
    const p=i*4;
    img.data[p]=r; img.data[p+1]=g; img.data[p+2]=b; img.data[p+3]=255;
  }
  offctx.putImageData(img,0,0);

  const view = clampViewToCanvas();

  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.save();
  ctx.translate(view.offsetX, view.offsetY);
  ctx.scale(view.scale, view.scale);
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(offscreen,0,0,world.W*world.cell,world.H*world.cell);
  for(let y=0;y<world.H;y++){
    for(let x=0;x<world.W;x++){
      if(world.wall[idx(x,y)]){
        drawShadedTile(ctx, x*world.cell, y*world.cell, world.cell, '#2a3350', { outline: '#121a30' });
      }
    }
  }
  for(let y=0;y<world.H;y++){
    for(let x=0;x<world.W;x++){
      if(world.vent[idx(x,y)]){
        drawShadedTile(ctx, x*world.cell + world.cell/4, y*world.cell + world.cell/4, world.cell/2, '#3cffd2', { sheen: 0.35, outline: '#0b4136' });
      }
    }
  }
  for(const i of world.fire){
    const x=i%world.W, y=(i/world.W)|0;
    const jitter = (Math.sin((frameTicker + i) * 0.3) + 1) * 0.5;
    drawAnimatedCore(ctx, x*world.cell, y*world.cell, world.cell, '#ff6a00', jitter);
  }
  for(let y=0;y<world.H;y++){
    for(let x=0;x<world.W;x++){
      const tile=idx(x,y);
      const S=world.strings[tile];
      if(world.wall[tile] || !S || world.fire.has(tile)) continue;
      const baseX = x*world.cell;
      const baseY = y*world.cell;
      const structure = factoryStructures.get(tile);
      if(S.mode===Mode.WATER){
        const ripple = 0.5 + 0.5*Math.sin((frameTicker*0.12) + tile*0.7);
        drawLiquidTile(ctx, baseX, baseY, world.cell, '#6ec6ff', ripple);
      }
      else if(S.mode===Mode.CRYOFOAM){
        drawShadedTile(ctx, baseX, baseY, world.cell, '#d7f3ff', { outline: '#6fbde6', sheen:0.25 });
      }
      else if(S.mode===Mode.ACID){
        const bubblePhase = (Math.sin(frameTicker*0.18 + tile*0.6) + 1) * 0.5;
        drawAcidTile(ctx, baseX, baseY, world.cell, '#9bff8a', bubblePhase);
      }
      else if(S.mode===Mode.BASE){
        drawShadedTile(ctx, baseX, baseY, world.cell, '#ffaf87', { sheen:0.18 });
      }
      else if(S.mode===Mode.ICE){
        drawShadedTile(ctx, baseX, baseY, world.cell, '#b9e8ff', { sheen:0.3, outline:'#6fbde6' });
      }
      else if(S.mode===Mode.CLF3){
        drawShadedTile(ctx, baseX, baseY, world.cell, '#7eed75', { outline:'#1f7d24', sheen:0.1 });
      }
      else if(S.mode===Mode.MYCELIUM){
        drawMyceliumTile(ctx, baseX, baseY, world.cell, S, tile, frameTicker);
      }
      else if(S.mode===Mode.FACTORY_NODE){
        drawFactoryNodeTile(ctx, baseX, baseY, world.cell);
      }
      else if(S.mode===Mode.FACTORY_MINER){
        drawFactoryMinerTile(ctx, baseX, baseY, world.cell, structure?.orientation);
      }
      else if(S.mode===Mode.FACTORY_BELT){
        drawFactoryBeltTile(ctx, baseX, baseY, world.cell, structure?.orientation);
      }
      else if(S.mode===Mode.FACTORY_SMELTER){
        drawFactorySmelterTile(ctx, baseX, baseY, world.cell, structure?.orientation);
      }
      else if(S.mode===Mode.FACTORY_CONSTRUCTOR){
        drawFactoryConstructorTile(ctx, baseX, baseY, world.cell, structure?.orientation);
      }
      else if(S.mode===Mode.FACTORY_STORAGE){
        drawFactoryStorageTile(ctx, baseX, baseY, world.cell);
      }
    }
  }
  for(const [tileIdx, structure] of factoryStructures.entries()){
    if(structure?.kind === FactoryKind.BELT && structure.item){
      drawFactoryBeltItem(ctx, tileIdx, structure);
    }
  }
  for(const a of world.agents){
    const intensity = clamp01(a.panicLevel ?? 0);
    const isMedic = a.S?.mode === Mode.MEDIC;
    const faction = factionById(a.factionId ?? DEFAULT_FACTION_ID);
    const factionRgb = hexToRgb(faction.color);
    const fr = factionRgb?.r ?? 75;
    const fg = factionRgb?.g ?? 220;
    const fb = factionRgb?.b ?? 255;
    if(isMedic){
      ctx.fillStyle = '#4bffa5';
    } else {
      const panicColor = panicGradient(intensity);
      const panicRgb = hexToRgb(panicColor);
      if(panicRgb){
        const weightPanic = 0.4;
        const weightFaction = 0.6;
        ctx.fillStyle = `rgb(${Math.round(panicRgb.r*weightPanic + fr*weightFaction)}, ${Math.round(panicRgb.g*weightPanic + fg*weightFaction)}, ${Math.round(panicRgb.b*weightPanic + fb*weightFaction)})`;
      } else {
        ctx.fillStyle = faction.color;
      }
    }
    const cx = a.x*world.cell+world.cell/2;
    const cy = a.y*world.cell+world.cell/2;
    const baseRadius = Math.max(2,world.cell*0.35);
    const shock = a.phaseShock ?? 0;
    if(shock > 0.01){
      const pulse = 0.6 + 0.4*Math.sin(frameTicker*0.3 + (a.x+a.y));
      const haloR = baseRadius * (1.2 + pulse * 0.6 + Math.min(0.8, shock));
      const gradient = ctx.createRadialGradient(cx, cy, baseRadius*0.2, cx, cy, haloR);
      const shockAlpha = clamp01(0.35 + Math.min(0.6, shock));
      gradient.addColorStop(0, `rgba(255, 120, 60, ${shockAlpha})`);
      gradient.addColorStop(0.5, `rgba(255, 40, 90, ${shockAlpha*0.55})`);
      gradient.addColorStop(1, 'rgba(100, 10, 20, 0)');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if(!isMedic && intensity > 0.35){
      drawPanicBloom(ctx, cx, cy, baseRadius, intensity);
    }
    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius, 0, Math.PI*2);
    ctx.fill();
    const outlineColor = faction.outline || faction.color;
    if(isMedic){
      ctx.strokeStyle = '#1aff7a';
      ctx.lineWidth = Math.max(1, world.cell * 0.12);
    } else {
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = Math.max(1, world.cell * 0.18);
    }
    ctx.stroke();
    if(isMedic){
      const medicConfig = roles.medic || {};
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = '#4bffa5';
      ctx.lineWidth = Math.max(1, world.cell * 0.15);
      const auraRadius = baseRadius + (medicConfig.auraRadius ?? 3) * world.cell * 0.4;
      ctx.beginPath();
      ctx.arc(cx, cy, auraRadius, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }
  }
  drawPheromoneSlices(ctx);
  drawDominanceOverlay(ctx);
  drawFlashes(ctx);
  drawParticles(ctx);
  drawHeatHaze(ctx);
  drawOverlays(ctx);
  if(isTelemetryEnabled()) drawInspectionHighlight(ctx);
  ctx.restore();
}

function drawPheromoneSlices(ctx){
  const cell = world.cell;
  if(cell <= 0) return;
  const overlay = debugConfig.overlay || {};
  const fields = [];
  if(overlay.help !== false)   fields.push({ key:'help',   data: world.helpField,   color: '#ff6a3d', threshold: 0.01 });
  if(overlay.panic !== false)  fields.push({ key:'panic',  data: world.panicField,  color: '#ff4f96', threshold: 0.01 });
  if(overlay.safe !== false)   fields.push({ key:'safe',   data: world.safeField,   color: '#95ffe9', threshold: 0.01 });
  if(world.safeFieldsByFaction){
    for(const faction of FACTIONS){
      const overlayKey = `safeFaction${faction.id}`;
      if(overlay[overlayKey] && world.safeFieldsByFaction[faction.id]){
        fields.push({ key:overlayKey, data: world.safeFieldsByFaction[faction.id], color: faction.safeFieldColor || faction.color, threshold: 0.01 });
      }
    }
  }
  if(overlay.escape !== false) fields.push({ key:'escape', data: world.escapeField, color: '#6ec6ff', threshold: 0.01 });
  if(overlay.route !== false)  fields.push({ key:'route',  data: world.routeField,  color: '#64dd88', threshold: 0.01 });
  if(overlay.door !== false)   fields.push({ key:'door',   data: world.doorField,   color: '#ffd166', threshold: 0.01 });
  if(overlay.frontier && world.frontierByFaction){
    fields.push({
      key: 'frontier',
      get: (index)=>{
        if(!world.frontierByFaction) return 0;
        let max = 0;
        for(const field of world.frontierByFaction){
          if(!field) continue;
          const val = field[index] ?? 0;
          if(val > max) max = val;
        }
        return max;
      },
      color: '#ffff6b',
      threshold: 0.0005,
      minAlpha: 0.99,
      scale: 2.0,
    });
  }
  if(overlay.reinforce && world.reinforceByFaction){
    fields.push({
      key: 'reinforce',
      get: (index)=>{
        if(!world.reinforceByFaction) return 0;
        let max = 0;
        for(const field of world.reinforceByFaction){
          if(!field) continue;
          const val = field[index] ?? 0;
          if(val > max) max = val;
        }
        return max;
      },
      color: '#000000',
      threshold: 0.0005,
      minAlpha: 0.35,
      scale: 1.8,
    });
  }
  if(overlay.memory){
    fields.push({
      key: 'memory',
      get: (index)=>{
        if(!world.memX || !world.memY) return 0;
        const mx = world.memX[index];
        const my = world.memY[index];
        return Math.hypot(mx, my);
      },
      color: '#bda7ff',
      threshold: 0.01,
    });
  }
  if(!fields.some(f => f.data || f.get)) return;
  ctx.save();
  const baseAlpha = 0.9;
  for(let y=0;y<world.H;y++){
    for(let x=0;x<world.W;x++){
      const index = idx(x,y);
      const slices = [];
      for(const f of fields){
        const value = f.get ? f.get(index) : f.data ? f.data[index] : 0;
        if(value <= f.threshold) continue;
        slices.push({ value, color: f.color, minAlpha: f.minAlpha ?? 0, scale: f.scale ?? 1 });
      }
      if(!slices.length) continue;
      slices.sort((a,b)=> b.value - a.value);
      let total = 0;
      for(const s of slices) total += s.value;
      if(total <= 0) continue;
      const baseX = x * cell;
      const baseY = y * cell;
      let offset = 0;
      for(let i=0;i<slices.length;i++){
        const slice = slices[i];
        let width;
        if(i === slices.length - 1){
          width = cell - offset;
        } else {
          const fraction = slice.value / total;
          width = Math.max(1, Math.round(fraction * cell));
          if(offset + width > cell) width = cell - offset;
        }
        if(width <= 0) continue;
        const strength = Math.max(0, Math.min(1, slice.value * slice.scale));
        const scalar = slice.minAlpha + (1 - slice.minAlpha) * strength;
        ctx.globalAlpha = baseAlpha * scalar;
        ctx.fillStyle = slice.color;
        ctx.fillRect(baseX + offset, baseY, width, cell);
        offset += width;
        if(offset >= cell) break;
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawDominanceOverlay(ctx){
  const overlay = debugConfig.overlay || {};
  if(!overlay.control) return;
  if(!world.dominantFaction || !world.controlLevel) return;
  const cell = world.cell;
  if(cell <= 0) return;
  ctx.save();
  for(let i=0;i<world.dominantFaction.length;i++){
    const factionId = world.dominantFaction[i];
    const control = world.controlLevel[i] ?? 0;
    if(factionId < 0 || control <= 0.05) continue;
    const faction = factionById(factionId);
    const rgb = hexToRgb(faction.outline || faction.color);
    const alpha = clamp01(control * 0.6);
    ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
    const x = (i % world.W) * cell;
    const y = ((i / world.W) | 0) * cell;
    ctx.fillRect(x, y, cell, cell);
  }
  ctx.restore();
}

function drawMyceliumTile(ctx, x, y, size, S, tileIndex, ticker){
  const phase = ((S?.phase ?? 0) % TAU + TAU) % TAU;
  const amplitude = clamp01(S?.amplitude ?? 0);
  const tension = clamp01(S?.tension ?? 0);
  const phaseNorm = phase / TAU;
  const baseHue = (0.28 + phaseNorm * 0.08 + amplitude * 0.05) % 1;
  const saturation = clamp01(0.48 + amplitude * 0.35);
  const light = clamp01(0.28 + tension * 0.25);
  const [baseR, baseG, baseB] = hslToRgb(baseHue, saturation, light);
  const baseColor = `rgb(${baseR},${baseG},${baseB})`;
  const outline = `rgba(${Math.max(0, baseR-45)}, ${Math.max(0, baseG-65)}, ${Math.max(0, baseB-55)}, 0.9)`;
  drawShadedTile(ctx, x, y, size, baseColor, { outline, sheen:0.16 });
  const cx = x + size / 2;
  const cy = y + size / 2;
  const pulse = 0.4 + amplitude * 0.7;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  const layers = 4;
  ctx.lineCap = 'round';
  for(let layer=0; layer<layers; layer++){
    const layerPhase = phase + layer * 0.9;
    const layerAmp = amplitude * (0.6 + layer * 0.18);
    const layerTension = tension * (0.7 + layer * 0.12);
    const thickness = Math.max(1, size * (0.06 + layerAmp * 0.18));
    const hueOffset = (baseHue + layer * 0.04) % 1;
    const [lr, lg, lb] = hslToRgb(hueOffset, clamp01(saturation + layer * 0.12), clamp01(light + layer * 0.05));
    ctx.strokeStyle = `rgba(${lr}, ${lg}, ${lb}, ${0.18 + layerTension * 0.4})`;
    ctx.lineWidth = thickness;
    const segments = 5;
    const startAngle = layerPhase + ticker * 0.05;
    const radius = size * (0.15 + layer * 0.12 + pulse * 0.1);
    ctx.beginPath();
    for(let i=0;i<=segments;i++){
      const t = i / segments;
      const ang = startAngle + Math.sin(t * Math.PI * 2 + layerPhase) * 0.6;
      const px = cx + Math.cos(ang) * radius * (0.4 + t * 0.6);
      const py = cy + Math.sin(ang * 0.55) * radius * (0.4 + (1 - t) * 0.6);
      if(i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  const connectionDirs = [[1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];
  const tileX = tileIndex % world.W;
  const tileY = (tileIndex / world.W) | 0;
  const drawBranch = (startX, startY, endX, endY, strength, hueShift = 0) => {
    const midT = 0.35 + strength * 0.25;
    const ctrl1x = lerpValue(startX, endX, midT) + Math.sin(startX + ticker * 0.04 + hueShift) * size * 0.12 * (1 - strength);
    const ctrl1y = lerpValue(startY, endY, midT) + Math.cos(startY + ticker * 0.05 + hueShift) * size * 0.12 * strength;
    const ctrl2x = lerpValue(startX, endX, 0.65) + Math.sin(endY + ticker * 0.06 + hueShift * 1.7) * size * 0.1;
    const ctrl2y = lerpValue(startY, endY, 0.65) + Math.cos(endX + ticker * 0.07 + hueShift * 2.1) * size * 0.1;
    const [lr, lg, lb] = hslToRgb((baseHue + hueShift) % 1, clamp01(saturation + strength * 0.3), clamp01(light + strength * 0.18));
    ctx.strokeStyle = `rgba(${lr}, ${lg}, ${lb}, ${0.18 + strength * 0.45})`;
    ctx.lineWidth = Math.max(1, size * (0.05 + strength * 0.12));
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.bezierCurveTo(ctrl1x, ctrl1y, ctrl2x, ctrl2y, endX, endY);
    ctx.stroke();
  };
  for(const [dx,dy] of connectionDirs){
    const nx = tileX + dx;
    const ny = tileY + dy;
    if(!inBounds(nx, ny)) continue;
    const nIdx = idx(nx, ny);
    const nS = world.strings[nIdx];
    if(!nS || nS.mode !== Mode.MYCELIUM) continue;
    const neighborPhase = ((nS.phase ?? 0) % TAU + TAU) % TAU;
    const neighborAmp = clamp01(nS.amplitude ?? 0);
    const neighborTension = clamp01(nS.tension ?? 0);
    const targetX = x + dx * size + size / 2;
    const targetY = y + dy * size + size / 2;
    const branchStrength = clamp01(0.35 + amplitude * 0.4 + neighborAmp * 0.35);
    drawBranch(cx, cy, targetX, targetY, branchStrength, dx * 0.07 + dy * 0.08 + neighborPhase / TAU * 0.04);
  }
  const glowRadius = size * (0.35 + pulse * 0.45);
  const glowGradient = ctx.createRadialGradient(cx, cy, size * 0.12, cx, cy, glowRadius);
  glowGradient.addColorStop(0, `rgba(${Math.min(255, baseR + 55)}, ${Math.min(255, baseG + 80)}, ${Math.min(255, baseB + 70)}, ${0.22 + amplitude * 0.45})`);
  glowGradient.addColorStop(1, 'rgba(8, 16, 10, 0)');
  ctx.fillStyle = glowGradient;
  ctx.beginPath();
  ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}


function drawFactoryNodeTile(ctx, x, y, size){
  drawShadedTile(ctx, x, y, size, '#6b4a2d', { outline: '#2f1c0c', sheen: 0.1 });
  ctx.save();
  ctx.fillStyle = '#d5a86d';
  ctx.beginPath();
  ctx.arc(x + size * 0.5, y + size * 0.55, size * 0.24, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, size * 0.08);
  ctx.stroke();
  ctx.restore();
}

function drawFactoryMinerTile(ctx, x, y, size, orientation){
  drawShadedTile(ctx, x, y, size, '#424b5f', { outline: '#1b2334', sheen: 0.18 });
  const angle = getOrientationAngle(orientation);
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.rotate(angle);
  ctx.fillStyle = '#ccd4de';
  ctx.beginPath();
  ctx.moveTo(-size * 0.28, -size * 0.22);
  ctx.lineTo(size * 0.3, 0);
  ctx.lineTo(-size * 0.28, size * 0.22);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3fe0ff';
  ctx.fillRect(-size * 0.22, -size * 0.14, size * 0.2, size * 0.28);
  ctx.restore();
}

function drawFactoryBeltTile(ctx, x, y, size, orientation){
  drawShadedTile(ctx, x, y, size, '#212939', { outline: '#0f1626', sheen: 0.08 });
  const angle = getOrientationAngle(orientation);
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.rotate(angle);
  ctx.strokeStyle = '#62e0ff';
  ctx.lineWidth = Math.max(1, size * 0.16);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-size * 0.32, 0);
  ctx.lineTo(size * 0.18, 0);
  ctx.stroke();
  ctx.fillStyle = '#62e0ff';
  ctx.beginPath();
  ctx.moveTo(size * 0.18, 0);
  ctx.lineTo(size * 0.02, size * 0.18);
  ctx.lineTo(size * 0.02, -size * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFactorySmelterTile(ctx, x, y, size, orientation){
  drawShadedTile(ctx, x, y, size, '#52342a', { outline: '#27140f', sheen: 0.14 });
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.fillStyle = '#ff9357';
  ctx.fillRect(-size * 0.28, -size * 0.22, size * 0.56, size * 0.44);
  ctx.fillStyle = '#ffe2b0';
  ctx.fillRect(-size * 0.18, -size * 0.12, size * 0.36, size * 0.12);
  const angle = getOrientationAngle(orientation);
  ctx.rotate(angle);
  ctx.fillStyle = '#2b1a14';
  ctx.fillRect(-size * 0.08, size * 0.22, size * 0.16, size * 0.16);
  ctx.restore();
}

function drawFactoryConstructorTile(ctx, x, y, size, orientation){
  drawShadedTile(ctx, x, y, size, '#333b68', { outline: '#181d33', sheen: 0.2 });
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  const angle = getOrientationAngle(orientation);
  ctx.rotate(angle);
  ctx.fillStyle = '#8ca8ff';
  ctx.fillRect(-size * 0.24, -size * 0.16, size * 0.48, size * 0.32);
  ctx.fillStyle = '#d6e1ff';
  ctx.fillRect(-size * 0.12, -size * 0.08, size * 0.24, size * 0.16);
  ctx.strokeStyle = 'rgba(30,40,80,0.9)';
  ctx.lineWidth = Math.max(1, size * 0.08);
  ctx.strokeRect(-size * 0.28, -size * 0.2, size * 0.56, size * 0.4);
  ctx.restore();
}

function drawFactoryStorageTile(ctx, x, y, size){
  drawShadedTile(ctx, x, y, size, '#6c512b', { outline: '#2e1d0c', sheen: 0.12 });
  ctx.save();
  ctx.strokeStyle = '#d9b27c';
  ctx.lineWidth = Math.max(1, size * 0.08);
  ctx.strokeRect(x + size * 0.18, y + size * 0.18, size * 0.64, size * 0.64);
  ctx.beginPath();
  ctx.moveTo(x + size * 0.18, y + size * 0.18);
  ctx.lineTo(x + size * 0.82, y + size * 0.82);
  ctx.moveTo(x + size * 0.82, y + size * 0.18);
  ctx.lineTo(x + size * 0.18, y + size * 0.82);
  ctx.stroke();
  ctx.restore();
}

function factoryItemColor(item){
  switch(item){
    case FactoryItem.IRON_ORE:
      return '#c58a32';
    case FactoryItem.IRON_INGOT:
      return '#ffe17d';
    case FactoryItem.PLATE:
      return '#9acbff';
    default:
      return '#ffffff';
  }
}

function drawFactoryBeltItem(ctx, tileIdx, structure){
  const size = world.cell;
  const x = tileIdx % world.W;
  const y = (tileIdx / world.W) | 0;
  const progress = clamp01(structure.progress ?? 0);
  const vector = getOrientationVector(structure.orientation);
  const offset = (progress - 0.5) * 0.9;
  const cx = x * size + size / 2 + vector.dx * offset * size;
  const cy = y * size + size / 2 + vector.dy * offset * size;
  const radius = Math.max(2, size * 0.18);
  ctx.save();
  ctx.fillStyle = factoryItemColor(structure.item);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(15,20,30,0.6)';
  ctx.lineWidth = Math.max(1, radius * 0.4);
  ctx.stroke();
  ctx.restore();
}

function drawInspectionHighlight(ctx){
  const inspected = getInspectedTile();
  if(inspected == null) return;
  const cell = world.cell;
  const tileX = inspected % world.W;
  const tileY = (inspected / world.W) | 0;
  const x = tileX * cell;
  const y = tileY * cell;
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = Math.max(1, cell * 0.1);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
  ctx.restore();
}

function drawOverlays(ctx){
  const { overlay } = debugConfig;
  if(!overlay.heat && !overlay.amplitude && !overlay.tension) return;
  const cell = world.cell;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for(let i=0;i<world.strings.length;i++){
    const cx = (i % world.W) * cell + cell / 2;
    const cy = ((i / world.W) | 0) * cell + cell / 2;
    const S = world.strings[i];
    if(overlay.heat){
      const heat = clamp01(world.heat[i] ?? 0);
      if(heat > 0.05){
        const haze = ctx.createRadialGradient(cx, cy, cell * 0.2, cx, cy, cell * (0.8 + heat));
        haze.addColorStop(0, `rgba(255,120,60,${0.25 + heat * 0.4})`);
        haze.addColorStop(1, 'rgba(255,120,60,0)');
        ctx.fillStyle = haze;
        ctx.fillRect(cx - cell, cy - cell, cell * 2, cell * 2);
      }
    }
    if(S && overlay.amplitude){
      const amp = clamp01(S.amplitude);
      if(amp > 0.05){
        const glow = ctx.createRadialGradient(cx, cy, cell * 0.1, cx, cy, cell * (0.8 + amp));
        glow.addColorStop(0, `rgba(90,200,255,${0.2 + amp * 0.45})`);
        glow.addColorStop(1, 'rgba(90,200,255,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(cx - cell, cy - cell, cell * 2, cell * 2);
      }
    }
    if(S && overlay.tension){
      const loose = clamp01(1 - S.tension);
      if(loose > 0.05){
        const ring = ctx.createRadialGradient(cx, cy, cell * 0.45, cx, cy, cell * (1.2 + loose));
        ring.addColorStop(0, 'rgba(0,0,0,0)');
        ring.addColorStop(0.7, `rgba(255,60,200,${0.12 + loose * 0.4})`);
        ring.addColorStop(1, 'rgba(255,60,200,0)');
        ctx.fillStyle = ring;
        ctx.fillRect(cx - cell*1.5, cy - cell*1.5, cell * 3, cell * 3);
      }
    }
  }
  ctx.restore();
}

function drawShadedTile(ctx, x, y, size, baseColor, { outline = null, sheen = 0.2 } = {}){
  const highlight = shadeColor(baseColor, sheen);
  const shadow = shadeColor(baseColor, -0.28);
  const fillGradient = ctx.createLinearGradient(x, y, x, y + size);
  fillGradient.addColorStop(0, highlight);
  fillGradient.addColorStop(0.55, baseColor);
  fillGradient.addColorStop(1, shadow);
  ctx.fillStyle = fillGradient;
  ctx.fillRect(x, y, size, size);
  ctx.save();
  ctx.lineWidth = Math.max(1, size * 0.08);
  ctx.strokeStyle = outline ? outline : shadeColor(baseColor, -0.45);
  ctx.strokeRect(x + ctx.lineWidth * 0.5, y + ctx.lineWidth * 0.5, size - ctx.lineWidth, size - ctx.lineWidth);
  ctx.restore();
  if(sheen > 0){
    ctx.save();
    ctx.globalAlpha = 0.22;
    const sheenHeight = size * 0.35;
    const sheenGradient = ctx.createLinearGradient(x, y, x, y + sheenHeight);
    sheenGradient.addColorStop(0, 'rgba(255,255,255,0.8)');
    sheenGradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheenGradient;
    ctx.fillRect(x + size * 0.08, y + size * 0.05, size - size * 0.16, sheenHeight);
    ctx.restore();
  }
}

function drawAcidTile(ctx, x, y, size, baseColor, phase){
  drawShadedTile(ctx, x, y, size, baseColor, { sheen:0.22, outline:shadeColor(baseColor, -0.38) });
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();

  const bubbleCount = 5;
  const phaseAngle = phase * Math.PI * 2;
  for(let i=0;i<bubbleCount;i++){
    const offset = (phase + i * 0.21) % 1;
    const swirl = Math.sin(phaseAngle + i * 2.1) * 0.05;
    const bubbleX = x + size * (0.18 + 0.68 * (((phase * 1.3 + i * 0.41) + swirl + 2) % 1));
    const bubbleY = y + size * (0.95 - offset * 0.92);
    const bubbleRadius = size * (0.05 + offset * 0.07);
    const glow = ctx.createRadialGradient(bubbleX, bubbleY, bubbleRadius * 0.2, bubbleX, bubbleY, bubbleRadius);
    glow.addColorStop(0, shadeColor(baseColor, 0.5));
    glow.addColorStop(0.6, shadeColor(baseColor, 0.3));
    glow.addColorStop(1, 'rgba(255,255,255,0.15)');
    ctx.globalAlpha = 0.45 + 0.3 * offset;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(bubbleX, bubbleY, bubbleRadius, 0, Math.PI*2);
    ctx.fill();

    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = shadeColor(baseColor, 0.6);
    ctx.lineWidth = bubbleRadius * 0.25;
    ctx.beginPath();
    ctx.arc(bubbleX, bubbleY, bubbleRadius * 0.8, Math.PI*0.85, Math.PI*1.6);
    ctx.stroke();
  }

  ctx.globalAlpha = 0.22;
  ctx.fillStyle = shadeColor(baseColor, 0.48);
  const slosh = Math.sin(phaseAngle) * (size * 0.05);
  ctx.beginPath();
  ctx.ellipse(x + size*0.5, y + size*0.28 + slosh, size*0.42, size*0.14, 0, 0, Math.PI*2);
  ctx.fill();

  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = shadeColor(baseColor, 0.55);
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.beginPath();
  ctx.moveTo(x + size*0.1, y + size*0.82);
  ctx.quadraticCurveTo(x + size*0.5, y + size*0.86 + slosh*0.6, x + size*0.9, y + size*0.8);
  ctx.stroke();

  ctx.restore();
}

function drawLiquidTile(ctx, x, y, size, baseColor, phase){
  const highlight = shadeColor(baseColor, 0.25);
  const shadow = shadeColor(baseColor, -0.3);
  const grad = ctx.createLinearGradient(x, y, x, y + size);
  grad.addColorStop(0, highlight);
  grad.addColorStop(0.5, shadeColor(baseColor, (phase - 0.5) * 0.4));
  grad.addColorStop(1, shadow);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, size, size);
  ctx.save();
  const waveY = y + size * (0.6 - (phase - 0.5) * 0.1);
  const lineWidth = Math.max(1, size * 0.06);
  const pad = lineWidth * 0.5;
  ctx.strokeStyle = shadeColor(baseColor, 0.35);
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(x + pad, waveY);
  ctx.bezierCurveTo(
    x + pad + size * 0.25,
    waveY + size * 0.04,
    x - pad + size * 0.75,
    waveY - size * 0.04,
    x + size - pad,
    waveY
  );
  ctx.stroke();
  ctx.restore();
}

function drawAnimatedCore(ctx, x, y, size, baseColor, jitter){
  const cx = x + size / 2;
  const cy = y + size / 2;
  const inner = size * (0.25 + jitter * 0.15);
  const outer = size * 0.5;
  const gradient = ctx.createRadialGradient(cx, cy, inner * 0.3, cx, cy, outer);
  gradient.addColorStop(0, shadeColor(baseColor, 0.5));
  gradient.addColorStop(0.5, shadeColor(baseColor, 0.1));
  gradient.addColorStop(1, shadeColor(baseColor, -0.45));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.4 + 0.4 * jitter;
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.1, inner, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,230,120,0.8)';
  ctx.fill();
  ctx.restore();
}

function drawPanicBloom(ctx, cx, cy, baseRadius, intensity){
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.25 + 0.4 * intensity;
  ctx.filter = 'blur(6px)';
  const radius = baseRadius + intensity * world.cell * 0.6;
  const gradient = ctx.createRadialGradient(cx, cy, baseRadius * 0.2, cx, cy, radius);
  gradient.addColorStop(0, 'rgba(239,71,111,0.8)');
  gradient.addColorStop(1, 'rgba(239,71,111,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHeatHaze(ctx){
  const cell = world.cell;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.18;
  for(let i=0;i<world.heat.length;i++){
    const heat = clamp01(world.heat[i]);
    if(heat < 0.35) continue;
    const x = (i % world.W) * cell + cell / 2;
    const y = ((i / world.W) | 0) * cell + cell / 2;
    const radius = cell * (0.6 + heat * 0.9);
    const gradient = ctx.createRadialGradient(x, y, radius * 0.2, x, y, radius);
    gradient.addColorStop(0, `rgba(255,140,60,${0.35 + heat * 0.35})`);
    gradient.addColorStop(1, 'rgba(255,140,60,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawFlashes(ctx){
  const pending = drainFlashes();
  const cell = world.cell;
  for(const flash of pending){
    flashes.push({
      x: (flash.x + 0.5) * cell,
      y: (flash.y + 0.5) * cell,
      radius: flash.radius * cell,
      life: flash.life,
      maxLife: flash.life,
      colorStart: hexToRgb(flash.colorStart),
      colorEnd: hexToRgb(flash.colorEnd),
    });
  }

  if(!flashes.length) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for(let i=flashes.length-1;i>=0;i--){
    const flash = flashes[i];
    flash.life -= 1;
    if(flash.life <= 0){
      flashes.splice(i,1);
      continue;
    }
    const t = 1 - flash.life / flash.maxLife;
    const ease = t*t*(3-2*t);
    const radius = flash.radius * (0.55 + ease * 1.25);
    const color = lerpColor(flash.colorStart, flash.colorEnd, ease);
    const gradient = ctx.createRadialGradient(flash.x, flash.y, radius * 0.15, flash.x, flash.y, radius);
    const innerAlpha = (0.6 - ease*0.25);
    const midAlpha = (0.32 - ease*0.22);
    gradient.addColorStop(0, `rgba(${color.r},${color.g},${color.b},${innerAlpha.toFixed(2)})`);
    gradient.addColorStop(0.45, `rgba(${color.r},${color.g},${color.b},${midAlpha.toFixed(2)})`);
    gradient.addColorStop(0.9, `rgba(${Math.round(color.r*0.4)},${Math.round(color.g*0.4)},${Math.round(color.b*0.5)},${(midAlpha*0.4).toFixed(2)})`);
    gradient.addColorStop(1, 'rgba(30,30,40,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(flash.x, flash.y, radius, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.restore();
}

function drawParticles(ctx){
  const pending = drainParticleBursts();
  const cell = world.cell;
  const spawnParticle = (px, py, color, variance = 1, life = 28, type='spark') => {
    let vx = (Math.random() - 0.5) * variance;
    let vy = (Math.random() - 0.6) * variance;
    let gravity = 0.02;
    if(type === 'freeze'){
      vy -= Math.abs(vy) * 0.4;
      gravity = 0.01;
    } else if(type === 'thaw'){
      vx *= 0.2;
      vy = Math.abs(vy) * 0.4 + 0.18;
      gravity = 0.045;
    }
    particles.push({
      x: px,
      y: py,
      vx,
      vy,
      life,
      maxLife: life,
      color,
      type,
      gravity,
    });
  };

  for(const burst of pending){
    const baseX = (burst.x + 0.5) * cell;
    const baseY = (burst.y + 0.5) * cell;
    const count = Math.max(4, Math.round(6 * (burst.intensity ?? 1)));
    let color = { r: 255, g: 200, b: 120, a: 0.8 };
    let variance = 1.2;
    switch(burst.type){
      case 'steam':
        color = { r: 190, g: 225, b: 255, a: 0.85 };
        variance = 0.8;
        break;
      case 'spark':
        color = { r: 255, g: 210, b: 80, a: 0.9 };
        variance = 1.4;
        break;
      case 'foam':
        color = { r: 215, g: 243, b: 255, a: 0.8 };
        variance = 0.6;
        break;
      case 'freeze':
        color = { r: 240, g: 255, b: 255, a: 0.9 };
        variance = 0.5;
        break;
      case 'thaw':
        color = { r: 90, g: 170, b: 255, a: 0.7 };
        variance = 0.5;
        break;
    }
    for(let i=0;i<count;i++){
      spawnParticle(baseX, baseY, color, variance, 22 + Math.random() * 16, burst.type);
    }
  }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for(let i=particles.length - 1; i>=0; i--){
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity ?? 0.02;
    p.life -= 1;
    if(p.life <= 0){
      particles.splice(i,1);
      continue;
    }
    const alpha = Math.max(0, p.life / p.maxLife) * p.color.a;
    ctx.fillStyle = `rgba(${p.color.r},${p.color.g},${p.color.b},${alpha.toFixed(2)})`;
    ctx.beginPath();
    const radius = Math.max(1, (p.maxLife - p.life) * 0.1 + 1.5);
    if(p.type === 'freeze'){
      ctx.fillStyle = `rgba(${p.color.r},${p.color.g},${p.color.b},${(alpha*1.1).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    if(p.type === 'thaw'){
      const bodyColor = `rgba(${p.color.r},${p.color.g},${p.color.b},${(alpha*0.85).toFixed(2)})`;
      const highlightColor = `rgba(255,255,255,${(alpha*0.45).toFixed(2)})`;
      ctx.save();
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      const head = radius * 1.5;
      ctx.moveTo(p.x, p.y - head);
      ctx.quadraticCurveTo(p.x + radius*0.6, p.y + radius*0.1, p.x, p.y + radius*1.3);
      ctx.quadraticCurveTo(p.x - radius*0.6, p.y + radius*0.1, p.x, p.y - head);
      ctx.fill();
      // trailing sheen
      ctx.strokeStyle = `rgba(${p.color.r},${p.color.g},${p.color.b},${(alpha*0.35).toFixed(2)})`;
      ctx.lineWidth = Math.max(1, radius*0.25);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + radius*1.1);
      ctx.lineTo(p.x, p.y + radius*1.6);
      ctx.stroke();
      // highlight bubble
      ctx.fillStyle = highlightColor;
      ctx.beginPath();
      ctx.ellipse(p.x + radius*0.18, p.y - head*0.55, radius*0.28, radius*0.45, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
      continue;
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function shadeColor(hex, amount){
  const { r, g, b } = hexToRgb(hex);
  const adjust = (channel) => clamp255(channel + amount * 255);
  return rgbToHex(adjust(r), adjust(g), adjust(b));
}

function hexToRgb(hex){
  const normalized = hex.replace('#','');
  const value = parseInt(normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgbToHex(r,g,b){
  const component = (v) => v.toString(16).padStart(2,'0');
  return `#${component(r)}${component(g)}${component(b)}`;
}

function hslToRgb(h,s,l){
  const f=(n,k=(n+h*12)%12)=> l - s*Math.min(l,1-l)*Math.max(-1,Math.min(k-3,9-k,1));
  return [f(0),f(8),f(4)].map(v=>Math.round(v*255));
}

function lerpColor(a, b, t){
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

function panicGradient(intensity){
  const clamped = clamp01(intensity);
  const r = Math.round(255 * (0.5 + 0.5*clamped));
  const g = Math.round(214 - (214-96)*clamped);
  const b = Math.round(102 - (102-69)*clamped);
  return `rgb(${r},${g},${b})`;
}

const clamp=(val,min,max)=> val < min ? min : val > max ? max : val;
const lerpValue = (a,b,t)=> a + (b - a) * t;





function hash2(x,y){
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  h ^= h >> 16;
  return h / 4294967295;
}

function clampViewToCanvas(){
  const view = getViewState();
  const contentWidth = world.W * world.cell * view.scale;
  const contentHeight = world.H * world.cell * view.scale;
  let offsetX = view.offsetX;
  let offsetY = view.offsetY;
  if(contentWidth <= canvas.width){
    offsetX = (canvas.width - contentWidth) / 2;
  } else {
    const minX = canvas.width - contentWidth;
    const maxX = 0;
    if(offsetX < minX) offsetX = minX;
    if(offsetX > maxX) offsetX = maxX;
  }
  if(contentHeight <= canvas.height){
    offsetY = (canvas.height - contentHeight) / 2;
  } else {
    const minY = canvas.height - contentHeight;
    const maxY = 0;
    if(offsetY < minY) offsetY = minY;
    if(offsetY > maxY) offsetY = maxY;
  }
  setViewOffset(offsetX, offsetY);
  return { offsetX, offsetY, scale: view.scale };
}
