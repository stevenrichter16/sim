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
  getWorldSeed,
  unmarkScenarioFire,
} from './state.js';
import { baseStringFor, ensureCryofoam } from './materials.js';
import { FACTIONS, DEFAULT_FACTION_ID, factionByKey } from './factions.js';
import { Agent } from './simulation.js';
import { fetchScenarioManifest, fetchScenarioAsset } from './scenarioRegistry.js';
import { createScenarioDiagnosticsStore } from './scenarioDiagnosticsStore.js';
import {
  isFactoryBrush,
  placeFactoryStructure,
  removeFactoryStructure,
  getActiveOrientation,
  rotateActiveOrientation,
  getFactoryStatus,
  getOrientationLabelText,
  isFactoryMode,
} from './factory.js';

const MODE_LABEL = Object.fromEntries(
  Object.entries(Mode).map(([name, value])=>{
    const label = name.toLowerCase().replace(/_/g,' ');
    return [value, label.replace(/\b\w/g, ch => ch.toUpperCase())];
  })
);

export function initInput({ canvas, draw }){
  const brushGrid = document.getElementById('brushGrid');
  const factoryBrushGrid = document.getElementById('factoryBrushGrid');
  const factoryRotateLeftBtn = document.getElementById('factoryRotateLeft');
  const factoryRotateRightBtn = document.getElementById('factoryRotateRight');
  const factoryOrientationLabel = document.getElementById('factoryOrientation');
  const factoryStatusNode = document.getElementById('factoryStatus');
  const toggleDrawBtn = document.getElementById('toggleDraw');
  const spawnCalmABtn = document.getElementById('spawnCalmA');
  const spawnCalmBBtn = document.getElementById('spawnCalmB');
  const spawnCalmCBtn = document.getElementById('spawnCalmC');
  const spawnPanicABtn = document.getElementById('spawnPanicA');
  const spawnPanicBBtn = document.getElementById('spawnPanicB');
  const spawnMedicBtn = document.getElementById('spawnMedic');
  const sparkBtn = document.getElementById('spark');
  const clearBtn = document.getElementById('clear');
  const dHeat = document.getElementById('dHeat');
  const dO2 = document.getElementById('dO2');
  const o2Base = document.getElementById('o2Base');
  const o2Cut = document.getElementById('o2Cut');
  const scenarioSelect = document.getElementById('scenarioSelect');
  const scenarioLoadBtn = document.getElementById('scenarioLoad');
  const scenarioRefreshBtn = document.getElementById('scenarioRefresh');
  const scenarioStatusText = document.getElementById('scenarioStatusText');
  const scenarioSeedInput = document.getElementById('scenarioSeed');
  const scenarioDiagToggle = document.getElementById('scenarioDiagToggle');
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
  const mStuckAgents = document.getElementById('mStuckAgents');
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
  const toggleFrontierBtn = document.getElementById('toggleFrontier');
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
    KeyM: 'memory',
    Digit6: 'door',
    KeyR: 'reinforce',
    KeyF: 'frontier',
  };

  FACTIONS.forEach((faction, index) => {
    if(index < 3){
      overlayToggleKeys[`Digit${7 + index}`] = `safeFaction${faction.id}`;
    }
  });
  if(FACTIONS[0]) overlayToggleKeys.KeyA = `safeFaction${FACTIONS[0].id}`;
  if(FACTIONS[1]) overlayToggleKeys.KeyB = `safeFaction${FACTIONS[1].id}`;
  overlayToggleKeys.KeyC = 'control';

  const spawnErrorMessages = {
    'tile-occupied': 'Spawn failed: tile is occupied or blocked.',
    'no-open-tile': 'Spawn failed: no open tile was available.',
    'invalid-faction': 'Spawn failed: faction not recognized.',
    unknown: 'Spawn failed.',
  };
  let spawnStatusNode = null;
  let spawnStatusTimer = null;

  function ensureSpawnStatusNode(){
    if(typeof document === 'undefined') return null;
    if(spawnStatusNode && spawnStatusNode.isConnected) return spawnStatusNode;
    if(!spawnStatusNode){
      spawnStatusNode = document.getElementById('spawnStatus') || document.createElement('div');
      spawnStatusNode.id = 'spawnStatus';
      spawnStatusNode.setAttribute('role', 'status');
      spawnStatusNode.setAttribute('aria-live', 'polite');
      spawnStatusNode.style.cssText = 'position:fixed;left:50%;bottom:64px;transform:translateX(-50%);background:#1a1233;color:#ffe3f8;padding:8px 14px;border-radius:10px;border:1px solid #694a9a;box-shadow:0 6px 18px rgba(0,0,0,0.45);font:13px/1.35 ui-monospace;display:none;z-index:99990;';
    }
    if(!spawnStatusNode.isConnected && document.body){
      document.body.appendChild(spawnStatusNode);
    }
    return spawnStatusNode;
  }

  function clearSpawnStatus(){
    if(spawnStatusTimer != null){
      const clearFn = (typeof clearTimeout === 'function')
        ? clearTimeout
        : (typeof globalThis !== 'undefined' && typeof globalThis.clearTimeout === 'function'
            ? globalThis.clearTimeout.bind(globalThis)
            : null);
      if(clearFn){
        clearFn(spawnStatusTimer);
      }
      spawnStatusTimer = null;
    }
    if(spawnStatusNode){
      spawnStatusNode.style.display = 'none';
    }
  }

  function showSpawnStatus(message){
    const node = ensureSpawnStatusNode();
    if(!node) return;
    node.textContent = message;
    node.style.display = 'block';
    if(spawnStatusTimer != null){
      const clearFn = (typeof clearTimeout === 'function')
        ? clearTimeout
        : (typeof globalThis !== 'undefined' && typeof globalThis.clearTimeout === 'function'
            ? globalThis.clearTimeout.bind(globalThis)
            : null);
      if(clearFn){
        clearFn(spawnStatusTimer);
      }
    }
    const timeoutFn = (typeof setTimeout === 'function')
      ? setTimeout
      : (typeof globalThis !== 'undefined' && typeof globalThis.setTimeout === 'function'
          ? globalThis.setTimeout.bind(globalThis)
          : null);
    if(timeoutFn){
      spawnStatusTimer = timeoutFn(() => {
        if(spawnStatusNode){
          spawnStatusNode.style.display = 'none';
        }
        spawnStatusTimer = null;
      }, 2800);
    }
  }

  function formatSpawnContext(mode, faction){
    if(mode == null && !faction) return '';
    const modeLabel = mode != null ? (MODE_LABEL[mode] ?? String(mode)) : '';
    const factionLabel = faction?.key ? `Faction ${faction.key}` : '';
    return [modeLabel, factionLabel].filter(Boolean).join(' ');
  }

  function handleSpawnResult(result, context = {}){
    if(!result) return null;
    if(result.ok){
      clearSpawnStatus();
      return result;
    }
    const code = result.error ?? 'unknown';
    const base = spawnErrorMessages[code] ?? `Spawn failed (${code}).`;
    const contextLabel = formatSpawnContext(context.mode, context.faction);
    const message = contextLabel ? `${contextLabel}: ${base}` : base;
    console.warn('[spawn]', message, { result, context });
    showSpawnStatus(message);
    return result;
  }

