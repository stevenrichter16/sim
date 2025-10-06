import { Mode, TAU, clamp01 } from './constants.js';
import { debugConfig, setDebugFlag } from './debug.js';
import { materialLegend, GLOBAL_EFFECTS } from './materialLegend.js';
import { setCustomCanvasSize } from './render.js';
import {
  world,
  idx,
  inBounds,
  setBrush,
  getBrush,
  metricsState,
  getViewState,
  setViewScale,
  setViewOffset,
  setTelemetryEnabled,
  isTelemetryEnabled,
  setInspectActive,
  isInspectActive,
  setInspectedTile,
  getInspectedTile,
  setPaused,
  isPaused,
  setSimSpeed,
  getSimSpeed,
} from './state.js';
import { baseStringFor, ensureCryofoam } from './materials.js';

const MODE_LABEL = Object.fromEntries(
  Object.entries(Mode).map(([name, value])=>{
    const label = name.toLowerCase().replace(/_/g,' ');
    return [value, label.replace(/\b\w/g, ch => ch.toUpperCase())];
  })
);

export function initInput({ canvas, draw }){
  const brushGrid = document.getElementById('brushGrid');
  const toggleDrawBtn = document.getElementById('toggleDraw');
  const spawnCalmBtn = document.getElementById('spawnCalm');
  const spawnPanicBtn = document.getElementById('spawnPanic');
  const spawnMedicBtn = document.getElementById('spawnMedic');
  const sparkBtn = document.getElementById('spark');
  const clearBtn = document.getElementById('clear');
  const dHeat = document.getElementById('dHeat');
  const dO2 = document.getElementById('dO2');
  const o2Base = document.getElementById('o2Base');
  const o2Cut = document.getElementById('o2Cut');
  const mO2 = document.getElementById('mO2');
  const mO2d = document.getElementById('mO2d');
  const mFire = document.getElementById('mFire');
  const mFired = document.getElementById('mFired');
  const mAmpAvg = document.getElementById('mAmpAvg');
  const mTensionAvg = document.getElementById('mTensionAvg');
  const mHeatAvg = document.getElementById('mHeatAvg');
  const mFieldTotals = document.getElementById('mFieldTotals');
  const mHotAgents = document.getElementById('mHotAgents');
  const mOverwhelmed = document.getElementById('mOverwhelmed');
  const mModeCounts = document.getElementById('mModeCounts');
  const histAmpContainer = document.getElementById('histAmp');
  const histTensionContainer = document.getElementById('histTension');
  const histHeatContainer = document.getElementById('histHeat');
  const zoomInBtn = document.getElementById('zoomIn');
  const zoomOutBtn = document.getElementById('zoomOut');
  const toggleTelemetryBtn = document.getElementById('toggleTelemetry');
  const togglePauseBtn = document.getElementById('togglePause');
  const stepOnceBtn = document.getElementById('stepOnce');
  const fastStepBtn = document.getElementById('fastStep');
  const simSpeedSlider = document.getElementById('simSpeed');
  const simSpeedVal = document.getElementById('simSpeedVal');
  const toggleRecorderBtn = document.getElementById('toggleRecorder');
  const seedWarmBtn = document.getElementById('seedWarm');
  const telemetryPanel = document.getElementById('telemetryPanel');
  const tMode = document.getElementById('tMode');
  const tTension = document.getElementById('tTension');
  const tAmplitude = document.getElementById('tAmplitude');
  const tPhase = document.getElementById('tPhase');
  const tHeat = document.getElementById('tHeat');
  const tTensionBar = document.getElementById('tTensionBar');
  const tAmplitudeBar = document.getElementById('tAmplitudeBar');
  const tPhaseBar = document.getElementById('tPhaseBar');
  const tHeatBar = document.getElementById('tHeatBar');
  const historyScrubber = document.getElementById('historyScrubber');
  const historySlider = document.getElementById('historyIndex');
  const historyLabel = document.getElementById('historyLabel');
  const overlayToggleKeys = {
    Digit1: 'help',
    Digit2: 'panic',
    Digit3: 'safe',
    Digit4: 'escape',
    Digit5: 'route',
  };

  function toggleOverlaySlice(name){
    const current = !!debugConfig.overlay?.[name];
    setDebugFlag(`overlay.${name}`, !current);
    draw();
  }
  const legendPanel = document.getElementById('legendPanel');
  const metricsToggle = document.getElementById('metricsToggle');
  const metricsSummary = document.getElementById('metricsSummary');
  const canvasSizeSelect = document.getElementById('canvasSize');

  const createHistBars = (container, gradient)=>{
    if(!container) return [];
    container.innerHTML='';
    const bars=[];
    for(let i=0;i<20;i++){
      const bar=document.createElement('div');
      bar.style.flex='1';
      bar.style.background=gradient;
      bar.style.height='2px';
      bars.push(bar);
      container.appendChild(bar);
    }
    return bars;
  };

  const histAmplitudeBars = createHistBars(histAmpContainer,'linear-gradient(180deg,#6ec6ff,#1b6a96)');
  const histTensionBars = createHistBars(histTensionContainer,'linear-gradient(180deg,#ffaf87,#c46a3f)');
  const histHeatBars = createHistBars(histHeatContainer,'linear-gradient(180deg,#ff7a7a,#b32222)');

  const renderHistogram = (bars, data)=>{
    if(!bars.length || !data) return;
    let max=0;
    for(let i=0;i<data.length;i++){
      if(data[i]>max) max=data[i];
    }
    const denom = max>0 ? max : 1;
    for(let i=0;i<bars.length;i++){
      const ratio = data[i] / denom;
      bars[i].style.height = `${Math.max(2, Math.round(ratio*36)+2)}px`;
      bars[i].style.opacity = ratio>0 ? 0.95 : 0.25;
    }
  };

  const HISTORY_MAX = 10;
  let historyOffset = 0;
  let legendRendered = false;
  let lastInspectState = null;
  let metricsExpanded = false;

  function formatCondition(cond){
    const symbols = { '<=': '≤', '>=': '≥', 'between': '↔', '≈': '≈' };
    const symbol = symbols[cond.op] || cond.op;
    let value;
    if(Array.isArray(cond.value)){
      value = cond.value.map(v=> typeof v === 'number' ? v.toFixed(2) : v).join(' – ');
    } else if(typeof cond.value === 'number'){
      value = cond.value.toFixed(2);
    } else if(cond.value != null){
      value = cond.value;
    } else {
      value = '';
    }
    return `${symbol} ${value}`.trim();
  }

  function renderLegendPanel(){
    if(!legendPanel) return;
    const attributeLabels = { heat:'Heat', amplitude:'Amplitude', tension:'Tension', phase:'Phase' };
    const attributeOrder = ['heat','amplitude','tension','phase'];
    let html = '<h3 style="margin-top:0">Material Legend</h3>';
    if(GLOBAL_EFFECTS?.length){
      html += '<div class="legend-card" data-card-mode="global"><div class="legend-header"><span class="dot" style="background:#8891a7"></span>Global Effects</div>';
      html += '<div class="legend-attribute">';
      for(const entry of GLOBAL_EFFECTS){
        html += `<div class="legend-attribute-title">${entry.attribute}</div>`;
        html += '<div class="legend-chip-row">';
        for(const cond of entry.conditions){
          const text = `${formatCondition(cond)} · ${cond.effect}`;
          const valueAttr = Array.isArray(cond.value) ? cond.value.join(',') : (cond.value ?? '');
          html += `<span class="legend-chip" data-threshold data-mode="global" data-attribute="${entry.attribute.toLowerCase()}" data-op="${cond.op}" data-value="${valueAttr}">${text}</span>`;
        }
        html += '</div>';
      }
      html += '</div></div>';
    }
    html += '<div class="legend-grid">';
    const materialEntries = Object.entries(materialLegend).sort((a,b)=> a[1].label.localeCompare(b[1].label));
    for(const [modeKey, info] of materialEntries){
      html += `<div class="legend-card" data-card-mode="${modeKey}"><div class="legend-header"><span class="dot" style="background:${info.color}"></span>${info.label}</div>`;
      for(const attrKey of attributeOrder){
        const list = info.attributes[attrKey] || [];
        if(!list.length) continue;
        html += `<div class="legend-attribute"><div class="legend-attribute-title">${attributeLabels[attrKey]}</div>`;
        html += '<div class="legend-chip-row">';
        for(const cond of list){
          const text = `${formatCondition(cond)} · ${cond.effect}`;
          const valueAttr = Array.isArray(cond.value) ? cond.value.join(',') : (cond.value ?? '');
          html += `<span class="legend-chip" data-threshold data-mode="${modeKey}" data-attribute="${attrKey}" data-op="${cond.op}" data-value="${valueAttr}">${text}</span>`;
        }
        html += '</div></div>';
      }
      if(info.interactions?.length){
        html += '<div class="legend-interactions"><div class="legend-attribute-title">Interactions</div><div class="legend-interactions-list">';
        for(const item of info.interactions){
          html += `<span class="legend-chip">${item.target}: ${item.effect}</span>`;
        }
        html += '</div></div>';
      }
      html += '</div>';
    }
    html += '</div>';
    legendPanel.innerHTML = html;
    legendRendered = true;
  }

  function updateHistoryUI(){
    if(!historyScrubber || !historySlider || !historyLabel){
      return;
    }
    if(!isTelemetryEnabled() || !simulation || !debugConfig.enableRecorder){
      historyScrubber.style.display = 'none';
      return;
    }
    const count = simulation.getRecorderCount ? Math.min(simulation.getRecorderCount(), HISTORY_MAX) : 0;
    historyScrubber.style.display = 'flex';
    historySlider.max = String(count);
    if(historyOffset > count) historyOffset = count;
    historySlider.value = String(historyOffset);
    historySlider.disabled = count === 0;
    historyLabel.textContent = historyOffset === 0 ? 'Now' : `-${historyOffset}`;
    historyLabel.title = '(no threshold change)';
  }

  const settingDisplays = {
    dHeat: document.getElementById('dHeatVal'),
    dO2: document.getElementById('dO2Val'),
    o2Base: document.getElementById('o2BaseVal'),
    o2Cut: document.getElementById('o2CutVal'),
  };

  const updateSettingDisplay = (el, key, formatter = v => v)=>{
    if(settingDisplays[key]){
      settingDisplays[key].textContent = formatter(parseFloat(el.value));
    }
  };

  const sliderFormat = v => v.toFixed(2);
  const sliderMap = [
    { el:dHeat, key:'dHeat', fmt:sliderFormat },
    { el:dO2, key:'dO2', fmt:sliderFormat },
    { el:o2Base, key:'o2Base', fmt:sliderFormat },
    { el:o2Cut, key:'o2Cut', fmt:sliderFormat },
  ];

  sliderMap.forEach(({el,key,fmt})=>{
    if(!el) return;
    el.addEventListener('input',()=> updateSettingDisplay(el,key,fmt));
    updateSettingDisplay(el,key,fmt);
  });

  function selectBrush(val){
    setBrush(val);
    if(!brushGrid) return;
    [...brushGrid.querySelectorAll('button[data-brush]')].forEach(btn=>{
      btn.classList.toggle('active', btn.getAttribute('data-brush')===val);
    });
    if(toggleDrawBtn){
      toggleDrawBtn.classList.remove('active');
      toggleDrawBtn.textContent = '✏️ Draw';
    }
  }

  let drawing = false;
  let isPointerDown = false;
  let isPanning = false;
  let panStartClient = null;
  let panStartOffset = null;
  let panScale = { x:1, y:1 };

  function isInteractiveElement(target){
    const el = target;
    if(!el) return false;
    const tag = el.tagName;
    if(tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el.isContentEditable) return true;
    return false;
  }

  function updateTelemetryInspector(tileIdx = getInspectedTile()){
    if(!telemetryPanel) return;
    if(!isTelemetryEnabled()){
      telemetryPanel.style.display = 'none';
      if(tMode){ tMode.textContent = '—'; }
      if(tTension){ tTension.textContent = '—'; }
      if(tAmplitude){ tAmplitude.textContent = '—'; }
      if(tPhase){ tPhase.textContent = '—'; }
      if(tHeat){ tHeat.textContent = '—'; }
      if(tTensionBar) tTensionBar.style.width = '0%';
      if(tAmplitudeBar) tAmplitudeBar.style.width = '0%';
      if(tPhaseBar) tPhaseBar.style.width = '0%';
      if(tHeatBar) tHeatBar.style.width = '0%';
      if(historyScrubber) historyScrubber.style.display = 'none';
      if(historyLabel) historyLabel.title = '(no threshold change)';
      lastInspectState = null;
      updateLegendHighlights(null);
      return;
    }
    telemetryPanel.style.display = 'flex';
    updateHistoryUI();

    if(tileIdx == null){
      if(tMode) tMode.textContent = '—';
      if(tTension) tTension.textContent = '—';
      if(tAmplitude) tAmplitude.textContent = '—';
      if(tPhase) tPhase.textContent = '—';
      if(tHeat) tHeat.textContent = '—';
      if(tTensionBar) tTensionBar.style.width = '0%';
      if(tAmplitudeBar) tAmplitudeBar.style.width = '0%';
      if(tPhaseBar) tPhaseBar.style.width = '0%';
      if(tHeatBar) tHeatBar.style.width = '0%';
      if(historyLabel) historyLabel.title = '(no threshold change)';
      lastInspectState = null;
      updateLegendHighlights(null);
      return;
    }

    const frame = (historyOffset > 0 && simulation && typeof simulation.getRecorderFrame === 'function')
      ? simulation.getRecorderFrame(historyOffset)
      : null;

    const heatArray = frame ? frame.heat : world.heat;
    const fireMask = frame ? frame.fireMask : null;
    const modeArray = frame ? frame.mode : null;
    const tensionArray = frame ? frame.tension : null;
    const amplitudeArray = frame ? frame.amplitude : null;
    const phaseArray = frame ? frame.phase : null;

    const S = (tileIdx != null)
      ? (frame
        ? (modeArray && modeArray[tileIdx]
          ? {
              mode: modeArray[tileIdx],
              tension: tensionArray[tileIdx],
              amplitude: amplitudeArray[tileIdx],
              phase: phaseArray[tileIdx],
            }
          : null)
        : world.strings[tileIdx])
      : null;

    const heatValue = clamp01((heatArray) ? heatArray[tileIdx] : 0);
    const heatHint = formatHeatHint(heatValue);
    const burning = frame ? !!(fireMask && fireMask[tileIdx]) : world.fire?.has(tileIdx);
    if(historyLabel){
      historyLabel.textContent = historyOffset === 0 ? 'Now' : `-${historyOffset}`;
      historyLabel.title = heatHint ? heatHint.replace(/^[\[]|[\]]$/g,'') : '(no threshold change)';
    }

    if(!S){
      if(tMode) tMode.textContent = burning ? 'Fire (burning)' : '—';
      if(tTension) tTension.textContent = '—';
      if(tAmplitude) tAmplitude.textContent = '—';
      if(tPhase) tPhase.textContent = '—';
      if(tHeat) tHeat.textContent = heatHint ? `${heatValue.toFixed(3)} ${heatHint}` : heatValue.toFixed(3);
      if(tTensionBar) tTensionBar.style.width = '0%';
      if(tAmplitudeBar) tAmplitudeBar.style.width = '0%';
      if(tPhaseBar) tPhaseBar.style.width = '0%';
      if(tHeatBar) tHeatBar.style.width = `${Math.round(heatValue*100)}%`;
      lastInspectState = {
        mode: null,
        heat: heatValue,
        amplitude: null,
        tension: null,
        phase: null,
      };
      updateLegendHighlights(lastInspectState);
      return;
    }

    if(tMode){
      const label = MODE_LABEL[S.mode] || `Mode ${S.mode}`;
      tMode.textContent = burning ? `${label} (burning)` : label;
    }
    if(tTension) tTension.textContent = S.tension.toFixed(3);
    if(tAmplitude) tAmplitude.textContent = S.amplitude.toFixed(3);
    const phaseValue = S.phase ?? 0;
    const normPhase = ((phaseValue % TAU) + TAU) % TAU;
    if(tPhase) tPhase.textContent = normPhase.toFixed(3);
    if(tHeat) tHeat.textContent = heatHint ? `${heatValue.toFixed(3)} ${heatHint}` : heatValue.toFixed(3);

    const tensionRatio = clamp01(S.tension);
    const amplitudeRatio = clamp01(S.amplitude);
    const phaseRatio = clamp01(normPhase / TAU);
    const heatRatio = heatValue;
    if(tTensionBar) tTensionBar.style.width = `${Math.round(tensionRatio*100)}%`;
    if(tAmplitudeBar) tAmplitudeBar.style.width = `${Math.round(amplitudeRatio*100)}%`;
    if(tPhaseBar) tPhaseBar.style.width = `${Math.round(phaseRatio*100)}%`;
    if(tHeatBar) tHeatBar.style.width = `${Math.round(heatRatio*100)}%`;

    lastInspectState = {
      mode: S.mode,
      heat: heatValue,
      amplitude: S.amplitude,
      tension: S.tension,
      phase: normPhase,
    };
    updateLegendHighlights(lastInspectState);
  }

  function applyTelemetryToggle(enabled){
    setTelemetryEnabled(enabled);
    if(toggleTelemetryBtn){
      toggleTelemetryBtn.classList.toggle('active', enabled);
    }
    if(!enabled){
      setInspectActive(false);
    }
    updateTelemetryInspector(enabled ? getInspectedTile() : null);
    updateHistoryUI();
    draw();
  }

  function applyPauseState(paused){
    setPaused(paused);
    if(togglePauseBtn){
      togglePauseBtn.textContent = paused ? '▶️ Play' : '⏸️ Pause';
      togglePauseBtn.classList.toggle('active', paused);
    }
  }

  function setRecorderButtonState(enabled){
    if(toggleRecorderBtn){
      toggleRecorderBtn.textContent = enabled ? '📼 Recorder On' : '📼 Recorder Off';
      toggleRecorderBtn.classList.toggle('active', enabled);
    }
  }

  function applyRecorderToggle(enabled){
    setDebugFlag('enableRecorder', enabled);
    if(simulation && typeof simulation.setRecorderEnabled === 'function'){
      simulation.setRecorderEnabled(enabled);
    }
    setRecorderButtonState(enabled);
    if(!enabled) historyOffset = 0;
    updateHistoryUI();
    updateTelemetryInspector();
  }

  function seedWarmGrid(){
    if(!simulation) return;
    const warmHeat = 0.25;
    for(let i=0;i<world.heat.length;i++){
      if(world.wall[i]) continue;
      world.heat[i] = Math.max(world.heat[i], warmHeat);
    }
    draw();
    updateMetrics();
    updateTelemetryInspector();
  }

  function pickTileForInspection(ev){
    const { x, y } = xyFromPointer(ev);
    const tile = idx(x,y);
    setInspectedTile(tile);
    updateTelemetryInspector(tile);
    draw();
  }

  function ensureTelemetryForInspect(){
    if(!isTelemetryEnabled()){
      applyTelemetryToggle(true);
    }
  }

  function togglePause(){
    if(!simulation) return;
    const pauseNext = !isPaused();
    if(pauseNext) simulation.pause();
    else simulation.resume();
    applyPauseState(pauseNext);
  }

  function stepSimulation(){
    if(!simulation) return;
    if(!isPaused()){
      simulation.pause();
      applyPauseState(true);
    }
    simulation.stepOnce();
    updateTelemetryInspector();
  }

  window.addEventListener('keydown',(ev)=>{
    if(isInteractiveElement(ev.target)) return;
    if(ev.code === 'Space'){
      if(!ev.repeat){
        ensureTelemetryForInspect();
        setInspectActive(true);
        drawing = false;
        isPointerDown = false;
        if(toggleDrawBtn){
          toggleDrawBtn.classList.remove('active');
          toggleDrawBtn.textContent = '✏️ Draw';
        }
      }
      ev.preventDefault();
    } else if(ev.code === 'KeyP'){
      if(!ev.repeat){
        togglePause();
        ev.preventDefault();
      }
    } else if(ev.code === 'Period'){
      if(isPaused() && !ev.repeat){
        stepSimulation();
        ev.preventDefault();
      }
    } else if(ev.code === 'KeyH' && !ev.repeat){
      setDebugFlag('overlay.heat', !debugConfig.overlay.heat);
      draw();
      ev.preventDefault();
    } else if(ev.code === 'KeyA' && !ev.repeat){
      setDebugFlag('overlay.amplitude', !debugConfig.overlay.amplitude);
      draw();
      ev.preventDefault();
    } else if(ev.code === 'KeyT' && !ev.repeat){
      setDebugFlag('overlay.tension', !debugConfig.overlay.tension);
      draw();
      ev.preventDefault();
    } else if(overlayToggleKeys[ev.code] && !ev.repeat){
      toggleOverlaySlice(overlayToggleKeys[ev.code]);
      ev.preventDefault();
    }
  }, { passive:false });

  window.addEventListener('keyup',(ev)=>{
    if(isInteractiveElement(ev.target)) return;
    if(ev.code === 'Space'){
      setInspectActive(false);
      ev.preventDefault();
    }
  }, { passive:false });

  if(brushGrid){
    brushGrid.addEventListener('click',(e)=>{
      const b = e.target.closest('button'); if(!b) return;
      const val = b.getAttribute('data-brush');
      if(!val){
        if(b.id==='toggleDraw'){
          drawing = !drawing;
          b.classList.toggle('active', drawing);
          b.textContent = drawing? '🛑 Stop':'✏️ Draw';
        }
        return;
      }
      if(val==='toggleDraw') return;
      selectBrush(val);
    });
  }

  if(toggleDrawBtn){
    toggleDrawBtn.addEventListener('click',()=>{
      drawing = !drawing;
      toggleDrawBtn.classList.toggle('active', drawing);
      toggleDrawBtn.textContent = drawing? '🛑 Stop':'✏️ Draw';
    });
  }

  function xyFromPointer(ev){
    const rect=canvas.getBoundingClientRect();
    const view = getViewState();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (ev.clientX - rect.left) * scaleX;
    const canvasY = (ev.clientY - rect.top) * scaleY;
    const worldX = (canvasX - view.offsetX) / view.scale;
    const worldY = (canvasY - view.offsetY) / view.scale;
    let x = Math.floor(worldX / world.cell);
    let y = Math.floor(worldY / world.cell);
    x=Math.max(0,Math.min(world.W-1,x));
    y=Math.max(0,Math.min(world.H-1,y));
    return {x,y};
  }

  const PHEROMONE_BRUSHES = Object.freeze({
    'pheromone-help': { field: 'helpField', value: 1 },
    'pheromone-panic': { field: 'panicField', value: 1 },
    'pheromone-route': { field: 'routeField', value: 1 },
    'pheromone-safe': { field: 'safeField', value: 1 },
    'pheromone-escape': { field: 'escapeField', value: 1 },
  });

  const PHEROMONE_FIELDS = Object.freeze([
    'helpField',
    'panicField',
    'routeField',
    'safeField',
    'escapeField',
  ]);

  function depositPheromone(fieldName, tileIdx, amount = 1){
    const field = world[fieldName];
    if(!field || tileIdx < 0 || tileIdx >= field.length) return;
    const current = field[tileIdx] ?? 0;
    field[tileIdx] = Math.max(current, amount);
  }

  function clearPheromones(tileIdx){
    for(const fieldName of PHEROMONE_FIELDS){
      const field = world[fieldName];
      if(field && tileIdx >= 0 && tileIdx < field.length){
        field[tileIdx] = 0;
      }
    }
  }

  function place(x,y){
    if(!inBounds(x,y)) return;
    const i=idx(x,y);
    world.clfCanisters?.delete(i);
    world.clfBurners?.delete(i);
    const brush=getBrush();
    if(brush==='eraser'){
      world.strings[i]=undefined;
      world.fire.delete(i);
      world.vent[i]=0;
      world.wall[i]=0;
      clearPheromones(i);
      draw();
      return;
    }
    if(brush==='wall'){
      world.wall[i]=1;
      world.vent[i]=0;
      world.strings[i]=undefined;
      world.fire.delete(i);
      draw();
      return;
    }
    if(brush==='vent'){
      world.vent[i]=1;
      draw();
      return;
    }
    if(brush==='fire'){
      world.vent[i]=0;
      world.fire.add(i);
      world.strings[i]=baseStringFor(Mode.FIRE);
      draw();
      return;
    }
    if(brush==='water'){
      world.strings[i]=baseStringFor(Mode.WATER);
      draw();
      return;
    }
    if(brush==='acid'){
      world.strings[i]=baseStringFor(Mode.ACID);
      draw();
      return;
    }
    if(brush==='base'){
      world.strings[i]=baseStringFor(Mode.BASE);
      draw();
      return;
    }
    if(brush==='ice'){
      world.strings[i]=baseStringFor(Mode.ICE);
      world.heat[i] = Math.min(world.heat[i], 0.2);
      draw();
      return;
    }
    if(brush==='cryofoam'){
      ensureCryofoam(i);
      draw();
      return;
    }
    if(brush==='clf3'){
      world.wall[i]=0;
      world.vent[i]=0;
      world.fire.delete(i);
      world.strings[i]=baseStringFor(Mode.CLF3);
      if(!world.clfCanisters) world.clfCanisters = new Map();
      world.clfCanisters.set(i,{ integrity:1, yield:5 });
      draw();
      return;
    }
    if(brush==='mycelium'){
      world.wall[i]=0;
      world.vent[i]=0;
      world.fire.delete(i);
      world.strings[i]=baseStringFor(Mode.MYCELIUM);
      draw();
      return;
    }
    const pheromone = PHEROMONE_BRUSHES[brush];
    if(pheromone){
      depositPheromone(pheromone.field, i, pheromone.value);
      draw();
      return;
    }
  }

  canvas.addEventListener('pointerdown',(ev)=>{
    ev.preventDefault();
    if(isInspectActive()){
      pickTileForInspection(ev);
      return;
    }
    if(ev.shiftKey){
      const rect = canvas.getBoundingClientRect();
      isPointerDown = true;
      isPanning = true;
      drawing = false;
      panStartClient = { x: ev.clientX, y: ev.clientY };
      panStartOffset = getViewState();
      panScale = {
        x: canvas.width / rect.width,
        y: canvas.height / rect.height,
      };
      return;
    }
    isPointerDown = true;
    drawing = true;
    if(toggleDrawBtn){
      toggleDrawBtn.classList.add('active');
      toggleDrawBtn.textContent='🛑 Stop';
    }
    const {x,y}=xyFromPointer(ev);
    place(x,y);
  });

  canvas.addEventListener('pointermove',(ev)=>{
    if(isPanning){
      if(!isPointerDown) return;
      const view = panStartOffset || getViewState();
      const dx = (ev.clientX - panStartClient.x) * panScale.x;
      const dy = (ev.clientY - panStartClient.y) * panScale.y;
      const clamped = clampOffset(view.offsetX + dx, view.offsetY + dy, view.scale);
      setViewOffset(clamped.x, clamped.y);
      draw();
      return;
    }
    if(isInspectActive()){
      if(isPointerDown) pickTileForInspection(ev);
      return;
    }
    if(!isPointerDown || !drawing) return;
    const {x,y}=xyFromPointer(ev);
    place(x,y);
  });

  const endPointer = ()=>{
    isPointerDown=false;
    if(isPanning){
      isPanning=false;
      drawing=false;
      panStartClient=null;
      panStartOffset=null;
    }
  };

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  const getSettings = ()=>({
    dHeat: parseFloat(dHeat?.value ?? '0.18'),
    dO2: parseFloat(dO2?.value ?? '0.10'),
    o2Base: parseFloat(o2Base?.value ?? '0.21'),
    o2Cut: parseFloat(o2Cut?.value ?? '0.16'),
  });

  function updateMetrics({ reset=false, diagnostics }={}){
    if(reset){
      metricsState.prevO2Sum = null;
      metricsState.prevFireSum = null;
      metricsState.aggregates.modeCounts = new Map();
      metricsState.histograms.amplitude.fill(0);
      metricsState.histograms.tension.fill(0);
      metricsState.histograms.heat.fill(0);
      if(mAmpAvg) mAmpAvg.textContent = '—';
      if(mTensionAvg) mTensionAvg.textContent = '—';
      if(mHeatAvg) mHeatAvg.textContent = '—';
      if(mModeCounts) mModeCounts.textContent = '';
      if(mFieldTotals) mFieldTotals.textContent = '—';
      if(mHotAgents) mHotAgents.textContent = '—';
      if(mOverwhelmed) mOverwhelmed.textContent = '—';
      renderHistogram(histAmplitudeBars, metricsState.histograms.amplitude);
      renderHistogram(histTensionBars, metricsState.histograms.tension);
      renderHistogram(histHeatBars, metricsState.histograms.heat);
    }
    let sumO2=0, tiles=0;
    for(let i=0;i<world.o2.length;i++){
      if(!world.wall[i]){ sumO2+=world.o2[i]; tiles++; }
    }
    const avgO2 = tiles? (sumO2/tiles) : 0;
    let sumFire=0;
    for(const i of world.fire){
      const S=world.strings[i];
      sumFire += S ? S.amplitude : 1;
    }
    const dO2 = (metricsState.prevO2Sum==null || reset)? 0 : (sumO2 - metricsState.prevO2Sum);
    const dFire = (metricsState.prevFireSum==null || reset)? 0 : (sumFire - metricsState.prevFireSum);
    metricsState.prevO2Sum = sumO2;
    metricsState.prevFireSum = sumFire;
    if(mO2) mO2.textContent = avgO2.toFixed(3);
    if(mO2d) mO2d.textContent = (tiles? dO2/tiles : 0).toFixed(4);
    if(mFire) mFire.textContent = sumFire.toFixed(2);
    if(mFired) mFired.textContent = dFire.toFixed(3);
    if(isTelemetryEnabled()) updateTelemetryInspector();

    const modeCounts = metricsState.aggregates.modeCounts;
    modeCounts.clear();
    const histAmp = metricsState.histograms.amplitude;
    const histTen = metricsState.histograms.tension;
    const histHeat = metricsState.histograms.heat;
    histAmp.fill(0);
    histTen.fill(0);
    histHeat.fill(0);

    let ampSum = 0;
    let tensionSum = 0;
    let heatSum = 0;
    let sampleCount = 0;

    const bucketFor = (value, buckets)=> Math.min(buckets-1, Math.max(0, Math.floor(clamp01(value) * buckets)));

    for(let i=0;i<world.strings.length;i++){
      const S = world.strings[i];
      if(!S) continue;
      sampleCount++;
      ampSum += S.amplitude;
      tensionSum += S.tension;
      const heatVal = clamp01(world.heat[i] ?? 0);
      heatSum += heatVal;
      modeCounts.set(S.mode, (modeCounts.get(S.mode) || 0) + 1);
      histAmp[bucketFor(S.amplitude, histAmp.length)]++;
      histTen[bucketFor(S.tension, histTen.length)]++;
      histHeat[bucketFor(heatVal, histHeat.length)]++;
    }

    const denom = sampleCount || 1;
    metricsState.aggregates.avgAmplitude = ampSum / denom;
    metricsState.aggregates.avgTension = tensionSum / denom;
    metricsState.aggregates.heatAverage = heatSum / denom;
    metricsState.aggregates.fireIntensity = sumFire;

    if(mAmpAvg) mAmpAvg.textContent = metricsState.aggregates.avgAmplitude.toFixed(3);
    if(mTensionAvg) mTensionAvg.textContent = metricsState.aggregates.avgTension.toFixed(3);
    if(mHeatAvg) mHeatAvg.textContent = metricsState.aggregates.heatAverage.toFixed(3);

    if(mModeCounts){
      const entries = Array.from(modeCounts.entries()).sort((a,b)=> b[1]-a[1]);
      mModeCounts.innerHTML = entries.slice(0,6).map(([mode,count])=>{
        const label = MODE_LABEL[mode] || `Mode ${mode}`;
        return `<span class="kbd" style="background:#1b2439">${label}: ${count}</span>`;
      }).join(' ');
    }

    renderHistogram(histAmplitudeBars, histAmp);
    renderHistogram(histTensionBars, histTen);
    renderHistogram(histHeatBars, histHeat);
    if(diagnostics){
      metricsState.diagnostics = diagnostics;
      const totals = diagnostics.fieldTotals || {};
      if(mFieldTotals){
        mFieldTotals.textContent = ['H', (totals.help ?? 0).toFixed(2),
                                    'R', (totals.route ?? 0).toFixed(2),
                                    'P', (totals.panic ?? 0).toFixed(2),
                                    'S', (totals.safe ?? 0).toFixed(2),
                                    'E', (totals.escape ?? 0).toFixed(2)].join(' ');
      }
      if(mHotAgents) mHotAgents.textContent = String(diagnostics.hotAgents ?? 0);
      if(mOverwhelmed) mOverwhelmed.textContent = String(diagnostics.overwhelmedAgents ?? 0);
    }
    updateHistoryUI();
  }

  const heatThresholdHints = {
    freeze: '≤ 0.15 ⇒ Water → Ice',
    melt: '≥ 0.20 ⇒ Ice → Water',
    burn: '≥ 0.75 ⇒ Agents lose tension',
  };

  function formatHeatHint(value){
    const hints=[];
    if(value <= 0.15) hints.push('freeze');
    if(value >= 0.20) hints.push('melt');
    if(value >= 0.75) hints.push('burn');
    if(!hints.length) return '';
    return `[${hints.map(key=> heatThresholdHints[key]).join(' • ')}]`;
  }

  function matchesThreshold(op, thresholdValue, actual){
    if(actual == null) return false;
    const EPS = 1e-4;
    switch(op){
      case '<=': return actual <= (thresholdValue + EPS);
      case '>=': return actual >= (thresholdValue - EPS);
      case 'between':
        return Array.isArray(thresholdValue) && thresholdValue.length === 2 && actual >= thresholdValue[0] - EPS && actual <= thresholdValue[1] + EPS;
      default:
        return false;
    }
  }

  function updateLegendHighlights(state){
    if(!legendPanel || !legendRendered) return;
    const chips = legendPanel.querySelectorAll('[data-threshold]');
    chips.forEach(chip=> chip.classList.remove('active'));
    const cards = legendPanel.querySelectorAll('[data-card-mode]');
    cards.forEach(card=> card.classList.remove('active'));
    if(!state){
      return;
    }
    if(state.mode != null){
      const card = legendPanel.querySelector(`[data-card-mode="${state.mode}"]`);
      if(card) card.classList.add('active');
    }
    const attrMap = {
      heat: state.heat,
      amplitude: state.amplitude,
      tension: state.tension,
      phase: state.phase,
    };
    chips.forEach(chip=>{
      const modeAttr = chip.dataset.mode;
      const attribute = chip.dataset.attribute;
      const op = chip.dataset.op;
      if(op === '≈') return;
      const valueRaw = chip.dataset.value;
      let thresholdValue = valueRaw === '' ? null : valueRaw;
      if(op === 'between'){
        thresholdValue = valueRaw.split(',').map(v=> parseFloat(v));
      } else if(thresholdValue != null){
        const num = parseFloat(thresholdValue);
        thresholdValue = Number.isNaN(num) ? thresholdValue : num;
      }
      if(modeAttr !== 'global'){
        if(state.mode == null || Number(modeAttr) !== state.mode) return;
      }
      const actual = attrMap[attribute];
      if(typeof thresholdValue === 'number'){
        if(matchesThreshold(op, thresholdValue, actual)) chip.classList.add('active');
      } else if(Array.isArray(thresholdValue)){
        if(matchesThreshold(op, thresholdValue, actual)) chip.classList.add('active');
      }
    });
  }

  let simulation = null;

  function bindSimulation(api){
    simulation = api;
    applyPauseState(false);
    setRecorderButtonState(debugConfig.enableRecorder);
    if(simulation && typeof simulation.setRecorderEnabled === 'function'){
      simulation.setRecorderEnabled(debugConfig.enableRecorder);
    }
    updateHistoryUI();
    if(spawnCalmBtn){
      spawnCalmBtn.onclick = ()=>{
        simulation.spawnNPC(Mode.CALM);
      };
    }
    if(spawnPanicBtn){
      spawnPanicBtn.onclick = ()=>{
        simulation.spawnNPC(Mode.PANIC);
      };
    }
    if(spawnMedicBtn){
      spawnMedicBtn.onclick = ()=>{
        simulation.spawnNPC(Mode.MEDIC);
      };
    }
    if(sparkBtn){
      sparkBtn.onclick = ()=> simulation.randomFires(50);
    }
    if(clearBtn){
      clearBtn.onclick = ()=>{
        const settings = getSettings();
        simulation.resetWorld(settings.o2Base);
        updateMetrics({ reset:true });
      };
    }
    if(fastStepBtn){
      fastStepBtn.onclick = ()=>{
        const mult = Math.max(1, (parseInt(simSpeedSlider?.value ?? '1', 10) || 1) * 10);
        simulation.fastForward(mult);
      };
    }
  }

  if(zoomInBtn) zoomInBtn.addEventListener('click',()=> applyZoom(1.25));
  if(zoomOutBtn) zoomOutBtn.addEventListener('click',()=> applyZoom(0.8));
  if(toggleTelemetryBtn) toggleTelemetryBtn.addEventListener('click',()=> applyTelemetryToggle(!isTelemetryEnabled()));
  if(togglePauseBtn) togglePauseBtn.addEventListener('click',()=> togglePause());
  if(stepOnceBtn) stepOnceBtn.addEventListener('click',()=> stepSimulation());
  if(toggleRecorderBtn) toggleRecorderBtn.addEventListener('click',()=> applyRecorderToggle(!debugConfig.enableRecorder));
  if(seedWarmBtn) seedWarmBtn.addEventListener('click',()=> seedWarmGrid());
  if(metricsToggle && metricsSummary){
    metricsToggle.addEventListener('click',()=>{
      metricsExpanded = !metricsExpanded;
      metricsSummary.hidden = !metricsExpanded;
      metricsToggle.setAttribute('aria-expanded', String(metricsExpanded));
      const icon = metricsToggle.querySelector('.accordion-icon');
      if(icon) icon.textContent = metricsExpanded ? '▾' : '▸';
    });
  }
  if(historySlider){
    historySlider.addEventListener('input',()=>{
      historyOffset = parseInt(historySlider.value,10) || 0;
      updateHistoryUI();
      updateTelemetryInspector();
    });
  }
  if(canvasSizeSelect){
    canvasSizeSelect.addEventListener('change',()=>{
      const value = canvasSizeSelect.value;
      if(value === 'auto'){
        setCustomCanvasSize(null);
      } else {
        const [width,height] = value.split('x').map(v=> parseInt(v,10));
        if(width && height){
          setCustomCanvasSize({ width, height });
        }
      }
    });
  }

  if(simSpeedSlider){
    const applySpeed = ()=>{
      const value = parseInt(simSpeedSlider.value, 10) || 1;
      setSimSpeed(value);
      if(simSpeedVal) simSpeedVal.textContent = String(value);
    };
    simSpeedSlider.value = String(getSimSpeed());
    if(simSpeedVal) simSpeedVal.textContent = String(getSimSpeed());
    simSpeedSlider.addEventListener('input', applySpeed);
    applySpeed();
  }

  setRecorderButtonState(debugConfig.enableRecorder);
  updateHistoryUI();
  if(!legendRendered) renderLegendPanel();
  updateLegendHighlights(lastInspectState);
  if(metricsToggle){
    metricsToggle.setAttribute('aria-expanded','false');
    const icon = metricsToggle.querySelector('.accordion-icon');
    if(icon) icon.textContent = '▸';
  }
  if(metricsSummary){
    metricsSummary.hidden = true;
  }
  updateTelemetryInspector(null);

  function applyZoom(factor, anchor){
    const view = getViewState();
    const newScale = Math.min(Math.max(view.scale * factor, 1), 5);
    if(newScale === view.scale) return;
    const anchorPoint = anchor || { x: canvas.width / 2, y: canvas.height / 2 };
    const worldX = (anchorPoint.x - view.offsetX) / view.scale;
    const worldY = (anchorPoint.y - view.offsetY) / view.scale;
    setViewScale(newScale);
    let newOffsetX = anchorPoint.x - worldX * newScale;
    let newOffsetY = anchorPoint.y - worldY * newScale;
    const clamped = clampOffset(newOffsetX, newOffsetY, newScale);
    setViewOffset(clamped.x, clamped.y);
    draw();
  }

  function clampOffset(offsetX, offsetY, scale){
    const contentWidth = world.W * world.cell * scale;
    const contentHeight = world.H * world.cell * scale;
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
    return { x: offsetX, y: offsetY };
  }

  return { getSettings, updateMetrics, bindSimulation, selectBrush };
}
