import { Mode, clamp01 } from './constants.js';
import { world, idx, getViewState, setViewOffset, isTelemetryEnabled, getInspectedTile } from './state.js';
import { debugConfig } from './debug.js';

let canvas = null;
let ctx = null;
let offscreen = null;
let offctx = null;

export function initRenderer(canvasElement){
  canvas = canvasElement;
  ctx = canvas.getContext('2d');
  offscreen = document.createElement('canvas');
  offctx = offscreen.getContext('2d');
  return ctx;
}

export function getContext(){
  return ctx;
}

export function fitCanvas(){
  if(!canvas) return;
  const pw = Math.min(window.innerWidth - 24, 1000);
  const ph = Math.min(window.innerHeight * 0.55, 520);
  canvas.width = Math.floor(pw);
  canvas.height = Math.floor(ph);
  world.cell = Math.floor(Math.min(canvas.width / world.W, canvas.height / world.H));
  clampViewToCanvas();
}

export function draw(){
  if(!ctx || !offctx) return;
  offscreen.width = world.W;
  offscreen.height = world.H;
  const img = offctx.createImageData(world.W, world.H);
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
  ctx.fillStyle="#8891a7";
  for(let y=0;y<world.H;y++) for(let x=0;x<world.W;x++){
    if(world.wall[idx(x,y)]) ctx.fillRect(x*world.cell,y*world.cell,world.cell,world.cell);
  }
  ctx.fillStyle="#00ffb3";
  for(let y=0;y<world.H;y++) for(let x=0;x<world.W;x++){
    if(world.vent[idx(x,y)]) ctx.fillRect(x*world.cell+world.cell/4,y*world.cell+world.cell/4,world.cell/2,world.cell/2);
  }
  ctx.fillStyle="#ff6a00";
  for(const i of world.fire){
    const x=i%world.W, y=(i/world.W)|0;
    ctx.fillRect(x*world.cell+2,y*world.cell+2,world.cell-4,world.cell-4);
  }
  for(let y=0;y<world.H;y++) for(let x=0;x<world.W;x++){
    const tile=idx(x,y);
    const S=world.strings[tile];
    if(!S||world.fire.has(tile)) continue;
    if(S.mode===Mode.WATER){ ctx.fillStyle="#6ec6ff"; ctx.fillRect(x*world.cell+3,y*world.cell+3,world.cell-6,world.cell-6);}
    else if(S.mode===Mode.CRYOFOAM){
      ctx.fillStyle="#d7f3ff";
      ctx.fillRect(x*world.cell+2,y*world.cell+2,world.cell-4,world.cell-4);
      ctx.strokeStyle="#6fbde6";
      ctx.strokeRect(x*world.cell+2,y*world.cell+2,world.cell-4,world.cell-4);
    }
    else if(S.mode===Mode.ACID){ ctx.fillStyle="#9bff8a"; ctx.fillRect(x*world.cell+3,y*world.cell+3,world.cell-6,world.cell-6);}
    else if(S.mode===Mode.BASE){ ctx.fillStyle="#ffaf87"; ctx.fillRect(x*world.cell+3,y*world.cell+3,world.cell-6,world.cell-6);}
    else if(S.mode===Mode.ICE){ ctx.fillStyle="#b9e8ff"; ctx.fillRect(x*world.cell+3,y*world.cell+3,world.cell-6,world.cell-6);}
    else if(S.mode===Mode.CLF3){
      ctx.fillStyle="#7eed75";
      ctx.fillRect(x*world.cell+2,y*world.cell+2,world.cell-4,world.cell-4);
      ctx.strokeStyle="#1f7d24";
      ctx.strokeRect(x*world.cell+2,y*world.cell+2,world.cell-4,world.cell-4);
    }
  }
  for(const a of world.agents){
    const intensity = clamp01(a.panicLevel ?? 0);
    const color = panicGradient(intensity);
    ctx.fillStyle = color;
    const cx = a.x*world.cell+world.cell/2;
    const cy = a.y*world.cell+world.cell/2;
    const baseRadius = Math.max(2,world.cell*0.35);
    if(intensity > 0.5){
      const haloRadius = baseRadius + intensity * world.cell * 0.2;
      ctx.beginPath();
      ctx.arc(cx, cy, haloRadius, 0, Math.PI*2);
      ctx.fillStyle = `rgba(239,71,111,${(intensity-0.5)*0.6})`;
      ctx.fill();
      ctx.fillStyle = color;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius, 0, Math.PI*2);
    ctx.fill();
  }
  drawOverlays(ctx);
  if(isTelemetryEnabled()) drawInspectionHighlight(ctx);
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
  ctx.globalAlpha = 0.45;
  for(let i=0;i<world.strings.length;i++){
    const x = (i % world.W) * cell;
    const y = ((i / world.W) | 0) * cell;
    let r=0,g=0,b=0;
    if(overlay.heat){
      const heat = clamp01(world.heat[i] ?? 0);
      r += Math.round(255 * heat);
      g += Math.round(80 * heat);
    }
    const S = world.strings[i];
    if(S){
      if(overlay.amplitude){
        const amp = clamp01(S.amplitude);
        g += Math.round(220 * amp);
        b += Math.round(255 * amp);
      }
      if(overlay.tension){
        const loose = clamp01(1 - S.tension);
        r += Math.round(200 * loose);
        b += Math.round(120 * loose);
      }
    }
    const intensity = Math.max(r,g,b);
    if(intensity === 0) continue;
    const color = `rgb(${Math.min(255,r)},${Math.min(255,g)},${Math.min(255,b)})`;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, cell, cell);
  }
  ctx.restore();
}

function hslToRgb(h,s,l){
  const f=(n,k=(n+h*12)%12)=> l - s*Math.min(l,1-l)*Math.max(-1,Math.min(k-3,9-k,1));
  return [f(0),f(8),f(4)].map(v=>Math.round(v*255));
}

const clamp255=(x)=>Math.max(0,Math.min(255,Math.round(x)));

function panicGradient(intensity){
  const clamped = clamp01(intensity);
  const r = Math.round(255 * (0.5 + 0.5*clamped));
  const g = Math.round(214 - (214-96)*clamped);
  const b = Math.round(102 - (102-69)*clamped);
  return `rgb(${r},${g},${b})`;
}

const clamp=(val,min,max)=> val < min ? min : val > max ? max : val;

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