let scenarioManifestEntries = [];
let scenarioStatusTimer = null;
const scenarioDiagStore = createScenarioDiagnosticsStore({ maxEntries: 60 });
let scenarioDiagPanel = null;
let scenarioDiagList = null;
let scenarioDiagVisible = false;

function showScenarioStatus(message, tone = 'info'){
  if(!scenarioStatusText) return;
  const palette = {
    info: '#b9c2e5',
    success: '#a9ffbe',
    error: '#ff9fa8',
  };
  scenarioStatusText.textContent = message;
  scenarioStatusText.style.color = palette[tone] ?? palette.info;
  scenarioStatusText.style.display = message ? 'block' : 'none';
  if(scenarioStatusTimer != null && typeof clearTimeout === 'function'){
    clearTimeout(scenarioStatusTimer);
    scenarioStatusTimer = null;
  }
  if(message && typeof setTimeout === 'function'){
    scenarioStatusTimer = setTimeout(()=>{
      scenarioStatusTimer = null;
      if(scenarioStatusText){
        scenarioStatusText.style.display = 'none';
      }
    }, 4000);
  }
}

function ensureScenarioDiagPanel(){
  if(typeof document === 'undefined') return null;
  if(scenarioDiagPanel && scenarioDiagPanel.isConnected) return scenarioDiagPanel;
  if(!scenarioDiagPanel){
    scenarioDiagPanel = document.createElement('div');
    scenarioDiagPanel.id = 'scenarioDiagPanel';
    scenarioDiagPanel.style.cssText = 'position:fixed;right:16px;top:16px;width:340px;max-height:60vh;background:#0f1428;color:#e4eaff;border:1px solid #3a4574;border-radius:10px;box-shadow:0 16px 36px rgba(0,0,0,0.5);display:none;flex-direction:column;font:12px/1.4 ui-monospace;z-index:99991;';
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid #2c3359;background:#161d36;border-radius:10px 10px 0 0;';
    const title = document.createElement('span');
    title.textContent = 'Scenario Diagnostics';
    header.appendChild(title);
    const controlWrap = document.createElement('div');
    controlWrap.style.display = 'flex';
    controlWrap.style.gap = '6px';
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = 'Clear';
    clearBtn.style.cssText = 'padding:2px 8px;border-radius:6px;background:#2a3561;border:1px solid #42508a;color:#e4eaff;cursor:pointer;font:11px ui-monospace;';
    clearBtn.addEventListener('click', ()=>{
      scenarioDiagStore.clear();
      renderScenarioDiagnostics();
    });
    controlWrap.appendChild(clearBtn);
    header.appendChild(controlWrap);
    scenarioDiagPanel.appendChild(header);
    scenarioDiagList = document.createElement('div');
    scenarioDiagList.id = 'scenarioDiagList';
    scenarioDiagList.style.cssText = 'overflow:auto;padding:8px 10px;display:flex;flex-direction:column;gap:6px;';
    scenarioDiagPanel.appendChild(scenarioDiagList);
  }
  if(!scenarioDiagPanel.isConnected && document.body){
    document.body.appendChild(scenarioDiagPanel);
  }
  return scenarioDiagPanel;
}

