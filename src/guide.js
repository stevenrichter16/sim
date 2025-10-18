import { FACTIONS, factionAffinity } from './factions.js';
import { getPresenceCos, getPresenceSin, factionSafePhases, MEMORY_BUCKETS } from './memory.js';
import { clamp01 } from './constants.js';

const startTourButton = document.getElementById('startTour');
const guideContent = document.getElementById('guideContent');
const tocLinks = Array.from(document.querySelectorAll('.guide-toc a'));

function scrollToSection(hash){
  const target = document.querySelector(hash);
  if(!target) return;
  target.scrollIntoView({ behavior:'smooth', block:'start' });
}

if(startTourButton){
  startTourButton.addEventListener('click', ()=>{
    scrollToSection('#presence');
  });
}

tocLinks.forEach(link=>{
  link.addEventListener('click', (ev)=>{
    ev.preventDefault();
    scrollToSection(link.getAttribute('href'));
  });
});

// Placeholder hooks for future interactive demos
export function registerDemo(id, factory){
  const mount = document.querySelector(`.demo-placeholder[data-demo="${id}"]`);
  if(!mount) return;
  factory(mount);
}

// Example stub usage (to be replaced with real demos)
registerDemo('dominance', createDominanceDemo);
registerDemo('presence', createPresenceDemo);
registerDemo('presence-accumulation', createPresenceAccumulationDemo);
registerDemo('safe-phases', createSafePhaseTable);
registerDemo('frontier', (mount)=>{
  mount.textContent = 'Frontier visualization placeholder.';
});
registerDemo('frontier-debugger', createFrontierDebuggerDemo);

