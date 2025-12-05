# Stigmergic Factory-Colony Concept (Necesse x Satisfactory)

A deep-dive design for a Necesse-style survival/colony sim fused with Satisfactory-grade automation where **stigmergy**—indirect coordination through traces in the world—is the primary resource and control surface.

## Design Goals
- **Play the pheromone field:** Every system (needs, jobs, logistics, combat) reads and writes signal fields instead of classic task queues and belts. Players sculpt fields rather than micromanaging agents.
- **Materialization by consensus:** Resources and structures crystallize out of ambient substrate when overlapping traces reach thresholds, turning coordination itself into a crafting ingredient.
- **Adaptive, living base:** Rooms, machines, and fauna shift functions as dominant traces change, enabling dynamic layouts instead of static factories.
- **Readable emergence:** Provide overlays, meters, and experiments so players can see, test, and intentionally steer stigmergic behaviors.

---
## Core Substances & Signals
- **Substrate:** Ubiquitous raw medium (soil, stone, ore haze). It becomes specific matter only in the presence of shaped signals. Substrate quality influences conversion efficiency and decay rates.
- **Signal Traces:** Persistent, decaying fields with tags (build, defend, harvest, heal, resonate, chill, ignite, balance, swarm). Agents, fauna, weather, and machines emit them; tiles can store or reflect them.
- **Trace Dynamics:**
  - **Emission**: Actions emit tagged traces proportional to effort; specialized gear modulates spectrum and decay.
  - **Diffusion & Polarization**: Terrain, wind, and conduits bend signals. Players can polarize (directional) or dampen (local sink) traces.
  - **Interference**: Conflicting tags (heal vs. decay) create turbulence that slows tasks or spawns mutants; harmony boosts speed/quality.
- **Gestalt Materials:** When substrate is exposed to dominant trace pairs, it resolves into specialized matter (build+resonate → tuned beams; harvest+growth → regenerative scaffolds; chill+defend → frostglass plating).

---
## World & Biomes (Signal Ecology)
- **Biome Spectra:** Each biome emits a baseline signal mix (e.g., Myco Groves = growth/heal, Basalt Vents = heat/resonate, Ruin Fields = decay/defend). Players must counter, amplify, or harness ambient fields.
- **Hazard Feedback:** Over-harvest raises reclaim signals that spawn recycler fauna; heavy defend signals attract raid scouts; excess resonate in caves awakens echo predators.
- **Travel & Mapping:** Trails accumulate success/failure signals (safe/unsafe pheromones). Raids can spoof trails; players deploy scrubbers or verifiers to cleanse or lock trails.

---
## Agents & Needs (Stigmergic AI)
- **Needs as Signals:** Hunger, rest, morale, and temperature project personal traces. Dormitories with aligned traces (rest+heal) boost recovery; noisy signals interfere with sleep.
- **Task Discovery:** No central job board. Agents follow gradients matching their role imprint. Failed attempts leave corrective traces (“bring tools”, “reinforce floor”), improving future attempts.
- **Specialization:** Agents attune to certain tags, gaining bonuses when immersed (harvesters thrive in growth fields, defenders in defend+resonate). Mismatched fields stress them, raising morale decay.
- **Social/Party Behaviors:** Party traces temporarily amplify local morale and smooth interference, useful before raids or mega-builds.

---
## Construction (Blueprint by Field-Sketch)
- **Outline Walking:** Players and agents walk perimeters emitting build+role signals. Where lines intersect, scaffold nodes form automatically from substrate.
- **Signal-Weighted Assembly:** Build speed/quality scales with coherence. Clean spectra yield standard parts; noisy spectra produce variants (doors that open on patrol traces; floors that slow foes under decay). Players can exploit noise for emergent utility.
- **Room Modulation:** Rooms have mode stacks tied to dominant tags:
  - **Cook Mode:** cook+heat/growth → kitchen bonuses, recipe discovery.
  - **Clinic Mode:** heal+rest → faster recovery and injury conversion.
  - **Workshop Mode:** build+resonate → faster crafting; auto-routing of supply traces.
  - **War Room:** defend+resonate → turret sync, raid forecasting.
  Rooms can be “locked” via anchors to prevent mode flapping.

---
## Harvesting & Gathering
- **Ritual Extraction:** To mine, players lay dampen+harvest traces to avoid waking reclaimers. Over-mining without dampening spawns them, which recycle dropped items back into substrate unless countered.
- **Assistive Fauna:** Some creatures mirror nearby traces: emit harvest+growth and they uproot resources for you; emit defend and they patrol.
- **Mobile Stockpiles:** Agents drop resource caches where deposit signals peak; caches grow storage capacity when reinforced by build+balance traces.

---
## Crafting & Research (Trace Chemistry)
- **Dynamic Recipes:** Inputs = substrate + transient trace spectra. Stations act as amplifiers/filters. Players experiment by layering signals in time (heat spike followed by chill) to discover new materials.
- **Tech via Literacy:** Research unlocks new tags, decay modifiers, and polarization techniques rather than discrete items. Higher literacy enables finer control of interference, unlocking stable high-tier materials.
- **Blueprint Crystallization:** To lock a recipe, players capture the trace waveform during a successful craft and “imprint” it into a pattern plate. Plates can be slotted into stations to reproduce outputs reliably.