function renderScenarioDiagnostics(){
  const panel = ensureScenarioDiagPanel();
  if(!panel || !scenarioDiagList) return;
  const entries = scenarioDiagStore.getEntries();
  scenarioDiagList.innerHTML = '';
  if(entries.length === 0){
    const empty = document.createElement('div');
    empty.textContent = 'No scenario diagnostics yet.';
    empty.style.opacity = '0.7';
    scenarioDiagList.appendChild(empty);
    return;
  }
  entries.forEach((entry)=>{
    const item = document.createElement('div');
    item.style.cssText = 'padding:6px 8px;border-radius:6px;background:rgba(22,28,52,0.85);border:1px solid rgba(79,101,168,0.35);';
    if(entry.type === 'error' || entry.type === 'watchdog'){
      item.style.borderColor = 'rgba(255,132,132,0.55)';
    }
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;gap:6px;margin-bottom:4px;font-size:11px;';
    const typeLabel = document.createElement('span');
    typeLabel.textContent = entry.type.toUpperCase();
    const meta = document.createElement('span');
    meta.style.opacity = '0.7';
    const metaParts = [];
    if(entry.tick != null) metaParts.push(`tick ${entry.tick}`);
    if(entry.chunk) metaParts.push(entry.chunk);
    if(entry.native) metaParts.push(`native ${entry.native}`);
    meta.textContent = metaParts.join(' · ');
    header.appendChild(typeLabel);
    header.appendChild(meta);
    const body = document.createElement('div');
    body.textContent = entry.message;
    item.appendChild(header);
    item.appendChild(body);
    scenarioDiagList.appendChild(item);
  });
}