function createDominanceDemo(mount){
  mount.classList.add('dominance-demo');
  const cos = getPresenceCos();
  const sin = getPresenceSin();
  const defaultSupports = FACTIONS.map((_, idx)=>{
    if(idx === 0) return 0.6;
    if(idx === 1) return -0.35;
    return 0;
  });

  const escapeTooltip = (text)=> text.replace(/"/g, '&quot;');
  const makeTooltip = (text)=> `<span class="dominance-demo__tooltip" tabindex="0" role="note" aria-label="${escapeTooltip(text)}" data-tooltip="${escapeTooltip(text)}">?</span>`;

  const factionCards = FACTIONS.map((faction, idx)=>{
    const support = defaultSupports[idx] ?? 0;
    const phaseRad = factionSafePhases[idx] ?? 0;
    const phaseDeg = phaseRad * (180 / Math.PI);
    return `
      <div class="dominance-demo__faction" data-faction-index="${idx}">
        <div class="dominance-demo__faction-header">
          <span class="dominance-demo__swatch" style="background:${faction.color}"></span>
          <span class="dominance-demo__name">${faction.key}</span>
          <span class="dominance-demo__status" data-role="status">Neutral</span>
          ${makeTooltip('Shows whether this faction is reinforcing the tile (boosts) or pushing against it (opposes).')}
        </div>
        <div class="dominance-demo__phase">
          Phase: <code>${phaseRad.toFixed(3)} rad</code> (${phaseDeg.toFixed(1)}°)
          ${makeTooltip('Safe-phase angle for this faction. Sliders add support along this direction on the unit circle.')}
        </div>
        <label class="dominance-demo__slider">
          <input type="range" min="-1" max="1" step="0.05" value="${support}" data-role="supportSlider" />
          <span class="dominance-demo__slider-value" data-role="supportValue">${support.toFixed(2)}</span>
          ${makeTooltip('Adjust this faction’s local presence contribution. Positive values align with the faction’s safe phase; negative values oppose it.')}
        </label>
        <div class="dominance-demo__metric">Projection: <code data-role="projection">0.000</code> ${makeTooltip('Dot product between the combined presence vector and this faction’s safe-phase basis.')}</div>
        <div class="dominance-demo__share-wrap">
          <div class="dominance-demo__share-track">
            <div class="dominance-demo__share-bar" data-role="shareBar"></div>
          </div>
          <span class="dominance-demo__share-label" data-role="shareLabel">—</span>
          ${makeTooltip('Share of the positive projection sum contributed by this faction. Only positive projections count toward control.')}
        </div>
        <div class="dominance-demo__details" data-role="details">
          <button type="button" class="dominance-demo__details-toggle" data-role="detailsToggle" aria-expanded="false">
            Show math breakdown
          </button>
          <div class="dominance-demo__details-body" data-role="detailsBody" hidden>
            <div class="dominance-demo__wall-note" data-role="wallNote" hidden>Wall tiles clamp presence to zero after all contributions apply.</div>
            <ol class="dominance-demo__steps">
              <li class="dominance-demo__step" data-role="step1"></li>
              <li class="dominance-demo__step" data-role="step2"></li>
              <li class="dominance-demo__step" data-role="step3"></li>
            </ol>
            <div class="dominance-demo__vector-card">
              <svg viewBox="0 0 120 120" class="dominance-demo__vector" data-role="vectorSvg" aria-label="Vector diagram">
                <defs>
                  <marker id="dominanceArrowHead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L6,3 L0,6 Z" fill="#f0f6ff"></path>
                  </marker>
                </defs>
                <circle cx="60" cy="60" r="44" class="dominance-demo__vector-circle"></circle>
                <line x1="16" y1="60" x2="104" y2="60" class="dominance-demo__axis"></line>
                <line x1="60" y1="16" x2="60" y2="104" class="dominance-demo__axis"></line>
                <line class="dominance-demo__vector-line dominance-demo__vector-line--unit" data-role="vectorUnitLine" x1="60" y1="60" x2="60" y2="60"></line>
                <circle class="dominance-demo__vector-head dominance-demo__vector-head--unit" data-role="vectorUnitHead" cx="60" cy="60" r="0"></circle>
                <line class="dominance-demo__vector-line dominance-demo__vector-line--support" data-role="vectorSupportLine" x1="60" y1="60" x2="60" y2="60"></line>
                <circle class="dominance-demo__vector-head dominance-demo__vector-head--support" data-role="vectorSupportHead" cx="60" cy="60" r="0"></circle>
                <line class="dominance-demo__vector-line dominance-demo__vector-line--total" data-role="vectorTotalLine" x1="60" y1="60" x2="60" y2="60"></line>
                <circle class="dominance-demo__vector-head dominance-demo__vector-head--total" data-role="vectorTotalHead" cx="60" cy="60" r="0"></circle>
              </svg>
              <div class="dominance-demo__vector-legend">
                <span class="dominance-demo__legend-item dominance-demo__legend-item--unit">Unit phase</span>
                <span class="dominance-demo__legend-item dominance-demo__legend-item--support">Slider contribution</span>
                <span class="dominance-demo__legend-item dominance-demo__legend-item--total">Effective total</span>
              </div>
            </div>
            <table class="dominance-demo__math-table">
              <tbody>
                <tr>
                  <th>Support slider</th>
                  <td data-role="supportDisplay"></td>
                  <td class="dominance-demo__math-note">Demo-only scalar standing in for deposits like <code>PRESENCE_DEPOSIT</code> in <code>Agent._doStep</code>.</td>
                </tr>
                <tr>
                  <th>Safe-phase basis</th>
                  <td data-role="basisDisplay"></td>
                  <td class="dominance-demo__math-note">Per-faction cosine/sine from <code>factionSafePhases</code> (<code>memory.js</code>).</td>
                </tr>
                <tr>
                  <th>Δ presence contribution</th>
                  <td data-role="deltaDisplay"></td>
                  <td class="dominance-demo__math-note">Support × basis ⇒ the <code>px += support*cos</code>, <code>py += support*sin</code> lines in the demo and <code>Agent._doStep</code>.</td>
                </tr>
                <tr>
                  <th>Other sources + external offsets</th>
                  <td data-role="baseDisplay"></td>
                  <td class="dominance-demo__math-note">Sums of other faction sliders plus the “External X/Y” offsets (think memory diffusion, reinforcement bleed).</td>
                </tr>
                <tr>
                  <th>Total (raw)</th>
                  <td data-role="totalRawDisplay"></td>
                  <td class="dominance-demo__math-note">Raw <code>presenceX/Y</code> before wall checks, matching the value in <code>updatePresenceControl()</code> prior to wall clamp.</td>
                </tr>
                <tr>
                  <th>Total (after wall)</th>
                  <td data-role="totalEffectiveDisplay"></td>
                  <td class="dominance-demo__math-note"><code>updatePresenceControl()</code> sets presence to zero when the tile is a wall.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }).join('');

  mount.innerHTML = `
    <div class="dominance-demo__summary">
      <div class="dominance-demo__summary-item">Best Faction: <strong data-role="bestName">None</strong> ${makeTooltip('Faction with the largest positive projection on this tile.')}</div>
      <div class="dominance-demo__summary-item">Control: <strong data-role="control">0.00</strong> ${makeTooltip('Confidence value stored in world.controlLevel. Computed as best projection divided by the sum of all positive projections.')}</div>
      <div class="dominance-demo__summary-item">Best Projection: <code data-role="bestProjection">0.000</code> ${makeTooltip('Magnitude of the dominant faction’s positive projection (before normalization).')}</div>
      <div class="dominance-demo__summary-item">Positive Sum: <code data-role="sumPositive">0.000</code> ${makeTooltip('Sum of all positive projections. This is the denominator for the control calculation.')}</div>
      <div class="dominance-demo__summary-item">Opposition Sum: <code data-role="sumNegative">0.000</code> ${makeTooltip('Total of negative projections. Larger magnitude means strong opposition pushing the presence vector away from rival phases.')}</div>
    </div>
    <div class="dominance-demo__vectors">
      <div>presenceX: <code data-role="presenceX">0.00</code> ${makeTooltip('Combined X component after adding individual faction support and external offset.')}</div>
      <div>presenceY: <code data-role="presenceY">0.00</code> ${makeTooltip('Combined Y component after adding individual faction support and external offset.')}</div>
      <div>|v|: <code data-role="magnitude">0.00</code> ${makeTooltip('Length of the presence vector. Larger magnitude means stronger overall influence on the tile.')}</div>
    </div>
    <div class="dominance-demo__offsets">
      <label>External X ${makeTooltip('Represents influence not captured by the faction sliders: diffusion, memory deposits, or lingering presence.')}
        <input type="range" min="-1.5" max="1.5" step="0.05" value="0" data-role="offsetX" />
        <span class="dominance-demo__offset-value" data-role="offsetXValue">0.00</span>
      </label>
      <label>External Y ${makeTooltip('Second axis for outside influence. Adjust both to tilt the net presence vector in any direction.')}
        <input type="range" min="-1.5" max="1.5" step="0.05" value="0" data-role="offsetY" />
        <span class="dominance-demo__offset-value" data-role="offsetYValue">0.00</span>
      </label>
      <label class="dominance-demo__checkbox">Wall tile ${makeTooltip('When checked, the tile acts like a wall: presence is zeroed and no faction can dominate.')}
        <input type="checkbox" data-role="wall" />
      </label>
      <button class="btn" type="button" data-role="reset">Reset ${makeTooltip('Restore default slider values and clear external offsets.')}</button>
      <label class="dominance-demo__checkbox dominance-demo__checkbox--details">
        <input type="checkbox" data-role="detailsGlobal" /> Show detailed math for all
      </label>
    </div>
    <div class="dominance-demo__faction-list" data-role="factionList">
      ${factionCards}
    </div>
  `;

  const bestNameEl = mount.querySelector('[data-role="bestName"]');
  const controlEl = mount.querySelector('[data-role="control"]');
  const bestProjectionEl = mount.querySelector('[data-role="bestProjection"]');
  const sumPositiveEl = mount.querySelector('[data-role="sumPositive"]');
  const sumNegativeEl = mount.querySelector('[data-role="sumNegative"]');
  const presenceXEl = mount.querySelector('[data-role="presenceX"]');
  const presenceYEl = mount.querySelector('[data-role="presenceY"]');
  const magnitudeEl = mount.querySelector('[data-role="magnitude"]');
  const offsetXInput = mount.querySelector('[data-role="offsetX"]');
  const offsetYInput = mount.querySelector('[data-role="offsetY"]');
  const offsetXValueEl = mount.querySelector('[data-role="offsetXValue"]');
  const offsetYValueEl = mount.querySelector('[data-role="offsetYValue"]');
  const wallToggle = mount.querySelector('[data-role="wall"]');
  const resetBtn = mount.querySelector('[data-role="reset"]');
  const detailsGlobalToggle = mount.querySelector('[data-role="detailsGlobal"]');

  const factionRows = Array.from(mount.querySelectorAll('.dominance-demo__faction')).map((el)=>{
    const idx = Number(el.getAttribute('data-faction-index'));
    return {
      index: idx,
      faction: FACTIONS[idx],
      root: el,
      slider: el.querySelector('[data-role="supportSlider"]'),
      supportValue: el.querySelector('[data-role="supportValue"]'),
      projection: el.querySelector('[data-role="projection"]'),
      shareBar: el.querySelector('[data-role="shareBar"]'),
      shareLabel: el.querySelector('[data-role="shareLabel"]'),
      status: el.querySelector('[data-role="status"]'),
      details: el.querySelector('[data-role="details"]'),
      detailsToggle: el.querySelector('[data-role="detailsToggle"]'),
      detailsBody: el.querySelector('[data-role="detailsBody"]'),
      wallNote: el.querySelector('[data-role="wallNote"]'),
      step1: el.querySelector('[data-role="step1"]'),
      step2: el.querySelector('[data-role="step2"]'),
      step3: el.querySelector('[data-role="step3"]'),
      supportDisplay: el.querySelector('[data-role="supportDisplay"]'),
      basisDisplay: el.querySelector('[data-role="basisDisplay"]'),
      deltaDisplay: el.querySelector('[data-role="deltaDisplay"]'),
      baseDisplay: el.querySelector('[data-role="baseDisplay"]'),
      totalRawDisplay: el.querySelector('[data-role="totalRawDisplay"]'),
      totalEffectiveDisplay: el.querySelector('[data-role="totalEffectiveDisplay"]'),
      vectorSvg: el.querySelector('[data-role="vectorSvg"]'),
      vectorUnitLine: el.querySelector('[data-role="vectorUnitLine"]'),
      vectorUnitHead: el.querySelector('[data-role="vectorUnitHead"]'),
      vectorSupportLine: el.querySelector('[data-role="vectorSupportLine"]'),
      vectorSupportHead: el.querySelector('[data-role="vectorSupportHead"]'),
      vectorTotalLine: el.querySelector('[data-role="vectorTotalLine"]'),
      vectorTotalHead: el.querySelector('[data-role="vectorTotalHead"]'),
      expanded: false,
    };
  });

  factionRows.forEach(row => {
    row.shareBar.style.background = row.faction.color;
  });

  let globalDetails = false;

  function syncRowDetails(row){
    const isOpen = globalDetails || row.expanded;
    if(row.detailsBody){
      row.detailsBody.hidden = !isOpen;
    }
    if(row.detailsToggle){
      row.detailsToggle.setAttribute('aria-expanded', String(isOpen));
      row.detailsToggle.classList.toggle('is-active', isOpen);
      if(globalDetails){
        row.detailsToggle.setAttribute('disabled', 'true');
      } else {
        row.detailsToggle.removeAttribute('disabled');
      }
    }
  }

  function applyGlobalDetails(state){
    globalDetails = !!state;
    mount.classList.toggle('details-enabled', globalDetails);
    factionRows.forEach(row => syncRowDetails(row));
  }

  function reset(){
    offsetXInput.value = '0';
    offsetYInput.value = '0';
    if(wallToggle) wallToggle.checked = false;
    if(detailsGlobalToggle) detailsGlobalToggle.checked = false;
    applyGlobalDetails(false);
    factionRows.forEach(row => { row.expanded = false; syncRowDetails(row); });
    factionRows.forEach(row => {
      const defaultValue = defaultSupports[row.index] ?? 0;
      row.slider.value = String(defaultValue);
    });
    update();
  }

  function drawVector(lineEl, headEl, x, y, { maxMagnitude = 1.5 } = {}){
    if(!lineEl || !headEl) return;
    const center = 60;
    const radius = 44;
    const length = Math.hypot(x, y);
    const clamped = Math.min(maxMagnitude, length || 0);
    const scale = length === 0 ? 0 : (clamped / length) * (radius / maxMagnitude);
    const dx = x * scale;
    const dy = y * scale;
    const x2 = center + dx;
    const y2 = center - dy;
    lineEl.setAttribute('x1', center);
    lineEl.setAttribute('y1', center);
    lineEl.setAttribute('x2', x2);
    lineEl.setAttribute('y2', y2);
    headEl.setAttribute('cx', x2);
    headEl.setAttribute('cy', y2);
    headEl.setAttribute('r', clamped > 0 ? 3.5 : 0);
  }

  function update(){
    const wall = wallToggle?.checked ?? false;
    const offsetX = parseFloat(offsetXInput.value);
    const offsetY = parseFloat(offsetYInput.value);
    offsetXValueEl.textContent = offsetX.toFixed(2);
    offsetYValueEl.textContent = offsetY.toFixed(2);

    const contributions = factionRows.map(row => {
      const support = parseFloat(row.slider.value);
      row.supportValue.textContent = support.toFixed(2);
      const deltaX = support * cos[row.index];
      const deltaY = support * sin[row.index];
      return { row, support, deltaX, deltaY };
    });

    let pxRaw = offsetX;
    let pyRaw = offsetY;
    contributions.forEach(c => {
      pxRaw += c.deltaX;
      pyRaw += c.deltaY;
    });

    const pxEffective = wall ? 0 : pxRaw;
    const pyEffective = wall ? 0 : pyRaw;

    presenceXEl.textContent = pxEffective.toFixed(2);
    presenceYEl.textContent = pyEffective.toFixed(2);
    magnitudeEl.textContent = Math.hypot(pxEffective, pyEffective).toFixed(2);

    const projections = factionRows.map((row, idx) => pxEffective * cos[idx] + pyEffective * sin[idx]);
    let bestIdx = -1;
    let bestProj = 0;
    let sumPos = 0;
    let sumNeg = 0;
    projections.forEach((proj, idx)=>{
      if(proj > 0){
        sumPos += proj;
        if(proj > bestProj){
          bestProj = proj;
          bestIdx = idx;
        }
      } else if(proj < 0){
        sumNeg += proj;
      }
    });

    const control = (bestIdx >= 0 && sumPos > 0) ? clamp01(bestProj / sumPos) : 0;
    const hasDominant = bestIdx >= 0 && sumPos > 0;

    bestNameEl.textContent = hasDominant ? (FACTIONS[bestIdx]?.key ?? `Faction ${bestIdx}`) : 'None';
    controlEl.textContent = control.toFixed(2);
    bestProjectionEl.textContent = hasDominant ? bestProj.toFixed(3) : '0.000';
    sumPositiveEl.textContent = sumPos.toFixed(3);
    sumNegativeEl.textContent = sumNeg.toFixed(3);

    projections.forEach((proj, idx)=>{
      const row = factionRows[idx];
      const contribution = contributions[idx];
      const deltaX = contribution?.deltaX ?? 0;
      const deltaY = contribution?.deltaY ?? 0;
      const support = contribution?.support ?? 0;
      const cosVal = cos[row.index];
      const sinVal = sin[row.index];
      const othersX = pxRaw - deltaX;
      const othersY = pyRaw - deltaY;
      if(row.supportDisplay){
        row.supportDisplay.textContent = support.toFixed(2);
      }
      if(row.basisDisplay){
        row.basisDisplay.textContent = `(${cosVal.toFixed(3)}, ${sinVal.toFixed(3)})`;
      }
      if(row.deltaDisplay){
        row.deltaDisplay.textContent = `(${deltaX.toFixed(3)}, ${deltaY.toFixed(3)})`;
      }
      if(row.baseDisplay){
        row.baseDisplay.textContent = `(${othersX.toFixed(3)}, ${othersY.toFixed(3)})`;
      }
      if(row.totalRawDisplay){
        row.totalRawDisplay.textContent = `(${pxRaw.toFixed(3)}, ${pyRaw.toFixed(3)})`;
      }
      if(row.totalEffectiveDisplay){
        row.totalEffectiveDisplay.textContent = `(${pxEffective.toFixed(3)}, ${pyEffective.toFixed(3)})`;
      }
      if(row.wallNote){
        row.wallNote.hidden = !wall;
      }
      if(row.step1){
        row.step1.textContent = `1. Slider value: support = ${support.toFixed(2)}`;
      }
      if(row.step2){
        row.step2.textContent = `2. Scale by phase (${cosVal.toFixed(3)}, ${sinVal.toFixed(3)}) ⇒ Δ = (${deltaX.toFixed(3)}, ${deltaY.toFixed(3)})`;
      }
      if(row.step3){
        if(wall){
          row.step3.textContent = `3. Combine with base (${othersX.toFixed(3)}, ${othersY.toFixed(3)}) ⇒ raw totals (${pxRaw.toFixed(3)}, ${pyRaw.toFixed(3)}) → wall clamps to (0.000, 0.000)`;
        } else {
          row.step3.textContent = `3. Combine with base (${othersX.toFixed(3)}, ${othersY.toFixed(3)}) ⇒ totals (${pxRaw.toFixed(3)}, ${pyRaw.toFixed(3)})`;
        }
      }
      drawVector(row.vectorUnitLine, row.vectorUnitHead, cosVal, sinVal, { maxMagnitude: 1.5 });
      drawVector(row.vectorSupportLine, row.vectorSupportHead, deltaX, deltaY, { maxMagnitude: 1.5 });
      drawVector(row.vectorTotalLine, row.vectorTotalHead, pxEffective, pyEffective, { maxMagnitude: 1.5 });
      row.projection.textContent = proj.toFixed(3);
      const share = (proj > 0 && sumPos > 0) ? proj / sumPos : 0;
      row.shareBar.style.width = `${Math.max(0, Math.min(100, share * 100))}%`;
      row.shareBar.style.opacity = proj > 0 && sumPos > 0 ? 1 : 0;
      row.shareLabel.textContent = proj > 0 && sumPos > 0 ? `${Math.round(share * 100)}%` : '—';
      row.root.classList.toggle('is-dominant', hasDominant && idx === bestIdx);
      row.root.classList.toggle('is-opposing', proj < 0);
      if(row.status){
        row.status.textContent = proj > 0 ? 'Boosts' : proj < 0 ? 'Opposes' : 'Neutral';
      }
    });
  }

  factionRows.forEach(row => {
    row.slider.addEventListener('input', update);
    if(row.detailsToggle){
      row.detailsToggle.addEventListener('click', ()=>{
        if(globalDetails) return;
        row.expanded = !row.expanded;
        syncRowDetails(row);
      });
    }
  });
  offsetXInput.addEventListener('input', update);
  offsetYInput.addEventListener('input', update);
  wallToggle?.addEventListener('change', update);
  resetBtn?.addEventListener('click', reset);
  detailsGlobalToggle?.addEventListener('change', ()=>{
    applyGlobalDetails(detailsGlobalToggle.checked);
  });

  applyGlobalDetails(false);
  update();
}

function createFrontierDebuggerDemo(mount){
  mount.classList.add('frontier-debugger');
  const FRONTIER_MIN_CONTEST = 0.25;
  const FRONTIER_DEPOSIT = 0.02;
  const codeLines = [
    'const FRONTIER_MIN_CONTEST = 0.25;',
    'const FRONTIER_DEPOSIT = 0.02;',
    'for (let i = 0; i < tiles; i++) {',
    '  const dom = dominantFaction[i];',
    '  const ctrl = controlLevel[i];',
    '  const contest = 1 - Math.abs(2 * ctrl - 1);',
    '  if (contest > FRONTIER_MIN_CONTEST) {',
    '    let hasFriendly = false;',
    '    let hasHostile = false;',
    '    for (const neighbor of neighbors(i)) {',
    '      if (isEnemy(dom, dominantFaction[neighbor])) hasHostile = true;',
    '      if (isAlly(dom, dominantFaction[neighbor])) hasFriendly = true;',
    '    }',
    '    if (hasFriendly && hasHostile) {',
    '      frontier[dom][i] += contest * FRONTIER_DEPOSIT;',
    '    }',
    '  }',
    '}',
  ];

  const layout = document.createElement('div');
  layout.className = 'frontier-debugger__layout';

  let world = buildSampleWorld();
  const grid = createDebuggerGrid(world);
  const hoverNames = ['FRONTIER_MIN_CONTEST','FRONTIER_DEPOSIT','tiles','i','dom','ctrl','contest','passesContest','neighbor','friendly','hostile','hasFriendly','hasHostile','frontierDeposit','frontierValue','frontier'];
  const { codeView, syncCodeVar } = createCodeView(codeLines, hoverNames);
  const vars = createVarsView({
    FRONTIER_MIN_CONTEST: FRONTIER_MIN_CONTEST.toFixed(2),
    FRONTIER_DEPOSIT: FRONTIER_DEPOSIT.toFixed(2),
    i: '0',
    dom: '—',
    ctrl: '0.00',
    contest: '0.00',
    passesContest: '—',
    neighbor: '—',
    friendly: 'false',
    hostile: 'false',
    hasFriendly: 'false',
    hasHostile: 'false',
    frontierDeposit: '0.000',
    frontierValue: '0.000',
    frontier: '0.000',
  }, syncCodeVar);

  const controls = document.createElement('div');
  controls.className = 'frontier-debugger__controls';
  const nextBtn = makeButton('Next Line ▶');
  const playBtn = makeButton('Auto Play ⏩');
  const resetBtn = makeButton('Reset ⟳');
  const toggleFrontierBtn = makeButton('Show Frontier Field');
  toggleFrontierBtn.dataset.active = 'false';
  controls.append(nextBtn, playBtn, resetBtn, toggleFrontierBtn);

  const gridPanel = document.createElement('div');
  gridPanel.className = 'frontier-debugger__grid-panel';
  const gridTitle = document.createElement('h3');
  gridTitle.textContent = 'Tile Grid';
  gridPanel.append(gridTitle, grid.element);

  const codePanel = document.createElement('div');
  codePanel.className = 'frontier-debugger__code-panel';
  const codeTitle = document.createElement('h3');
  codeTitle.textContent = 'updateFrontierFields excerpt';
  codePanel.append(codeTitle, codeView);

  const varsPanel = document.createElement('div');
  varsPanel.className = 'frontier-debugger__vars-panel';
  const varsTitle = document.createElement('h3');
  varsTitle.textContent = 'Variables';
  varsPanel.append(varsTitle, vars.element);

  const rightColumn = document.createElement('div');
  rightColumn.className = 'frontier-debugger__sidebar';
  rightColumn.append(codePanel, varsPanel, controls);

  layout.append(gridPanel, rightColumn);
  mount.append(layout);
  syncCodeVar('tiles', world.size.toString());

  const state = {
    currentLine: 0,
    tileIndex: 0,
    neighborList: [],
    neighborPointer: 0,
    neighborInitialized: false,
    friendlySet: new Set(),
    hostileSet: new Set(),
    currentNeighbor: null,
    friendly: false,
    hostile: false,
    contest: 0,
    playing: false,
    timer: null,
    skipConstants: false,
  };

  const lineHandlers = {
    0(){
      highlightLine(0);
      return;
    },
    1(){
      highlightLine(1);
      return;
    },
    2(){
      if(state.tileIndex >= world.size){
        stopAutoplay();
        state.tileIndex = 0;
      }
      beginTile(state.tileIndex);
      return;
    },
    3(){
      const dom = world.dominantFaction[state.tileIndex];
      vars.update('dom', describeFaction(dom));
      return;
    },
    4(){
      const ctrl = world.controlLevel[state.tileIndex] ?? 0;
      vars.update('ctrl', ctrl.toFixed(2));
      return;
    },
    5(){
      const ctrl = world.controlLevel[state.tileIndex] ?? 0;
      const contest = 1 - Math.abs(2 * ctrl - 1);
      state.contest = contest;
      vars.update('contest', contest.toFixed(2));
      return;
    },
    6(){
      const passes = state.contest > FRONTIER_MIN_CONTEST;
      vars.update('passesContest', passes ? 'true' : 'false');
      if(!passes){
        vars.update('frontierDeposit', '0.000');
        const frontierVal = currentFrontierValue(state.tileIndex).toFixed(3);
        vars.update('frontierValue', frontierVal);
        vars.update('frontier', frontierVal);
        state.currentNeighbor = null;
        renderGrid();
        return 17;
      }
      return;
    },
    7(){
      state.friendly = false;
      state.hostile = false;
      vars.update('friendly', 'false');
      vars.update('hostile', 'false');
      vars.update('hasFriendly', 'false');
      vars.update('hasHostile', 'false');
      return;
    },
    8(){
      state.hostile = false;
      vars.update('hostile', 'false');
      vars.update('hasHostile', 'false');
      return;
    },
    9(){
    if(!state.neighborInitialized){
      state.neighborList = listNeighbors(state.tileIndex);
      state.neighborPointer = 0;
      state.neighborInitialized = true;
    }
    if(state.neighborPointer >= state.neighborList.length){
      vars.update('neighbor', '—');
      state.currentNeighbor = null;
      renderGrid();
      return 13;
    }
    state.currentNeighbor = state.neighborList[state.neighborPointer];
    vars.update('neighbor', describeTile(state.currentNeighbor));
    renderGrid();
    return;
    },
    10(){
      evaluateNeighborHostility();
      return;
    },
    11(){
      evaluateNeighborFriendliness();
      state.neighborPointer += 1;
      if(state.neighborPointer < state.neighborList.length){
        return 9;
      }
      state.currentNeighbor = null;
      vars.update('neighbor', '—');
      renderGrid();
      return;
    },
    13(){
      const shouldDeposit = state.friendly && state.hostile;
      vars.update('friendly', state.friendly ? 'true' : 'false');
      vars.update('hostile', state.hostile ? 'true' : 'false');
      vars.update('hasFriendly', state.friendly ? 'true' : 'false');
      vars.update('hasHostile', state.hostile ? 'true' : 'false');
      if(!shouldDeposit){
        vars.update('frontierDeposit', '0.000');
        return 15;
      }
      return;
    },
    14(){
      const domId = world.dominantFaction[state.tileIndex];
      const shouldDeposit = state.friendly && state.hostile && domId >= 0;
      if(shouldDeposit){
        const deposit = clamp01(state.contest * FRONTIER_DEPOSIT);
        const field = world.frontierByFaction[domId];
        field[state.tileIndex] = clamp01((field[state.tileIndex] ?? 0) + deposit);
        vars.update('frontierDeposit', deposit.toFixed(3));
      }
      const frontierVal = currentFrontierValue(state.tileIndex).toFixed(3);
      vars.update('frontierValue', frontierVal);
      vars.update('frontier', frontierVal);
      renderGrid(true);
      return;
    },
    17(){
      state.tileIndex += 1;
      state.skipConstants = true;
      state.neighborInitialized = false;
      if(state.tileIndex >= world.size){
        stopAutoplay();
        state.tileIndex = 0;
        state.currentLine = 2;
        highlightLine(state.currentLine);
        return 2;
      }
      return 2;
    },
  };

  function highlightLine(index){
    const rows = codeView.querySelectorAll('div');
    rows.forEach((row, idx)=>{
      row.classList.toggle('is-active', idx === index);
    });
  }

  function beginTile(tileIndex){
    state.friendlySet.clear();
    state.hostileSet.clear();
    state.friendly = false;
    state.hostile = false;
    state.currentNeighbor = null;
    vars.update('i', tileIndex.toString());
    vars.update('dom', '—');
    vars.update('ctrl', '0.00');
    vars.update('contest', '0.00');
    vars.update('passesContest', '—');
    vars.update('neighbor', '—');
    vars.update('friendly', 'false');
    vars.update('hostile', 'false');
    vars.update('hasFriendly', 'false');
    vars.update('hasHostile', 'false');
    vars.update('frontierDeposit', '0.000');
    const frontierBase = currentFrontierValue(tileIndex).toFixed(3);
    vars.update('frontierValue', frontierBase);
    vars.update('frontier', frontierBase);
    state.neighborInitialized = false;
    renderGrid();
  }

  function listNeighbors(index){
    const coords = toCoords(index);
    const neighbors = [];
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    for(const [dx,dy] of dirs){
      const nx = coords.x + dx;
      const ny = coords.y + dy;
      if(nx < 0 || ny < 0 || nx >= world.W || ny >= world.H) continue;
      const nIndex = ny * world.W + nx;
      neighbors.push(nIndex);
    }
    return neighbors;
  }

  function evaluateNeighborHostility(){
    const dom = world.dominantFaction[state.tileIndex];
    if(dom < 0 || state.currentNeighbor == null) return;
    const neighborDom = world.dominantFaction[state.currentNeighbor];
    let hostile = false;
    if(neighborDom >= 0){
      const affinity = factionAffinity(dom, neighborDom);
      if(affinity < 0) hostile = true;
    }
    if(hostile){
      state.hostile = true;
      state.hostileSet.add(state.currentNeighbor);
    }
    vars.update('hostile', state.hostile ? 'true' : 'false');
    vars.update('hasHostile', state.hostile ? 'true' : 'false');
    renderGrid();
  }

  function evaluateNeighborFriendliness(){
    const dom = world.dominantFaction[state.tileIndex];
    if(dom < 0 || state.currentNeighbor == null) return;
    const neighborDom = world.dominantFaction[state.currentNeighbor];
    let friendly = false;
    if(neighborDom >= 0){
      const affinity = factionAffinity(dom, neighborDom);
      friendly = neighborDom === dom || affinity > 0;
    }
    if(friendly){
      state.friendly = true;
      state.friendlySet.add(state.currentNeighbor);
    }
    vars.update('friendly', state.friendly ? 'true' : 'false');
    vars.update('hasFriendly', state.friendly ? 'true' : 'false');
    renderGrid();
  }

  function currentFrontierValue(index){
    const domId = world.dominantFaction[index];
    if(domId < 0) return 0;
    return world.frontierByFaction[domId][index] ?? 0;
  }

  function step(){
    if(world.size === 0) return;
    if(state.tileIndex >= world.size){
      stopAutoplay();
      state.tileIndex = 0;
      state.currentLine = state.skipConstants ? 2 : 0;
    }
    highlightLine(state.currentLine);
    const handler = lineHandlers[state.currentLine];
    const jump = handler ? handler() : undefined;
    if(typeof jump === 'number'){
      state.currentLine = jump;
    } else {
      state.currentLine += 1;
    }
    if(state.skipConstants && state.currentLine < 2){
      state.currentLine = 2;
    }
    if(state.currentLine >= codeLines.length){
      state.currentLine = state.skipConstants ? 2 : 0;
    }
    highlightLine(state.currentLine);
  }

  function toggleAutoplay(){
    if(state.playing){
      stopAutoplay();
    } else {
      state.playing = true;
      playBtn.textContent = 'Pause ⏸';
      state.timer = setInterval(()=>{
        step();
      }, 900);
    }
  }

  function stopAutoplay(){
    if(state.timer){
      clearInterval(state.timer);
      state.timer = null;
    }
    if(state.playing){
      state.playing = false;
      playBtn.textContent = 'Auto Play ⏩';
    }
  }

  function resetDebugger(){
    stopAutoplay();
    world = buildSampleWorld();
    state.currentLine = 0;
    state.tileIndex = 0;
    state.skipConstants = false;
    state.neighborList = [];
    state.neighborPointer = 0;
    state.neighborInitialized = false;
    state.currentNeighbor = null;
    state.friendlySet.clear();
    state.hostileSet.clear();
    state.friendly = false;
    state.hostile = false;
    vars.update('FRONTIER_MIN_CONTEST', FRONTIER_MIN_CONTEST.toFixed(2));
    vars.update('FRONTIER_DEPOSIT', FRONTIER_DEPOSIT.toFixed(2));
    vars.update('i', '0');
    vars.update('dom', '—');
    vars.update('ctrl', '0.00');
    vars.update('contest', '0.00');
    vars.update('passesContest', '—');
    vars.update('neighbor', '—');
    vars.update('friendly', 'false');
    vars.update('hostile', 'false');
    vars.update('hasFriendly', 'false');
    vars.update('hasHostile', 'false');
    vars.update('frontierDeposit', '0.000');
    vars.update('frontierValue', '0.000');
    vars.update('frontier', '0.000');
    syncCodeVar('tiles', world.size.toString());
    syncCodeVar('hasFriendly', 'false');
    syncCodeVar('hasHostile', 'false');
    syncCodeVar('frontier', '0.000');
    grid.reload(world);
    renderGrid();
    highlightLine(state.currentLine);
  }

  function renderGrid(flashDeposit = false){
    const current = state.tileIndex;
    const neighborIndex = state.currentNeighbor;
    const showFrontier = toggleFrontierBtn.dataset.active === 'true';
    grid.cells.forEach((cellObj, idx)=>{
      const domId = world.dominantFaction[idx];
      const ctrl = world.controlLevel[idx] ?? 0;
      const frontierVal = currentFrontierValue(idx);
      cellObj.faction.textContent = describeFaction(domId);
      cellObj.control.textContent = ctrl.toFixed(2);
      cellObj.frontier.textContent = frontierVal.toFixed(3);
      cellObj.frontier.parentElement.classList.toggle('is-hidden', !showFrontier);
      cellObj.element.classList.toggle('is-current', idx === current);
      cellObj.element.classList.toggle('is-current-neighbor', idx === neighborIndex);
      cellObj.element.classList.toggle('is-friendly', state.friendlySet.has(idx));
      cellObj.element.classList.toggle('is-hostile', state.hostileSet.has(idx));
      cellObj.element.classList.toggle('has-frontier', frontierVal > 0.0001 && showFrontier);
      applyFactionStyle(cellObj.element, domId);
      if(flashDeposit && idx === current && frontierVal > 0){
        cellObj.element.classList.add('frontier-deposit');
        setTimeout(()=> cellObj.element.classList.remove('frontier-deposit'), 320);
      }
    });
  }

  function describeFaction(fid){
    if(fid == null || fid < 0) return 'Neutral (-1)';
    const faction = FACTIONS[fid];
    return faction ? `${faction.key} (${fid})` : `Faction ${fid}`;
  }

  function describeTile(idx){
    const { x, y } = toCoords(idx);
    const domId = world.dominantFaction[idx];
    const ctrl = world.controlLevel[idx] ?? 0;
    const factionStr = describeFaction(domId);
    return `(${x}, ${y}) – ${factionStr}, ctrl ${ctrl.toFixed(2)}`;
  }

  function toCoords(index){
    const x = index % world.W;
    const y = Math.floor(index / world.W);
    return { x, y };
  }

  function applyFactionStyle(el, fid){
    const base = fid >= 0 ? FACTIONS[fid]?.color ?? '#3a4764' : '#1f2735';
    const rgb = hexToRgb(base);
    const gradient = `linear-gradient(135deg, rgba(${rgb.r},${rgb.g},${rgb.b},0.35), rgba(${rgb.r},${rgb.g},${rgb.b},0.08))`;
    el.style.background = gradient;
    el.style.borderColor = `rgba(${rgb.r},${rgb.g},${rgb.b},0.4)`;
  }

  function createCodeView(lines, hoverList){
    const pre = document.createElement('pre');
    pre.className = 'frontier-debugger__code';
    const spansMap = new Map();
    const identifiers = hoverList && hoverList.length ? new RegExp(`\\b(${hoverList.join('|')})\\b`, 'g') : null;
    lines.forEach(line => {
      const row = document.createElement('div');
      if(identifiers){
        row.innerHTML = line.replace(identifiers, '<span class="frontier-debugger__code-var" data-var="$1">$1</span>');
      } else {
        row.textContent = line;
      }
      pre.append(row);
    });
    pre.querySelectorAll('[data-var]').forEach(span => {
      const name = span.getAttribute('data-var');
      if(!spansMap.has(name)) spansMap.set(name, []);
      spansMap.get(name).push(span);
    });
    function sync(name, value){
      const spans = spansMap.get(name);
      if(spans){
        spans.forEach(span => {
          span.setAttribute('title', `${name} = ${value}`);
        });
      }
    }
    return { codeView: pre, codeVarSpans: spansMap, syncCodeVar: sync };
  }

  function createVarsView(initial, onUpdate){
    const wrapper = document.createElement('div');
    wrapper.className = 'frontier-debugger__vars';
    const entries = new Map();
    Object.entries(initial).forEach(([key, value]) => {
      const row = document.createElement('div');
      row.className = 'frontier-debugger__var';
      row.innerHTML = `<strong>${key}</strong><span>${value}</span>`;
      wrapper.append(row);
      entries.set(key, row.querySelector('span'));
      if(onUpdate) onUpdate(key, value);
    });
    return {
      element: wrapper,
      update(key, value){
        if(!entries.has(key)){
          const row = document.createElement('div');
          row.className = 'frontier-debugger__var';
          row.innerHTML = `<strong>${key}</strong><span>${value}</span>`;
          wrapper.append(row);
          entries.set(key, row.querySelector('span'));
        } else {
          entries.get(key).textContent = value;
        }
        if(onUpdate) onUpdate(key, value);
      },
      get(key){
        const span = entries.get(key);
        return span ? parseFloat(span.textContent) : NaN;
      }
    };
  }

  function createDebuggerGrid(worldRef){
    const wrapper = document.createElement('div');
    wrapper.className = 'frontier-debugger__grid';
    wrapper.style.gridTemplateColumns = `repeat(${worldRef.W}, minmax(120px, 1fr))`;
    const cells = [];
    for(let y = 0; y < worldRef.H; y++){
      for(let x = 0; x < worldRef.W; x++){
        const idx = y * worldRef.W + x;
        const cell = document.createElement('div');
        cell.className = 'frontier-debugger__cell';
        const coord = document.createElement('div');
        coord.className = 'frontier-debugger__cell-coord';
        coord.textContent = `(${x}, ${y})`;
        const faction = document.createElement('div');
        faction.className = 'frontier-debugger__cell-faction';
        const control = document.createElement('div');
        control.className = 'frontier-debugger__cell-control';
        const frontier = document.createElement('div');
        frontier.className = 'frontier-debugger__cell-frontier';
        frontier.innerHTML = 'Frontier: <span>0.000</span>';
        cell.append(coord, faction, control, frontier);
        wrapper.append(cell);
        cells.push({ element: cell, faction, control, frontier: frontier.querySelector('span') });
      }
    }
    return {
      element: wrapper,
      cells,
      reload(newWorld){
        world = newWorld;
        wrapper.style.gridTemplateColumns = `repeat(${world.W}, minmax(120px, 1fr))`;
      }
    };
  }

  function makeButton(label){
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'frontier-debugger__btn';
    btn.textContent = label;
    return btn;
  }

  function buildSampleWorld(){
    const W = 4;
    const H = 3;
    const size = W * H;
    const dominantFaction = new Int16Array(size).fill(-1);
    const controlLevel = new Float32Array(size);
    const frontierByFaction = FACTIONS.map(()=> new Float32Array(size));

    function setTile(x, y, faction, control){
      const index = y * W + x;
      dominantFaction[index] = faction;
      controlLevel[index] = control;
    }

    const layout = [
      [ { f:0, c:0.82 }, { f:0, c:0.68 }, { f:1, c:0.63 }, { f:1, c:0.86 } ],
      [ { f:0, c:0.55 }, { f:0, c:0.51 }, { f:1, c:0.49 }, { f:1, c:0.66 } ],
      [ { f:0, c:0.81 }, { f:0, c:0.74 }, { f:1, c:0.72 }, { f:1, c:0.88 } ],
    ];

    layout.forEach((row, y)=>{
      row.forEach((tile, x)=>{
        setTile(x, y, tile.f, tile.c);
      });
    });

    return {
      W,
      H,
      size,
      dominantFaction,
      controlLevel,
      frontierByFaction,
    };
  }

  function hexToRgb(hex){
    const norm = hex?.replace('#', '') ?? '202b3d';
    if(norm.length !== 6){
      return { r:32, g:43, b:60 };
    }
    return {
      r: parseInt(norm.slice(0,2), 16),
      g: parseInt(norm.slice(2,4), 16),
      b: parseInt(norm.slice(4,6), 16)
    };
  }

  nextBtn.addEventListener('click', ()=>{
    stopAutoplay();
    step();
  });

  playBtn.addEventListener('click', ()=>{
    toggleAutoplay();
  });

  resetBtn.addEventListener('click', ()=>{
    resetDebugger();
  });

  toggleFrontierBtn.addEventListener('click', ()=>{
    const active = toggleFrontierBtn.dataset.active === 'true';
    toggleFrontierBtn.dataset.active = active ? 'false' : 'true';
    toggleFrontierBtn.textContent = active ? 'Show Frontier Field' : 'Hide Frontier Field';
    renderGrid();
  });

  renderGrid();
  highlightLine(state.currentLine);
}
function createPresenceDemo(mount){
  mount.classList.add('presence-demo');
  mount.innerHTML = `
    <div class="presence-demo__controls">
      <label>presenceX
        <input type="range" id="presenceX" min="-1.5" max="1.5" step="0.05" value="0.8" />
        <span class="value" data-role="valueX">0.80</span>
      </label>
      <label>presenceY
        <input type="range" id="presenceY" min="-1.5" max="1.5" step="0.05" value="0.2" />
        <span class="value" data-role="valueY">0.20</span>
      </label>
      <label class="checkbox">
        <input type="checkbox" id="presenceWall" /> Wall tile
      </label>
    </div>
    <div class="presence-demo__summary">
      <div><span class="label">Best Faction:</span> <span data-role="bestName">–</span></div>
      <div><span class="label">Control Strength:</span> <span data-role="controlStrength">0.00</span></div>
    </div>
    <table class="presence-demo__table">
      <thead><tr><th>Faction</th><th>Projection</th><th>Positive?</th></tr></thead>
      <tbody data-role="tableBody"></tbody>
    </table>
  `;

  const inputX = mount.querySelector('#presenceX');
  const inputY = mount.querySelector('#presenceY');
  const wallToggle = mount.querySelector('#presenceWall');
  const valueX = mount.querySelector('[data-role="valueX"]');
  const valueY = mount.querySelector('[data-role="valueY"]');
  const bestName = mount.querySelector('[data-role="bestName"]');
  const controlStrength = mount.querySelector('[data-role="controlStrength"]');
  const tableBody = mount.querySelector('[data-role="tableBody"]');

  const cos = getPresenceCos();
  const sin = getPresenceSin();

  function update(){
    const x = parseFloat(inputX.value);
    const y = parseFloat(inputY.value);
    valueX.textContent = x.toFixed(2);
    valueY.textContent = y.toFixed(2);

    if(wallToggle.checked || (x === 0 && y === 0)){
      bestName.textContent = 'None';
      controlStrength.textContent = '0.00';
      tableBody.innerHTML = FACTIONS.map(f => `
        <tr>
          <td>${f.key}</td>
          <td>0.00</td>
          <td>No</td>
        </tr>
      `).join('');
      return;
    }

    let bestId = -1;
    let bestProj = 0;
    let sumPos = 0;
    const rows = FACTIONS.map((f, idx)=>{
      const proj = x * cos[idx] + y * sin[idx];
      if(proj > 0){
        sumPos += proj;
        if(proj > bestProj){
          bestProj = proj;
          bestId = f.id;
        }
      }
      const termX = x * cos[idx];
      const termY = y * sin[idx];
      return { faction:f, proj, termX, termY, basisCos: cos[idx], basisSin: sin[idx] };
    });

    const control = (bestId >= 0 && sumPos > 0) ? clamp01(bestProj / sumPos) : 0;

    const bestFaction = FACTIONS.find(f=>f.id === bestId);
    bestName.textContent = bestId >= 0 ? (bestFaction?.key ?? `Faction ${bestId}`) : 'None';
    controlStrength.textContent = control.toFixed(2);

    tableBody.innerHTML = rows.map(row => `
      <tr>
        <td>${row.faction.key}</td>
        <td>
          <code>${x.toFixed(2)} × ${row.basisCos.toFixed(2)} = ${row.termX.toFixed(3)}</code><br />
          <code>${y.toFixed(2)} × ${row.basisSin.toFixed(2)} = ${row.termY.toFixed(3)}</code><br />
          <strong>${row.proj.toFixed(3)}</strong>
        </td>
        <td>${row.proj > 0 ? 'Yes' : 'No'}</td>
      </tr>
    `).join('');
  }

  inputX.addEventListener('input', update);
  inputY.addEventListener('input', update);
  wallToggle.addEventListener('change', update);

  update();
}

function createSafePhaseTable(mount){
  mount.classList.add('safe-phase-demo');
  const rows = FACTIONS.map((f, idx) => {
    const radians = factionSafePhases[idx];
    const degrees = radians * (180 / Math.PI);
    return {
      faction: f,
      bucket: f.safePhaseBucket,
      radians,
      degrees,
      cos: Math.cos(radians),
      sin: Math.sin(radians),
    };
  });

  mount.innerHTML = `
    <table class="safe-phase-table">
      <thead>
        <tr>
          <th>Faction</th>
          <th>Bucket (0-${MEMORY_BUCKETS - 1})</th>
          <th>Radians</th>
          <th>Degrees</th>
          <th>cos(θ)</th>
          <th>sin(θ)</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(row => `
          <tr>
            <td><span class="safe-phase-swatch" style="background:${row.faction.color}"></span>${row.faction.key}</td>
            <td>${row.bucket}</td>
            <td>${row.radians.toFixed(3)}</td>
            <td>${row.degrees.toFixed(1)}°</td>
            <td>${row.cos.toFixed(3)}</td>
            <td>${row.sin.toFixed(3)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function createPresenceAccumulationDemo(mount){
  mount.classList.add('presence-accumulation');
  const gridSize = 2;
  const gridHeight = 3;
  const total = gridSize * gridHeight;
  const presenceX = new Array(total).fill(0);
  const presenceY = new Array(total).fill(0);
  const decay = 0.92;
  const depositAmount = 0.15;

  const cos = getPresenceCos();
  const sin = getPresenceSin();

  function wrapCoord(value, max){
    return ((value % max) + max) % max;
  }

  const agents = [
    {
      id: 'A',
      factionId: 0,
      color: FACTIONS[0]?.color ?? '#00c8ff',
      path: [
        [0,0],[1,0],[1,1],[1,2],[0,2],[0,1]
      ],
      step: 0,
    },
    {
      id: 'B',
      factionId: 1,
      color: FACTIONS[1]?.color ?? '#48ff7b',
      path: [
        [1,2],[0,2],[0,1],[0,0],[1,0],[1,1]
      ],
      step: 0,
    }
  ];

  mount.innerHTML = `
    <div class="presence-accumulation__controls">
      <button class="btn" data-action="step">Step</button>
      <button class="btn" data-action="play">Play</button>
      <button class="btn" data-action="reset">Reset</button>
      <button class="btn" data-action="flip-all">Flip All</button>
      <span class="presence-accumulation__tick">Tick: <strong data-role="tick">0</strong></span>
    </div>
    <div class="presence-accumulation__legend">
      ${agents.map(agent => `<span><span class="swatch" style="background:${agent.color}"></span>Faction ${agent.id}</span>`).join('')}
    </div>
    <div class="presence-accumulation__grid" data-role="grid"></div>
  `;

  const tickLabel = mount.querySelector('[data-role="tick"]');
  const grid = mount.querySelector('[data-role="grid"]');
  const buttons = mount.querySelectorAll('[data-action]');

  let tick = 0;
  let playHandle = null;

  for(let i=0;i<total;i++){
    const cell = document.createElement('div');
    cell.className = 'presence-accumulation__cell';
    cell.innerHTML = `
      <div class="presence-accumulation__card">
        <div class="presence-accumulation__face presence-accumulation__face--front">
          <div class="presence-accumulation__header">
            <strong>${coordLabel(i)}</strong>
            <span class="presence-accumulation__agent" data-role="agent"></span>
          </div>
          <div class="presence-accumulation__vectors" data-role="vectors"></div>
          <div class="presence-accumulation__control" data-role="control"></div>
          <div class="presence-accumulation__hint">Click to flip</div>
        </div>
        <div class="presence-accumulation__face presence-accumulation__face--back">
          <div class="presence-accumulation__equations" data-role="equations"></div>
          <div class="presence-accumulation__hint">Click to return</div>
        </div>
      </div>
    `;
    cell.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const selection = window.getSelection();
      if(selection && selection.toString().length){
        return;
      }
      cell.classList.toggle('is-flipped');
    });
    grid.appendChild(cell);
  }

  function coordLabel(index){
    const x = index % gridSize;
    const y = Math.floor(index / gridSize);
    return `(${x},${y})`;
  }

  function idx(x,y){
    return y * gridSize + x;
  }

  const depositInfo = new Array(total).fill(null);

  function deposit(agent, x, y){
    const wrappedX = wrapCoord(x, gridSize);
    const wrappedY = wrapCoord(y, gridHeight);
    const i = idx(wrappedX, wrappedY);
    const c = cos[agent.factionId] ?? 0;
    const s = sin[agent.factionId] ?? 0;
    const prevX = presenceX[i];
    const prevY = presenceY[i];
    const rawDeltaX = c * depositAmount;
    const rawDeltaY = s * depositAmount;
    const nextX = clamp01(prevX + rawDeltaX);
    const nextY = clamp01(prevY + rawDeltaY);
    presenceX[i] = nextX;
    presenceY[i] = nextY;
    depositInfo[i] = {
      factionId: agent.factionId,
      basisCos: c,
      basisSin: s,
      prevX,
      prevY,
      rawDeltaX,
      rawDeltaY,
      nextX,
      nextY,
      tileX: wrappedX,
      tileY: wrappedY,
    };
  }

  function decayPresence(){
    for(let i=0;i<total;i++){
      presenceX[i] *= decay;
      presenceY[i] *= decay;
    }
  }

  function stepAgents(){
    decayPresence();
    depositInfo.fill(null);
    agents.forEach(agent => {
      agent.step = (agent.step + 1) % agent.path.length;
      const [x,y] = agent.path[agent.step];
      deposit(agent, wrapCoord(x, gridSize), wrapCoord(y, gridHeight));
    });
    tick += 1;
    tickLabel.textContent = String(tick);
    renderGrid();
  }

  function renderGrid(){
    const cells = grid.querySelectorAll('.presence-accumulation__cell');
    cells.forEach((cell, i) => {
      const xVal = presenceX[i];
      const yVal = presenceY[i];
      const magnitude = Math.min(1, Math.hypot(xVal, yVal));
      const frontFace = cell.querySelector('.presence-accumulation__face--front');
      const vectors = cell.querySelector('[data-role="vectors"]');
      const controlEl = cell.querySelector('[data-role="control"]');
      const agentEl = cell.querySelector('[data-role="agent"]');
      const equationsEl = cell.querySelector('[data-role="equations"]');

      const projA = xVal * (cos[0] ?? 0) + yVal * (sin[0] ?? 0);
      const projB = xVal * (cos[1] ?? 0) + yVal * (sin[1] ?? 0);
      const sumPositive = Math.max(0, projA) + Math.max(0, projB);
      const bestProj = Math.max(projA, projB, 0);
      const controlStrength = sumPositive > 0 ? clamp01(bestProj / sumPositive) : 0;
      const dominantAgent = projA >= projB ? agents[0] : agents[1];
      const dominantColor = dominantAgent.color;
      const alpha = Math.max(0.18, controlStrength);
      const terms = [
        `A: ${projA.toFixed(3)}`,
        `B: ${projB.toFixed(3)}`,
      ].join(' · ');

      if(frontFace){
        frontFace.style.background = `linear-gradient(135deg, ${dominantColor}${Math.floor(alpha * 255).toString(16).padStart(2,'0')} 0%, #0f192a 100%)`;
        frontFace.style.boxShadow = `inset 0 0 0 2px rgba(255,255,255,0.05), 0 0 10px ${dominantColor}55`;
        frontFace.style.border = `1px solid ${dominantColor}55`;
      }

      controlEl.innerHTML = `Control: <strong>${controlStrength.toFixed(2)}</strong>`;
      vectors.innerHTML = `
        <div>X: ${xVal.toFixed(2)}</div>
        <div>Y: ${yVal.toFixed(2)}</div>
        <div>‖v‖: ${magnitude.toFixed(2)}</div>
        <div>${terms}</div>
      `;

      const info = depositInfo[i];
      if(equationsEl){
        const cosA = cos[0] ?? 0;
        const sinA = sin[0] ?? 0;
        const cosB = cos[1] ?? 0;
        const sinB = sin[1] ?? 0;
        const projectionSection = `
          <div class="presence-accumulation__equation">Projection A: ${xVal.toFixed(2)} × cosA ${cosA.toFixed(2)} + ${yVal.toFixed(2)} × sinA ${sinA.toFixed(2)} = ${projA.toFixed(3)}</div>
          <div class="presence-accumulation__equation">Projection B: ${xVal.toFixed(2)} × cosB ${cosB.toFixed(2)} + ${yVal.toFixed(2)} × sinB ${sinB.toFixed(2)} = ${projB.toFixed(3)}</div>
        `;
        if(info){
          const faction = FACTIONS[info.factionId];
          const prevX = info.prevX.toFixed(2);
          const prevY = info.prevY.toFixed(2);
          const basisCos = info.basisCos.toFixed(2);
          const basisSin = info.basisSin.toFixed(2);
          const depositStr = depositAmount.toFixed(2);
          const unclampedX = (info.prevX + info.rawDeltaX).toFixed(3);
          const unclampedY = (info.prevY + info.rawDeltaY).toFixed(3);
          const nextX = info.nextX.toFixed(2);
          const nextY = info.nextY.toFixed(2);
          equationsEl.innerHTML = `
            <div class="presence-accumulation__equation">Deposit (${faction?.key ?? info.factionId})</div>
            <div class="presence-accumulation__equation">X: prev ${prevX} + cos(θ) ${basisCos} × deposit ${depositStr} = unclamped ${unclampedX} → clamped ${nextX}</div>
            <div class="presence-accumulation__equation">Y: prev ${prevY} + sin(θ) ${basisSin} × deposit ${depositStr} = unclamped ${unclampedY} → clamped ${nextY}</div>
            ${projectionSection}
          `;
        } else {
          equationsEl.innerHTML = `
            <div class="presence-accumulation__equation">No deposit this tick</div>
            ${projectionSection}
          `;
        }
      }

      const occupant = agents.find(agent => {
        const [ox, oy] = agent.path[agent.step];
        return idx(wrapCoord(ox, gridSize), wrapCoord(oy, gridHeight)) === i;
      });
      if(occupant){
        agentEl.textContent = occupant.id;
        agentEl.style.display = 'inline-flex';
        agentEl.style.color = occupant.color;
      } else if(info){
        agentEl.textContent = FACTIONS[info.factionId]?.key ?? info.factionId;
        agentEl.style.display = 'inline-flex';
        agentEl.style.color = FACTIONS[info.factionId]?.color ?? '#cfe2ff';
      } else {
        agentEl.textContent = '';
        agentEl.style.display = 'none';
      }
    });
  }

  function reset(){
    for(let i=0;i<total;i++){
      presenceX[i] = 0;
      presenceY[i] = 0;
      depositInfo[i] = null;
    }
    agents.forEach(agent => { agent.step = 0; });
    tick = 0;
    tickLabel.textContent = '0';
    renderGrid();
  }

  buttons.forEach(btn => {
    const action = btn.getAttribute('data-action');
    if(action === 'step'){
      btn.addEventListener('click', ()=>{
        stepAgents();
      });
    } else if(action === 'play'){
      btn.addEventListener('click', ()=>{
        if(playHandle){
          clearInterval(playHandle);
          playHandle = null;
          btn.textContent = 'Play';
        } else {
          playHandle = setInterval(stepAgents, 800);
          btn.textContent = 'Pause';
        }
      });
    } else if(action === 'reset'){
      btn.addEventListener('click', ()=>{
        if(playHandle){
          clearInterval(playHandle);
          playHandle = null;
          const playBtn = mount.querySelector('[data-action="play"]');
          if(playBtn) playBtn.textContent = 'Play';
        }
        reset();
      });
    } else if(action === 'flip-all'){
      btn.addEventListener('click', ()=>{
        const cells = grid.querySelectorAll('.presence-accumulation__cell');
        const shouldFlipAll = Array.from(cells).some(cell => !cell.classList.contains('is-flipped'));
        cells.forEach(cell => cell.classList.toggle('is-flipped', shouldFlipAll));
      });
    }
  });

  reset();
}
