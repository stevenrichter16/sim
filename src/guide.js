import { FACTIONS } from './factions.js';
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
registerDemo('presence', createPresenceDemo);
registerDemo('presence-accumulation', createPresenceAccumulationDemo);
registerDemo('safe-phases', createSafePhaseTable);
registerDemo('frontier', (mount)=>{
  mount.textContent = 'Frontier visualization placeholder.';
});

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