function toggleScenarioDiagPanel(force){
  const panel = ensureScenarioDiagPanel();
  if(!panel) return;
  scenarioDiagVisible = force != null ? !!force : !scenarioDiagVisible;
  panel.style.display = scenarioDiagVisible ? 'flex' : 'none';
  if(scenarioDiagVisible){
    renderScenarioDiagnostics();
  }
}

  function populateScenarioOptions(entries){
    if(!scenarioSelect) return;
    scenarioManifestEntries = entries;
    while(scenarioSelect.firstChild){
      scenarioSelect.removeChild(scenarioSelect.firstChild);
    }
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.dataset.placeholder = 'true';
    placeholder.textContent = entries.length ? '(Select scenario)' : '(No scenarios found)';
    placeholder.disabled = entries.length === 0;
    placeholder.selected = true;
    scenarioSelect.appendChild(placeholder);
    entries.forEach((entry, index)=>{
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = entry.capabilities && entry.capabilities.length
        ? `${entry.name} (${entry.capabilities.join(', ')})`
        : entry.name;
      scenarioSelect.appendChild(option);
    });
    if(scenarioLoadBtn){
      scenarioLoadBtn.disabled = entries.length === 0 || !simulation;
    }
  }

  async function refreshScenarioManifest(showStatus = true){
    if(!scenarioSelect) return;
    if(scenarioRefreshBtn) scenarioRefreshBtn.disabled = true;
    scenarioSelect.disabled = true;
    try {
      const entries = await fetchScenarioManifest();
      populateScenarioOptions(entries);
      if(showStatus){
        showScenarioStatus(entries.length ? `Loaded ${entries.length} scenario${entries.length === 1 ? '' : 's'}.` : 'No scenarios available.', entries.length ? 'info' : 'error');
      }
    } catch (error) {
      console.error('[scenario] manifest refresh failed', error);
      populateScenarioOptions([]);
      showScenarioStatus('Failed to load scenarios.', 'error');
    } finally {
      scenarioSelect.disabled = false;
      if(scenarioRefreshBtn) scenarioRefreshBtn.disabled = false;
    }
  }

  function getSelectedScenarioEntry(){
    if(!scenarioSelect) return null;
    const value = scenarioSelect.value;
    if(value === '') return null;
    const index = parseInt(value, 10);
    if(Number.isNaN(index) || index < 0 || index >= scenarioManifestEntries.length){
      return null;
    }
    return scenarioManifestEntries[index];
  }

  async function handleScenarioLoad(){
    if(!simulation){
      showScenarioStatus('Simulation not ready.', 'error');
      return;
    }
    const entry = getSelectedScenarioEntry();
    if(!entry){
      showScenarioStatus('Select a scenario first.', 'error');
      return;
    }
    try {
      if(scenarioLoadBtn) scenarioLoadBtn.disabled = true;
      if(scenarioRefreshBtn) scenarioRefreshBtn.disabled = true;
      scenarioSelect.disabled = true;
      const asset = await fetchScenarioAsset(entry);
      if(!asset){
        showScenarioStatus('Failed to download scenario asset.', 'error');
        return;
      }
      const result = simulation.loadScenarioAsset(asset);
      if(result?.status === 'error'){
        const message = result.error?.message ?? 'Scenario failed to load.';
        showScenarioStatus(message, 'error');
        return;
      }
      showScenarioStatus(`Loaded scenario: ${entry.name}`, 'success');
    } catch (error) {
      console.error('[scenario] load failed', error);
      showScenarioStatus('Scenario load failed.', 'error');
    } finally {
      scenarioSelect.disabled = false;
      if(scenarioRefreshBtn) scenarioRefreshBtn.disabled = false;
      if(scenarioLoadBtn) scenarioLoadBtn.disabled = simulation == null;
    }
  }

  function updateOverlayButtonState(name){
    if(!brushGrid) return;
    const button = brushGrid.querySelector(`[data-brush="toggle-${name}"]`);
    if(button){
      button.classList.toggle('active', !!debugConfig.overlay?.[name]);
    }
  }

  function toggleOverlaySlice(name){
    const current = !!debugConfig.overlay?.[name];
    setDebugFlag(`overlay.${name}`, !current);
    updateOverlayButtonState(name);
    if(name === 'frontier' && toggleFrontierBtn){
      const active = !!debugConfig.overlay?.frontier;
      toggleFrontierBtn.classList.toggle('active', active);
      toggleFrontierBtn.textContent = active ? '🌐 Hide Frontier Field' : '🌐 Show Frontier Field';
    }
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
  const DEFAULT_FACTION_KEY = FACTIONS[DEFAULT_FACTION_ID]?.key ?? (FACTIONS[0]?.key ?? 'A');
  const ALT_FACTION_KEY = FACTIONS[1]?.key ?? DEFAULT_FACTION_KEY;
  let dragAgent = null;
  let dragBrush = null;
  let dragFactionKey = DEFAULT_FACTION_KEY;

  const ensureAgentMode = (agent, mode)=>{
    agent.role = mode;
    agent.isMedic = mode === Mode.MEDIC;
    agent.S = baseStringFor(mode);
    agent.S.mode = mode;
    agent.panicLevel = mode === Mode.PANIC ? 1 : 0;
    agent.medicTarget = null;
    agent.medicPath = [];
  };

  const agentAt = (x,y)=>{
    if(!world.agents) return null;
    for(const agent of world.agents){
      if(agent.x === x && agent.y === y) return agent;
    }
    return null;
  };
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

  const syncFactoryOrientation = () => {
    if(factoryOrientationLabel){
      factoryOrientationLabel.textContent = getOrientationLabelText();
    }
  };

  const updateFactoryStatusUI = () => {
    if(!factoryStatusNode) return;
    const status = getFactoryStatus();
    if(!status) return;
    const produced = status.produced || {};
    const stored = status.stored || {};
    factoryStatusNode.textContent = `Ore ${produced.ore ?? 0} • Ingots ${produced.ingot ?? 0} • Plates ${produced.plate ?? 0} • Stored Plates ${stored.plate ?? 0}`;
    syncFactoryOrientation();
  };

  syncFactoryOrientation();
  updateFactoryStatusUI();

  if(factoryRotateLeftBtn){
    factoryRotateLeftBtn.addEventListener('click', ()=>{
      rotateActiveOrientation(-1);
      syncFactoryOrientation();
    });
  }
  if(factoryRotateRightBtn){
    factoryRotateRightBtn.addEventListener('click', ()=>{
      rotateActiveOrientation(1);
      syncFactoryOrientation();
    });
  }

  function selectBrush(val){
    setBrush(val);
    if(brushGrid){
      [...brushGrid.querySelectorAll('button[data-brush]')].forEach(btn=>{
        btn.classList.toggle('active', btn.getAttribute('data-brush')===val);
      });
    }
    if(factoryBrushGrid){
      [...factoryBrushGrid.querySelectorAll('button[data-brush]')].forEach(btn=>{
        btn.classList.toggle('active', btn.getAttribute('data-brush')===val);
      });
    }
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
    } else if(ev.code === 'BracketLeft' && !ev.repeat){
      rotateActiveOrientation(-1);
      syncFactoryOrientation();
      ev.preventDefault();
    } else if(ev.code === 'BracketRight' && !ev.repeat){
      rotateActiveOrientation(1);
      syncFactoryOrientation();
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
      if(val==='toggle-control'){
        toggleOverlaySlice('control');
        return;
      }
      if(val==='toggle-reinforce'){
        toggleOverlaySlice('reinforce');
        return;
      }
      if(val==='toggle-reinforce-log'){
        const current = !!debugConfig.enableLogs?.reinforceSeed;
        setDebugFlag(['enableLogs','reinforceSeed'], !current);
        b.classList.toggle('active', !current);
        return;
      }
      selectBrush(val);
    });
  }

  if(factoryBrushGrid){
    factoryBrushGrid.addEventListener('click',(e)=>{
      const b = e.target.closest('button'); if(!b) return;
      const val = b.getAttribute('data-brush');
      if(!val) return;
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
  if(toggleFrontierBtn){
    const syncFrontierButton = ()=>{
      const active = !!debugConfig.overlay?.frontier;
      toggleFrontierBtn.classList.toggle('active', active);
      toggleFrontierBtn.textContent = active ? '🌐 Hide Frontier Field' : '🌐 Show Frontier Field';
    };
    toggleFrontierBtn.addEventListener('click', ()=>{
      toggleOverlaySlice('frontier');
      syncFrontierButton();
    });
    syncFrontierButton();
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

  updateOverlayButtonState('control');
  updateOverlayButtonState('reinforce');

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

  function place(x,y, ev){
    if(!inBounds(x,y)) return;
    const i=idx(x,y);
    world.clfCanisters?.delete(i);
    world.clfBurners?.delete(i);
    const brush=getBrush();
    if(brush!=='spawn-calm' && brush!=='spawn-panic'){
      dragAgent = null;
      dragBrush = null;
      dragFactionKey = DEFAULT_FACTION_KEY;
    }
    if(isFactoryBrush(brush)){
      const orientation = getActiveOrientation();
      const result = placeFactoryStructure(i, brush, { orientation });
      if(!result.ok){
        if(result.message) showSpawnStatus(result.message);
      } else {
        updateFactoryStatusUI();
      }
      draw();
      return;
    }
    if(brush==='eraser'){
      const removeNode = !!ev?.altKey;
      const factoryResult = removeFactoryStructure(i, { removeNode });
      if(!factoryResult.handled){
        world.strings[i]=undefined;
      }
      if(world.fire.delete(i)){
        unmarkScenarioFire(i);
      }
      world.vent[i]=0;
      world.wall[i]=0;
      if(world.doorTiles){
        world.doorTiles.delete(i);
        if(world.doorField) world.doorField[i] = 0;
      }
      clearPheromones(i);
      updateFactoryStatusUI();
      draw();
      return;
    }
    if(brush==='spawn-calm' || brush==='spawn-panic'){
      const mode = brush==='spawn-calm' ? Mode.CALM : Mode.PANIC;
      const factionKey = (dragAgent && dragBrush === brush) ? dragFactionKey : (ev?.altKey ? ALT_FACTION_KEY : DEFAULT_FACTION_KEY);
      const factionEntry = factionByKey(factionKey);
      if(world.wall[i]) world.wall[i] = 0;
      const existing = dragAgent && dragBrush === brush ? dragAgent : agentAt(x,y);
      let agent = existing;
      if(agent){
        if(agent.x !== x || agent.y !== y) {
          agent.x = x;
          agent.y = y;
        }
        agent.factionId = factionEntry.id;
        agent.factionKey = factionEntry.key;
        agent.faction = factionEntry.key;
        if(agent.S?.mode !== mode){
          ensureAgentMode(agent, mode);
        }
      } else {
        agent = new Agent(x, y, mode, factionEntry.id);
        ensureAgentMode(agent, mode);
        agent.factionId = factionEntry.id;
        agent.factionKey = factionEntry.key;
        agent.faction = factionEntry.key;
        if(!world.agents) world.agents = [];
        world.agents.push(agent);
      }
      dragAgent = agent;
      dragBrush = brush;
      dragFactionKey = factionEntry.key;
      draw();
      return;
    }
    if(brush==='door'){
      world.wall[i] = 0;
      if(world.fire.delete(i)){
        unmarkScenarioFire(i);
      }
      world.vent[i] = 0;
      world.strings[i] = undefined;
      world.doorTiles?.add(i);
      if(world.doorField) world.doorField[i] = 1;
      draw();
      return;
    }
    if(brush==='wall'){
      world.wall[i]=1;
      world.vent[i]=0;
      world.strings[i]=undefined;
      if(world.fire.delete(i)){
        unmarkScenarioFire(i);
      }
      world.doorTiles?.delete(i);
      if(world.doorField) world.doorField[i] = 0;
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
      world.doorTiles?.delete(i);
      if(world.doorField) world.doorField[i] = 0;
      draw();
      return;
    }
    if(brush==='water'){
      world.strings[i]=baseStringFor(Mode.WATER);
      world.doorTiles?.delete(i);
      if(world.doorField) world.doorField[i] = 0;
      draw();
      return;
    }
    if(brush==='acid'){
      world.strings[i]=baseStringFor(Mode.ACID);
      world.doorTiles?.delete(i);
      if(world.doorField) world.doorField[i] = 0;
      draw();
      return;
    }
    if(brush==='base'){
      world.strings[i]=baseStringFor(Mode.BASE);
      world.doorTiles?.delete(i);
      if(world.doorField) world.doorField[i] = 0;
      draw();
      return;
    }
    if(brush==='ice'){
      world.strings[i]=baseStringFor(Mode.ICE);
      world.heat[i] = Math.min(world.heat[i], 0.2);
      world.doorTiles?.delete(i);
      if(world.doorField) world.doorField[i] = 0;
      draw();
      return;
    }
    if(brush==='cryofoam'){
      ensureCryofoam(i);
      world.doorTiles?.delete(i);
      if(world.doorField) world.doorField[i] = 0;
      draw();
      return;
    }
    if(brush==='clf3'){
      world.wall[i]=0;
      world.vent[i]=0;
      if(world.fire.delete(i)){
        unmarkScenarioFire(i);
      }
      world.strings[i]=baseStringFor(Mode.CLF3);
      if(!world.clfCanisters) world.clfCanisters = new Map();
      world.clfCanisters.set(i,{ integrity:1, yield:5 });
      world.doorTiles?.delete(i);
      if(world.doorField) world.doorField[i] = 0;
      draw();
      return;
    }
    if(brush==='mycelium'){
      world.wall[i]=0;
      world.vent[i]=0;
      if(world.fire.delete(i)){
        unmarkScenarioFire(i);
      }
      world.strings[i]=baseStringFor(Mode.MYCELIUM);
      world.doorTiles?.delete(i);
      if(world.doorField) world.doorField[i] = 0;
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
    place(x,y, ev);
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
    place(x,y, ev);
  });

  const endPointer = ()=>{
    isPointerDown=false;
    if(isPanning){
      isPanning=false;
      drawing=false;
      panStartClient=null;
      panStartOffset=null;
    }
    dragAgent = null;
    dragBrush = null;
    dragFactionKey = DEFAULT_FACTION_KEY;
  };

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  const getSettings = ()=>{
    let rngSeed = Number.NaN;
    if(scenarioSeedInput){
      const raw = (scenarioSeedInput.value ?? '').trim();
      if(raw !== ''){
        rngSeed = Number.parseInt(raw, 10);
      }
      if(Number.isNaN(rngSeed)){
        const dataSeed = scenarioSeedInput.dataset?.seed;
        if(dataSeed){
          rngSeed = Number.parseInt(dataSeed, 10);
        }
      }
    }
    if(Number.isNaN(rngSeed) && typeof document !== 'undefined' && document.body?.dataset?.scenarioSeed){
      rngSeed = Number.parseInt(document.body.dataset.scenarioSeed, 10);
    }
    if(Number.isNaN(rngSeed) && typeof window !== 'undefined' && window.simScenarioSeed != null){
      const value = typeof window.simScenarioSeed === 'number' ? window.simScenarioSeed : parseInt(window.simScenarioSeed, 10);
      rngSeed = Number.isNaN(Number(value)) ? rngSeed : Number(value);
    }
    if(Number.isNaN(rngSeed)){
      rngSeed = getWorldSeed();
    }
    rngSeed = Number.isFinite(rngSeed) ? (rngSeed >>> 0) : (getWorldSeed() >>> 0);

    return {
      dHeat: parseFloat(dHeat?.value ?? '0.18'),
      dO2: parseFloat(dO2?.value ?? '0.10'),
      o2Base: parseFloat(o2Base?.value ?? '0.21'),
      o2Cut: parseFloat(o2Cut?.value ?? '0.16'),
      rngSeed,
      scenarioSeed: rngSeed,
    };
  };

  function updateMetrics({ reset=false, diagnostics }={}){
    if(reset){
      metricsState.prevO2Sum = null;
      metricsState.prevFireSum = null;
      metricsState.aggregates.modeCounts = new Map();
      metricsState.aggregates.avgAmplitude = 0;
      metricsState.aggregates.avgTension = 0;
      metricsState.aggregates.heatAverage = 0;
      metricsState.aggregates.fireIntensity = 0;
      metricsState.aggregates.stuckAgents = 0;
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
      if(mStuckAgents) mStuckAgents.textContent = '—';
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
      if(isFactoryMode(S.mode)) continue;
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
    if(mStuckAgents) mStuckAgents.textContent = String(diagnostics.stuckAgents ?? 0);
    metricsState.aggregates.stuckAgents = diagnostics.stuckAgents ?? 0;
  }
    if(simulation && typeof simulation.drainScenarioDiagnostics === 'function'){
      const events = simulation.drainScenarioDiagnostics();
      if(events.length){
        events.forEach(event => scenarioDiagStore.record(event));
        if(scenarioDiagVisible) renderScenarioDiagnostics();
      }
    }
    updateHistoryUI();
    updateFactoryStatusUI();
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
    clearSpawnStatus();
    applyPauseState(false);
    setRecorderButtonState(debugConfig.enableRecorder);
    if(simulation && typeof simulation.setRecorderEnabled === 'function'){
      simulation.setRecorderEnabled(debugConfig.enableRecorder);
    }
    if(scenarioLoadBtn){
      scenarioLoadBtn.disabled = scenarioManifestEntries.length === 0;
    }
    if(scenarioManifestEntries.length){
      showScenarioStatus('Select a scenario to load.', 'info');
    }
    updateHistoryUI();
    if(spawnCalmABtn && FACTIONS[0]){
      spawnCalmABtn.textContent = `🙂 NPC Calm ${FACTIONS[0].key}`;
      spawnCalmABtn.onclick = () => handleSpawnResult(simulation.spawnNPC(Mode.CALM, FACTIONS[0].key), { mode: Mode.CALM, faction: FACTIONS[0] });
    }
    if(spawnCalmBBtn && FACTIONS[1]){
      spawnCalmBBtn.textContent = `🙂 NPC Calm ${FACTIONS[1].key}`;
      spawnCalmBBtn.onclick = () => handleSpawnResult(simulation.spawnNPC(Mode.CALM, FACTIONS[1].key), { mode: Mode.CALM, faction: FACTIONS[1] });
    } else if(spawnCalmBBtn){
      spawnCalmBBtn.style.display = 'none';
    }
    if(spawnCalmCBtn && FACTIONS[2]){
      spawnCalmCBtn.textContent = `🙂 NPC Calm ${FACTIONS[2].key}`;
      spawnCalmCBtn.onclick = () => handleSpawnResult(simulation.spawnNPC(Mode.CALM, FACTIONS[2].key), { mode: Mode.CALM, faction: FACTIONS[2] });
    } else if(spawnCalmCBtn){
      spawnCalmCBtn.style.display = 'none';
    }
    if(spawnPanicABtn && FACTIONS[0]){
      spawnPanicABtn.textContent = `😱 NPC Panic ${FACTIONS[0].key}`;
      spawnPanicABtn.onclick = () => handleSpawnResult(simulation.spawnNPC(Mode.PANIC, FACTIONS[0].key), { mode: Mode.PANIC, faction: FACTIONS[0] });
    }
    if(spawnPanicBBtn && FACTIONS[1]){
      spawnPanicBBtn.textContent = `😱 NPC Panic ${FACTIONS[1].key}`;
      spawnPanicBBtn.onclick = () => handleSpawnResult(simulation.spawnNPC(Mode.PANIC, FACTIONS[1].key), { mode: Mode.PANIC, faction: FACTIONS[1] });
    } else if(spawnPanicBBtn){
      spawnPanicBBtn.style.display = 'none';
    }
    if(spawnMedicBtn){
      spawnMedicBtn.onclick = ()=>{
        handleSpawnResult(simulation.spawnNPC(Mode.MEDIC), { mode: Mode.MEDIC });
      };
    }
    if(sparkBtn){
      sparkBtn.onclick = ()=> simulation.randomFires(50);
    }
    if(clearBtn){
      clearBtn.onclick = ()=>{
        const settings = getSettings();
        simulation.resetWorld(settings.o2Base, settings);
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
  if(scenarioRefreshBtn) scenarioRefreshBtn.addEventListener('click', ()=> refreshScenarioManifest(true));
  if(scenarioLoadBtn) scenarioLoadBtn.addEventListener('click', ()=> handleScenarioLoad());
  if(scenarioSelect) scenarioSelect.addEventListener('change', ()=>{
    const entry = getSelectedScenarioEntry();
    if(entry){
      showScenarioStatus(`Ready to load ${entry.name}`, 'info');
    } else {
      showScenarioStatus('', 'info');
    }
  });
  if(scenarioDiagToggle) scenarioDiagToggle.addEventListener('click', ()=> toggleScenarioDiagPanel());
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
  refreshScenarioManifest(false);

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