---
## Logistics & Automation (Satisfactory Twist)
- **Signal Railways:** Instead of belts, players lay **signal conduits**. Items ride “carrier motes” that follow path gradients. Motes slow in turbulence; smoothing fields creates high-throughput lanes.
- **Task Handoff:** Stations emit “need” traces (feed, drain, output). Haulers and drones follow these gradients, picking tasks opportunistically. Load balancing emerges from trace strengths rather than discrete priorities.
- **Throughput Tuning:** Players can:
  - **Polarize Paths:** Directionalize conduits to avoid backflow.
  - **Throttle with Dampeners:** Reduce intensity to limit draw on rare materials.
  - **Multiplex:** Encode items with spectral tags so mixed lanes remain stable.
- **Factory Blocks:**
  - **Amplifier:** Boosts specific tags for long-haul logistics.
  - **Inverter:** Flips hostile or noisy signals to stabilize a line.
  - **Scrubber Gate:** Only passes carriers whose item-tag matches the gate’s tuned spectrum.
- **Maintenance via Echoes:** Machines emit health traces; misalignment creates friction traces that attract maintainer agents. No explicit maintenance job list is needed.

---
## Defense, Raids, and Spoofing
- **Raid Logic:** Enemies follow defend/wealth gradients; smart raiders inject spoof traces to mislead logistics. Players counter with verifiers (require matching polarization) and honeytraps (emit false wealth/defend to lure).
- **Adaptive Defenses:**
  - **Morphing Traps:** Behavior depends on recent trace history (heal-dominant traps pacify; decay-dominant traps corrode armor; resonate-dominant traps stun in AoE).
  - **Living Walls:** Build+defend+growth walls self-repair; build+defend+chill walls reflect projectiles; resonate layers amplify turret sync.
- **Fog of Signals:** Storms or eclipse events scramble traces. Players rely on anchored beacons to hold field integrity. Temporary line-of-sight mechanics for signals create tactical map play.

---
## Progression & Colony Identity
- **Legend Traces:** Long-lived, colony-wide memories that form after major events (first raid repelled, mega-bridge built). They shape NPC archetype spawns and global buffs.
- **Tiering by Control, Not Parts:** Advancement is measured by how finely players control fields—e.g., maintaining stable multiplexed logistics or running factories in turbulent biomes—rather than by unlocking a linear item list.
- **Cultural Drift:** Colonies drift toward signal alignments (e.g., growth/harvest communes vs. defend/resonate fortresses). Drift affects visitors, trade offers, and raid composition.

---
## UI, Feedback, and Player Tools
- **Signal Overlays:** Heatmaps for each tag, interference meters, and flow arrows for carriers. Toggleable per-tag view plus composite “stability” view.
- **Field Sculpting Tools:**
  - **Brushes:** Paint temporary tags to prototype layouts.
  - **Anchors:** Lock a field strength locally; consume rare resources to reduce decay.
  - **Prisms:** Split mixed traces into clean components for debugging or specialization.
- **Experiment Stations:** Small benches that record waveforms and show outcome diffs when players tweak timing, enabling systematic discovery rather than random guessing.

---
## Scenarios & Testing Hooks
- **Early Loop Test:** Establish shelter with outline walking; set up a harvest lane with dampeners; craft first gestalt material via waveform capture.
- **Midgame Factory Test:** Multiplex three materials on a single conduit; maintain throughput under periodic turbulence events; automate maintenance with echo readers.
- **Raid Robustness Test:** Survive spoof-heavy raids using verifiers/honeytraps; evaluate defensive morphing under different trace histories.
- **Stress & Noise Test:** Sandbox slider to add random interference; ensure agents still complete tasks and self-heal field integrity.
- **Metrics:** Track coherence scores per room, carrier latency, raid misrouting rate, and mutation frequency for balance tuning.

---
## Unique Hooks to Differentiate from Stereotypes
- **Signals as both blueprint and fuel:** Instead of “bring 10 iron,” players orchestrate field harmony to materialize tuned beams on-site.
- **Pathfinding via memory trails:** Safe routes self-mark; sabotage and weather rewrite trails, making logistics defense a live system.
- **Mutable rooms & machines:** Infrastructure shifts function based on ambient signals, encouraging flexible layouts over permanent bus designs.
- **Cooperative and adversarial stigmergy:** Allies, fauna, and enemies all write to the same field, so optimization and defense share the same mechanic.

---
## Next Implementation Steps (actionable)
1. **Signal Field System:** Implement tagged, decaying fields with diffusion, polarization, and interference math; add overlays.
2. **Substrate Conversion:** Define substrate tiles that convert to materials based on local dominant pairs; prototype 4–6 material outputs.
3. **Stigmergic Job Picker:** Replace job queues with gradient following + corrective trace drops; add failure-to-feedback loops.
4. **Conduit Logistics Prototype:** Create carrier motes that follow signal paths; add dampener, amplifier, and scrubber blocks.
5. **Room Mode Logic:** Mode detection based on dominant tags; implement 3 core modes with bonuses and visual shifts.
6. **Raid Spoofing Pass:** Simple raider AI that follows/forges traces; prototype verifier/honeytrap blocks to counter.
7. **Scenario Harness:** Build scripted scenarios for early, mid, and raid tests with metrics collection.
