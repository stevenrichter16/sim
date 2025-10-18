import { initRenderer, fitCanvas, draw } from './render.js';
import { createSimulation } from './simulation.js';
import { initInput } from './input.js';

initOnScreenLogger();
initErrorOverlay();

const canvas = document.getElementById('view');
const ctx = initRenderer(canvas);

fitCanvas();
window.addEventListener('resize', fitCanvas);

const input = initInput({ canvas, draw: () => draw() });

const simulation = createSimulation({
  getSettings: input.getSettings,
  updateMetrics: input.updateMetrics,
  draw: () => draw(),
});

input.bindSimulation(simulation);

const initialSettings = input.getSettings();
simulation.resetWorld(initialSettings.o2Base, initialSettings);
simulation.seedDemoScenario();
draw();

simulation.start();
if(input.selectBrush) input.selectBrush('fire');

function initOnScreenLogger(){
  const btn = document.createElement('button');
  btn.textContent = 'Logs';
  btn.style.cssText = 'position:fixed;right:10px;bottom:10px;padding:8px 10px;border-radius:10px;border:1px solid #29365a;background:#111a33;color:#e6edf7;z-index:99999';
  const box = document.createElement('div');
  box.id = 'logbox';
  box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:56px;max-height:40vh;overflow:auto;background:#0d0b14;color:#ffe3e3;border:1px solid #553;border-radius:10px;padding:8px;font:12px/1.3 ui-monospace;white-space:pre-wrap;z-index:99998;display:none;';
  btn.addEventListener('click', ()=>{ box.style.display = (box.style.display==='none'?'block':'none'); });
  const attach = ()=>{ document.body.appendChild(btn); document.body.appendChild(box); };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else attach();

  const write = (level, msg)=>{
    const time = new Date().toLocaleTimeString();
    box.style.display = 'block';
    box.textContent += `[${time}] ${level}: ${msg}\n`;
    box.scrollTop = box.scrollHeight;
  };
  const origErr = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  const origLog = console.log.bind(console);
  console.error = (...args)=>{ write('console.error', args.map(formatArg).join(' ')); origErr(...args); };
  console.warn  = (...args)=>{ write('console.warn',  args.map(formatArg).join(' ')); origWarn(...args); };
  console.log   = (...args)=>{ write('console.log',   args.map(formatArg).join(' ')); origLog(...args); };

  window.addEventListener('error', (e)=>{ write('Error', (e && e.message) ? e.message : 'Unknown error'); });
  window.addEventListener('unhandledrejection', (e)=>{
    const m = (e && e.reason && (e.reason.stack||e.reason.message||String(e.reason))) || 'Unhandled promise rejection';
    write('Promise', m);
  });
}

function initErrorOverlay(){
  const box = document.createElement('div');
  box.id = 'errbox';
  box.style.cssText = 'position:fixed;left:8px;bottom:8px;right:8px;max-height:30vh;overflow:auto;background:#1b0f14;color:#ffdede;border:1px solid #552;border-radius:8px;padding:6px;font:12px/1.2 ui-monospace;z-index:9999;display:none;';
  const attach = ()=> document.body.appendChild(box);
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else attach();
  window.addEventListener('error', (e)=>{ box.style.display='block'; box.textContent += (e && e.message) ? `${e.message}\n` : 'Error\n'; });
}

function formatArg(arg){
  return (typeof arg === 'string') ? arg : JSON.stringify(arg);
}
