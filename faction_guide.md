# Faction Territory Guide

This guide walks through the entire faction territory system: presence projection, dominance, frontier detection, debt, reinforcement, and the way agents read those cues. Each section references concrete code in `src/simulation.js` and other modules, and proposes interactive demos suited for a companion HTML tutorial.

---

## Contents
1. [Overview](#overview)
2. [Presence Fields & Phase Projection](#presence-fields--phase-projection)
3. [Dominant Faction & Control Strength](#dominant-faction--control-strength)
4. [Frontier Detection & Contest Signals](#frontier-detection--contest-signals)
5. [Control Debt: Recapturing Lost Tiles](#control-debt-recapturing-lost-tiles)
6. [Reinforcement Trails & Frontier Boost](#reinforcement-trails--frontier-boost)
7. [Movement Weighting & Agent Decisions](#movement-weighting--agent-decisions)
8. [Diagnostics, Overlays & Metrics](#diagnostics-overlays--metrics)
9. [Try-It Exercises & Quizzes](#try-it-exercises--quizzes)
10. [Reference & Further Reading](#reference--further-reading)

---

## Overview

- Every faction leaves sine/cosine presence components (`world.presenceX/Y`).
- We compute a dominant faction array (`world.dominantFaction`) and a confidence scalar (`world.controlLevel`).
- Derived pheromones (frontier, control debt, reinforcement) steer agents to act locally but cooperatively.
- Agents score candidate moves with weights tuned per role, balancing safety, exploration, recapture, and consolidation.

**Interactive landing idea**: present a 10×10 toy grid, animate a faction blob expanding, and highlight the cues being produced at each stage. A “Start Guided Tour” button leads to the sections below.

---

## Presence Fields & Phase Projection

**Code**: `updatePresenceControl()` (`src/simulation.js:69-120`)

1. Each tile stores `presenceX`/`presenceY`: the sum of agent phases and pheromone deposits projected on the unit circle.
2. We precompute per-faction cosine/sine values (`getPresenceCos()/getPresenceSin()` from `memory.js`).
3. At every tick, we project the tile’s vector onto each faction’s safe phase to get positive support (`proj`).
4. We accumulate positive projections and pick the faction with the largest `proj`, normalized by `sumPos`.

```js
const proj = x * cos[f] + y * sin[f];
if (proj > 0) {
  sumPos += proj;
  if (proj > bestPos) {
    bestPos = proj;
    bestId = f;
  }
}
```

5. Walls zero out presence to avoid bleed across barriers.

**Interactive module**
- “Presence vector editor”: pick a tile, adjust X/Y sliders, and watch the dominant faction indicator update.
- Toggle a wall overlay to see how the presence vector is clamped.
- Highlight positive vs negative projections for each faction as a bar chart.

**Callout**: presence vectors come from both agent movement and pheromone deposits (`world.memX`, `world.memY`). Link to `memory.js` for deeper study.

---

## Dominant Faction & Control Strength

**Code**: `updatePresenceControl()` (same section).

- If `bestId >= 0` and `sumPos > 0`, we mark the tile dominated by `bestId` and compute a control confidence: `control = clamp01(bestPos / sumPos)`.
- Otherwise the tile is neutral (`dom = -1`, `control = 0`).
- Bias toward confident tiles: the more aligned the presence, the closer `controlLevel` gets to 1.
- Later systems (frontier, reinforcement) rely on these arrays.

### Implementation Guide
1. **Markup**: In `guide.html`, keep the existing `<section id="dominance">` block and add a short explanatory paragraph plus a container for the demo: e.g. `<div class="demo-placeholder" data-demo="dominance"></div>` (already scaffolded).
2. **Controller logic** (`src/guide.js`):
   - Register a `dominance` demo inside `registerDemo(...)`. Use sliders for X/Y presence plus a dropdown for the number of active factions (read from `FACTIONS`).
   - On change, recompute projections with `getPresenceCos()`/`getPresenceSin()` and mirror the exact loop from `updatePresenceControl()` so the guide stays truthful.
   - Display per-faction projection values, the selected `bestId`, and the normalized `control` scalar. Highlight neutral tiles when `sumPos === 0`.
3. **Styling**: Extend `styles/guide.css` with a `.dominance-demo` panel matching the presence widget (reusing typography and table styles).
4. **Validation hook**: Optionally expose a small helper in `src/guide.js` that calls the real `updatePresenceControl()` on a 1×1 mock world and compares results. This keeps the tutorial output aligned if the core logic changes.
5. **Documentation link**: Reference the specific lines (`src/simulation.js:75-120`) in the guide text so readers can jump straight to the implementation.

**Interactive module**
- A dial representing `bestPos`, `sumPos`, and `control` scales; watch them respond to presence tweaks.
- Scenario: combine two low-confidence faction influences and show the tile remain neutral.

---

## Frontier Detection & Contest Signals

**Code**: `updateFrontierFields()` (`src/simulation.js:122-170`).

1. Build a `contestVals` array from control: `contest = 1 - |2 * control - 1|`. Neutral or strongly held tiles have low contest; 0.5 control gives 1.0 contest.
2. For each tile with `dom >= 0`, we scan direct neighbors (4-dir) for friendly vs hostile presence (using `factionAffinity`).
3. If a faction has both friendly and hostile neighbors, we deposit `contest * FRONTIER_DEPOSIT` into `frontierByFaction[fid][i]`.
4. After the pass, we diffuse and decay the field via `updateField()` and clamp to [0,1].

**Interactive module**
- “Frontier lab”: create a pocket of faction A adjacent to faction B; see the frontier overlay spike exactly along the contested border.
- Explain the deposit parameters and half-life defined near the top (e.g., `FRONTIER_DEPOSIT`, `fieldConfig.safe`).

**Tip**: show the effect of positive affinities—if two factions are allies (affinity > 0), they won’t trigger frontier deposition.

---

## Control Debt — Recapturing Lost Tiles

**Code**: `seedControlDebt()` (`src/simulation.js:173-200`).

1. We keep `prevDominant` and `prevControl` arrays (snapshots from previous tick).
2. For each tile, we detect a “loss” when:
   - The tile was ours with confidence > `DEBT_LOSS_HIGH` (0.6).
   - Now it’s either neutral, or controlled by another (hostile) faction with confidence < `DEBT_LOSS_LOW` (0.4).
3. If the new dominant faction is hostile or neutral, we add debt for the original faction:

```js
const deposit = DEBT_DEPOSIT * Math.max(0, wasConf - nowConf);
world.debtByFaction[was][i] = Math.min(1, current + deposit);
```

4. The field diffuses with `DEBT_DIFFUSION = 0.10` and half-life of 8 ticks, and agents weight it positively to rush back.

**Interactive module**
- Simulate a territory loss: a tile strongly held by faction A loses to B for one tick. Show the debt field spike and then fade as the tile stays enemy.
- Provide step-by-step timeline with the thresholds to illustrate hysteresis (avoid flicker).

**Exercise**: Show what happens if the tile flips to ally instead of enemy; the `hostile` check prevents debt deposition in that case.

---

## Reinforcement Trails & Frontier Boost

**Code**: `seedReinforcement()` and `maybeBoostFrontierFromReinforce()` (`src/simulation.js:203-243`).

1. After `updateFrontierFields()`, we evaluate each tile:
   - If the dominant faction’s control is above `REINFORCE_THRESHOLD` (0.8), deposit reinforcement pheromone: `REINFORCE_DEPOSIT * (control - threshold)`.
   - Now the field is in `world.reinforceByFaction[fid][i]`.
2. Each tick we diffuse and decay with `REINFORCE_DIFFUSION = 0.05`, `REINFORCE_HALFLIFE = 14`.
3. When an agent moves, `maybeBoostFrontierFromReinforce()` checks whether the origin tile has strong reinforcement and the destination tile is contested; if so, we add a small frontier boost (`REINFORCE_FRONTIER_BOOST = 0.005 * reinforcement`), nurturing expansion outward.
4. Agents weight reinforcement in `scoredNeighbor()` to stick near strongholds but still obey other cues.

**Interactive module**
- “Stronghold builder”: hold a tile for several ticks, watch reinforcement appear (rendered in black overlay). Move an agent outward; observe the frontier field receive a slight bump.
- Provide toggles to change thresholds and see how reinforcement density changes.

**Troubleshooting note**: Reinforcement only deposits when control is high; the tutorial should mention that players might not see it immediately and must steady territory first.

---

## Movement Weighting & Agent Decisions

**Code**: `movementWeightsFor()` (`src/simulation.js:234-273`) and `scoredNeighbor()` (`src/simulation.js:329-447`).

1. Each role (civilian, medic) has a weight table for fields: safety, route, panic, frontier, debt, reinforcement, control gradient, etc.
2. `scoredNeighbor()` gathers all relevant values for a tile:
   - Environmental safety via `safetyScore()`.
   - Help/route/panic/safe/escape fields (`world.helpField`, etc.).
   - Presence cues (ally vs rival projections).
   - Safe memory fields (`world.memX/Y` projections).
   - Turf control and gradient (difference between current tile control and neighbor’s control for player’s faction).
   - Debt and reinforcement from `world.debtByFaction` and `world.reinforceByFaction`.

```js
(weights.debt ?? 0) * myDebt +
(weights.controlGradReward ?? 0) * controlGrad +
(weights.reinforce ?? 0) * myReinforce
```

3. Score is a sum of weighted cues; the best scored neighbor influences agent movement unless random or panic overrides kick in.

**Interactive module**
- “Agent brain viewer”: pick an agent/tile, show each field value and its weight; compute the weighted sum for each neighbor and highlight the chosen direction.
- Let players tweak weights to see how behavior shifts (e.g., increase reinforcement weight to keep agents inside strongholds).

**Advanced**: Show the control gradient difference calculation (our faction vs allied vs hostile) and how that encourages moving to higher-control tiles.

---

## Diagnostics, Overlays & Metrics

**Code**: `drawPheromoneSlices()`, `drawDominanceOverlay()` (`src/render.js`), plus `diagnosticsFrame` in `src/simulation.js:1450+`.

1. Overlays are toggled via buttons/keys, each tied to a field.
2. Reinforcement currently renders as black slices; the overlay threshold is low (`0.0005`) to reveal subtle deposits. Mention the new overlay toggle introduced earlier.
3. `diagnosticsFrame.fieldTotals` gathers sums for help, route, panic, safe, escape, debt, reinforcement, etc., aiding telemetry.
4. We integrate new totals so the UI can chart reinforcement per faction.

**Tutorial addition**
- Explain how to enable reinforcement overlay (button or `R` key) and reinforcement logging (new UI button), referencing `debugConfig.enableLogs.reinforceSeed`.
- Provide instructions for reading metrics from the telemetry panel.

---

## Try-It Exercises & Quizzes

Include interactive exercises for each system:

1. **Presence puzzle**: The player sets presence vectors for a row of tiles; predict which faction wins before toggling “Reveal”.
2. **Frontier builder**: Add friendly/hostile neighbors until the frontier lights up; explain why certain formations don’t count.
3. **Debt scenario**: A tile flips sides—ask if debt will deposit based on previous control (multiple-choice). Show the code snippet verifying the answer.
4. **Reinforcement challenge**: Hold a tile steady for 10 ticks, then walk an agent outward to see the frontier boost. Provide counters showing reinforcement to confirm.
5. **Movement scoring sandbox**: Adjust weights live and answer questions like “Why did this agent step into a contested tile?”; highlight the dominant term.
6. **Quiz**: Summarize with questions referencing constants (`DEBT_LOSS_HIGH`, `REINFORCE_THRESHOLD`) and behaviors (“What happens if control drops from 0.9 to 0.4? Why?”).

---

## Reference & Further Reading

- `src/simulation.js`: core loops (`updatePresenceControl`, `seedControlDebt`, `seedReinforcement`, `scoredNeighbor`).
- `src/render.js`: overlay rendering, reinforcement color configuration.
- `src/debug.js`: overlay defaults, logging toggles.
- `src/input.js`: button/key bindings for overlays and logs.
- `docs/tag-system.md`: theoretical background on stigmergic tags.
- `docs/stigmergic-tags.md`: taxonomy of pheromone fields.
- `data/tag-coefficients.json`: tuning constants (if referencing in interactive sliders).

**Implementation suggestions**
- Build `guide.html` as a static page importing shared CSS (`styles/main.css`) and a small JS bundle for demos.
- Use `<pre><code data-file="src/simulation.js" data-lines="203-224">` to embed actual snippets; script them to fetch live code so the guide stays up-to-date.
- For interactive grids, reuse simplified logic from `render.js`/`simulation.js` but sandbox it to avoid mutating the main game state.
- Provide “Open in Source” links that jump to the GitHub raw file with line anchors or open the local file via custom protocol (if available).

By fleshing out each step with code, visuals, and hands-on demos, this guide becomes both a learning resource for contributors and an onboarding tour for players who want to understand how factions behave under the hood.
