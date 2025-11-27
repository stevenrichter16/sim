# Agent emotion fields

The simulation tracks several emotion/psychology fields that agents both emit and react to. These fields are normalized in `[0, 1]` and are reset when the world is reinitialized. Each field has a distinct meaning and emission path.

## Field definitions
- **aggroField**: Hostility or recent combat intensity markers that draw attention to fights or danger.
- **curiosityField**: Exploration drive that pulls agents toward unknown or interesting locations.
- **aweField**: Wonder or amazement produced by discoveries or novel sights.
- **noiseField**: Propagated sounds from movement, combat, or events.
- **bloodField**: Aftermath of combat that reinforces hostility and can sustain tension.
- **discoveryField**: Marker that a tile was recently discovered or highlighted as a point of interest.
- **panicField**: Fear or danger signal; also feeds into tension computations.
- **computedTensionField**: Derived tension that blends fear, comfort, and aggro into a single pressure indicator.

These arrays are allocated and zeroed during world reset alongside the other map fields.【F:src/state.js†L8-L74】【F:src/state.js†L94-L143】

## Emission sources

### Combat-driven emission
`emitCombatEmotions(tileIdx, damageAmount)` deposits multiple signals when agents take or inflict damage, scaling off each field's configuration so tuning lives in one place:
- Aggro is raised by roughly `2 × depositBase × intensity` (≈`0.3 × intensity` with defaults) to mark hostile encounters.
- Blood is applied for significant hits (`intensity > 0.3`) using `1.6 × depositBase × intensity` (≈`0.4 × intensity`) to represent lingering violence.
- Noise is added around `1.25 × depositBase × intensity` (≈`0.25 × intensity`) to broadcast combat sounds.
- Panic is scaled from the panic field `depositBase` to keep damage-driven fear aligned with other panic sources.【F:src/simulation.js†L776-L815】

### Discovery-driven emission
`emitDiscoveryEmotions(tileIdx, intensity)` reflects the emotional reaction to finding new areas or points of interest and also scales amounts off the emotion config:
- Awe rises by `1.25 × depositBase × intensity` to signal wonder.
- Curiosity increases by `1.5 × depositBase × intensity`, encouraging further exploration.
- The discovery marker records the config-scaled amount so the tile remains tagged as discovered.【F:src/simulation.js†L817-L844】

### Ambient curiosity sources
- `emitCuriosity(tileIdx, amount)` lets agents or systems seed curiosity directly on tiles, gently increasing pull toward frontiers.【F:src/simulation.js†L855-L868】
- `emitFactoryCuriosity()` iterates over factory structures and emits curiosity amounts tuned to the structure type (e.g., constructors emit `0.10`, smelters `0.08`, belts `0.03`).【F:src/simulation.js†L870-L922】

### Noise emission
`emitNoise(tileIdx, amount)` provides a generic way to broadcast sound for movement or other actions, incrementing the noise field at the specified tile (defaulting to the configured noise deposit).【F:src/simulation.js†L920-L932】

### Fire-triggered emission
When a tile is ignited via `igniteTile`, the simulation also emits:
- Noise (`+0.3 × normalized intensity`) to represent crackling flames.
- Panic (`+0.2 × normalized intensity`) to signal danger from fire.【F:src/simulation.js†L1771-L1801】

## Field interactions
- The computed tension field is recalculated each update as `tension = fear × (1 − comfort) + 0.5 × aggro`, blending panic, safe comfort, and aggression into a single pressure metric.【F:src/simulation.js†L294-L326】
- Fear suppresses curiosity, but awe now buffers that effect: when panic exceeds `0.6`, curiosity is multiplied by `1 − (fear × 0.7 × (1 − awe relief))`, so spectacular sights keep curiosity from collapsing. In calmer regions (`panic < 0.35`), awe gently boosts curiosity (up to 25% × awe) to reward exploration.【F:src/simulation.js†L328-L352】

## Takeaways
- Agents can emit a mix of fear, hostility, sound, and curiosity-related signals, with combat and fire primarily pushing fear/aggro/noise and exploration events boosting awe/curiosity.
- Derived tension and curiosity suppression couple these emissions, ensuring high-threat areas dampen exploration while discoveries or factory objects proactively attract agents.

## Design improvement brainstorm
The current layout keeps each field in its own array; that is simple but makes it harder to extend, share metadata, or optimize memory. Future refactors could improve both how fields live on tiles and how agents read them:

- **Encapsulate fields in a typed map object**: wrap the parallel arrays in a `FieldMap` with metadata (decay rate, deposit base, clamps) and helper methods (`add(tileIdx, field, amount)`, `decayChunk(chunkId)`) so new fields are registered centrally.
- **Tile-centric storage option**: add an optional `tile.fields` struct that holds a compact tuple for frequently coupled values (e.g., `{panic, aggro, tension}`) while leaving rarely used fields in shared arrays. That keeps hot-path reads cache-friendly for agents evaluating danger.
- **Sparse overlays for temporary signals**: represent short-lived markers (e.g., discovery flashes, one-off noise bursts) as sparse overlays keyed by tile index with expiry ticks. Decay sweeps can then skip zero-heavy arrays.
- **Chunked decay and caching**: group tiles into chunks and track “dirty” flags per field per chunk to avoid decaying untouched regions every frame. Agents could also cache the last-read chunk state for gradient sampling.
- **Gradient-aware sampling helpers**: provide an API that returns both the scalar and a smoothed gradient vector for each field around a tile, so agent steering can blend multiple fields without recomputing neighborhood sums.
- **Agent-readable field bundles**: expose a `senseFields(tileIdx)` helper that returns a pre-normalized bundle (panic, curiosity, awe, tension, noise) in the units agents already use, so agent code no longer reads raw arrays directly.
- **Config-first registration**: define all fields in a config block with names, defaults, and coupling rules. Initialization would allocate arrays and return handles keyed by name, cutting down on manual array wiring and making experimentation safer.
- **Replay/debug snapshots**: store optional frame-sampled snapshots of field layers to visualize how emissions spread; this helps tune decay and coupling and ensures agents are reacting to believable gradients.
