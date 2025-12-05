# Stigmergy-Driven Simulation Concept

This document outlines a twist on exploration, harvesting, construction, and settlement building where stigmergy — indirect coordination through environmental traces — is the primary mechanic rather than stereotypical resources.

## Core Principles
- **Signals first, matter second:** Agents do not just gather wood/stone; they deposit and read "pheromone" traces that encode intent, history, and permissions. Material transformations depend on the local signal field.
- **Emergent blueprints:** Structures and tools crystallize when overlapping traces meet thresholds, turning ambient "substrate" into functional objects.
- **Adaptive ecosystems:** Wild flora/fauna respond to the same signals, creating feedback loops (e.g., over-harvest signals attract reclaimers that recycle materials back into substrate).

## Resource Model
- **Substrate:** A generic raw medium found in terrain. It becomes specific materials only when combined with signal patterns (heat signal -> slag, growth signal -> mycelium fiber, resonance signal -> crystalline circuits).
- **Signal Traces:** Persistent, decaying fields with tags and intensities (e.g., "build", "defend", "harvest", "heal"). Agents emit traces when acting; terrain and weather can diffuse or amplify them.
- **Gestalt Materials:** Hybrid items formed by co-located signals during crafting (e.g., build+resonance -> tuned beams that auto-align, harvest+growth -> self-repairing scaffolds).

## Construction & Settlement
- **Blueprint by walking:** To plan a structure, agents walk the outline emitting build+role traces. The environment auto-generates scaffolding nodes where signals intersect.
- **Signal-weighted assembly:** Work speed and outcomes depend on trace coherence; mismatched signals create quirky variants (e.g., doors that only open when patrol traces are high).
- **Living rooms:** Rooms adapt to current dominant signal—kitchen mode when cook traces peak, infirmary mode when heal traces accumulate.

## Exploration & Harvesting
- **Signal ecology:** Biomes have native signal spectra (fungal emits growth, volcanic emits heat/resonance). Entering agents' traces blend with ambient ones, producing emergent hazards or boons.
- **Harvest rituals:** Extracting substrate without proper dampening traces angers local reclaimers; using harmonizing traces yields cooperative harvesting where fauna help expose veins.
- **Trail intelligence:** Pathfinding leverages historic success traces (safe/unsafe pheromones). Over time, optimal routes self-mark; raids overwrite them with false signals.

## Automation & Crafting
- **Task handoff via traces:** Jobs are claimed by agents that resonate with nearby signals; no central queue. Failing tasks leaves corrective traces that future agents interpret as "bring tools" or "reinforce".
- **Dynamic recipes:** Crafting stations are signal amplifiers; recipes are defined by input substrate plus trace signatures. Experimentation means layering new signals to discover novel outputs.
- **Signal circuits:** Use beacons and absorbers to route traces like currents—enabling doors that open on patrol traces, farms that overgrow when harvest traces are low, or turrets that wake on defend spikes.

## Defense & Threats
- **Stigmergic raids:** Enemies follow and spoof traces. Players must scrub or invert signals to mislead them. Anti-spoof tiles absorb hostile signals; decoy emitters project false colonies.
- **Adaptive defenses:** Traps gain behaviors from recent signal history (e.g., if heal traces dominate, traps inject healing spores to convert attackers instead of killing).

## Progression & Research
- **Signal literacy:** Research unlocks new trace tags and modifiers (phase, decay rate, polarization). Higher tiers allow precision sculpting of material outcomes.
- **Cultural memory:** Settlements accrue long-lived "legend" traces that grant global bonuses and attract specific NPC archetypes aligned with the dominant signals.

## Testing Hooks
- **Trace maps:** Overlays showing intensity/decay to debug emergent coordination.
- **Mutation toggles:** Sandbox switches to alter decay rates or add noise, validating that AI still converges on tasks.
- **Scenario drills:** Stress tests: signal-saturated hives, trace droughts, and spoof-heavy raids to ensure robustness.
