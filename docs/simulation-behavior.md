# Simulation Behaviour Reference

> Working notes summarising the current behaviour encoded in the String-State Engine. Keep this document in sync with feature work and the observation/tests suites.

## Materials & Phase Properties

- **Water (`Mode.WATER`)**
  - Baseline tension `0.8`, amplitude `0.1`.
  - Freezes to ice when local heat ≤ **0.15**; remains water otherwise.
  - When quenched against fire (`reactFireWater`) its tile heat rises slightly (~0.006 per interaction) while the fire amplitude drops a little (≈ −0.03 per call). Repeated quenching lowers amplitude but does *not* guarantee extinction without further conditions (oxygen, neighbouring fire, etc.).
- **Ice (`Mode.ICE`)**
  - Baseline tension `0.95`, amplitude `0.05`.
  - Melts back to water when heat ≥ **0.20**; heat is reduced by ~0.02 on melting (latent absorption).
- **Fire (`Mode.FIRE`)**
  - Baseline tension `0.10`, amplitude `1.0`.
  - Reacts with water to lower amplitude and raises neighbouring water heat. When oxygen is high (`reactFireO2` with O₂ > cut), amplitude is boosted beyond 1.0 and tile heat jumps; when oxygen falls below the cut-off the fire is removed from `world.fire`.
  - Phase is nudged forward on `reactFireWater`, enabling animation flicker.
- **Acid (`Mode.ACID`)** and **Base (`Mode.BASE`)**
  - Baseline tension `0.5`, amplitude `0.6`.
  - Pair interactions (`reactAcidBase`) drain tension on both tiles (~0.005 per call) and dump heat only onto the base (~0.052 per call). Acid tiles themselves stay at zero heat in the direct reaction. Repeated calls accumulate heat on the base.
  - When run inside the simulation, heat diffusion spreads that energy into adjacent tiles; smoke tests confirm neighbouring cells are warmed after several steps.
  - First adjacency emits a magenta/grey flash and a spark burst via the render hooks (`emitFlash`/`emitParticleBurst`).
- **Cryofoam (`Mode.CRYOFOAM`)**
  - Heat is clamped to **≤ 0.18** during `stepCryofoam` and amplitude decays (~0.995 multiplier).
  - TTL decreases faster near acid neighbours; when TTL hits zero the tile restores to its previous state.
  - Adjacency to base converts cryofoam to permanent ice.
- **CLF₃ / other special materials**
  - Not directly exercised in tests yet. Note to add coverage when behaviour is adjusted.

## Environmental Mechanics

- **Heat diffusion**
  - Each simulation step diffuses heat with coefficient `settings.dHeat`. Values remain bounded [0,1]; smoke tests verify no NaN propagation.
  - Accumulated acid/base heat spreads to orthogonal neighbours within ~10 steps (`tests/combined.scenarios.test.js`).
- **Oxygen diffusion & vents**
  - `diffuse` equalises O₂ across neighbours (`dO2`).
  - Vent tiles clamp toward `o2Base` (e.g. 0.19) without overshooting.
  - Oxygen values are kept within [0, base] each step.

## Agents & Social Dynamics

- Baseline `Agent` state depends on mode (CALM, PANIC, etc.). Panic mode has high amplitude/low tension; calm is opposite.
- **Hypoxia & Heat**
  - Tiles with O₂ < 0.17 add small amplitude, < 0.15 shave tension. High oxygen (>0.19) recovers tension.
  - Heat > 0.75 chips away tension; < 0.35 allows recovery.
- **Panic conversion**
  - Combination of high amplitude (>0.8) and low tension (<0.4) flips to `Mode.PANIC`. Smoke/combined tests show this can happen after sustained exposure to hot/low-oxygen tiles.
- **Social stress**
  - `couple` interactions within 3 tiles blow up amplitude and reduce tension when neighbours are agitated. Tests ensure stress grows panicLevel and drops tension when recovery is disabled (low O₂, high amplitude neighbours).

## Phase & Coupling

- `couple(A,B)` returns higher values when phases align; amplitude sum and low tension amplify the response.
- High tension dampens coupling, preventing energy spreading in rigid materials.
- `reactFireWater` adjusts fire phase, supporting the flickering animation.

## Particle & Flash Hooks

- `emitParticleBurst(x,y,{type,intensity})` queues render-time bursts for steam, sparks, foam, freeze, thaw.
- `emitFlash` emits a single energy pulse when acid/base pairs first interact. Subsequent reactions don’t re-queue unless explicitly requested.
- Observation tests log the actual numeric state for manual review.

## Simulation Smoke Expectations

- Running `createSimulation.stepOnce()` repeatedly should keep heat in [0,1], no NaNs, and retain agent count. Tests run for 30 ticks with fire, water, and agents to confirm stability.
- Agent modes remain defined and list length constant over sample runs.

## Usage Checklist

- After major engine or gameplay changes, run the smoke suite:
  ```bash
  npm test -- --run tests/simulation.smoke.test.js
  ```
- Update this document and the observation suite when mechanics change so assertions reflect expected behaviour.
- Add targeted unit tests alongside new features (e.g., CLF₃ diffusion, new modes) to keep coverage current.

## Factory Logistics & Production Chain

- `world.factory` (see `src/factory.js`) keeps track of nodes, structures, item flow, and aggregate production stats.
- Factory structures are expressed as dedicated modes (`Mode.FACTORY_NODE`, `Mode.FACTORY_MINER`, etc.) so they render in the sim and appear in the legend/brush palette.
- `stepFactory()` runs once per tick (hooked into `stepSimulation`) to:
  - Advance conveyor progress for any items currently on belts.
  - Extract ore from miners placed on ore nodes and feed output to the next structure.
  - Consume ore inside smelters to produce ingots, then pass them downstream.
  - Assemble ingots into plates inside constructors and deliver finished goods into storage crates.
- Orientation can be rotated via the builder UI (`⟲/⟳` buttons) or the `[` / `]` hotkeys; placement honours the active direction.
- Production totals from `getFactoryStatus()` drive the factory HUD and are covered by `tests/factory.gameplay.test.js` to keep the chain healthy.
