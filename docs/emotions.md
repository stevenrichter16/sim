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

## Field registry
An initial registry at `src/fieldRegistry.js` captures metadata for the navigation and emotion fields (kind, description, range) and mirrors the configured decay/diffusion/deposit values so emission helpers can read from a single source of truth, including the visited memory field.【F:src/fieldRegistry.js†L1-L55】【F:src/fieldRegistry.js†L57-L81】

## Derived fields
Derived fields are computed blends that do not receive direct deposits; instead they recombine other fields each tick to expose an agent-ready signal without extra per-agent math. The simulation currently tracks one derived entry:

- **ComputedTension**: tension = panic × (1 − safe comfort) + 0.5 × aggro. This value is recalculated every update so agents can
  read a single pressure indicator rather than separately sampling panic, safe, and aggro.【F:src/simulation.js†L312-L349】【F:src/fieldRegistry.js†L66-L83】

## Emission sources

### Combat-driven emission
`emitCombatEmotions(tileIdx, damageAmount)` deposits multiple signals when agents take or inflict damage, scaling off each field's configuration so tuning lives in one place:
- Aggro is raised by roughly `2 × baseDeposit × intensity` (≈`0.3 × intensity` with defaults) to mark hostile encounters.
- Blood is applied for significant hits (`intensity > 0.3`) using `1.6 × baseDeposit × intensity` (≈`0.4 × intensity`) to represent lingering violence.
- Noise is added around `1.25 × baseDeposit × intensity` (≈`0.25 × intensity`) to broadcast combat sounds.
- Panic is scaled from the panic field `baseDeposit` to keep damage-driven fear aligned with other panic sources.【F:src/simulation.js†L820-L858】

### Discovery-driven emission
`emitDiscoveryEmotions(tileIdx, intensity)` reflects the emotional reaction to finding new areas or points of interest and also scales amounts off the emotion config:
- Awe rises by `1.25 × baseDeposit × intensity` to signal wonder.
- Curiosity increases by `1.5 × baseDeposit × intensity`, encouraging further exploration.
- The discovery marker records the config-scaled amount so the tile remains tagged as discovered.【F:src/simulation.js†L865-L887】

### Ambient curiosity sources
- `emitCuriosity(tileIdx, amount)` lets agents or systems seed curiosity directly on tiles, gently increasing pull toward frontiers.【F:src/simulation.js†L894-L900】
- `emitFactoryCuriosity()` iterates over factory structures and emits curiosity amounts tuned to the structure type (e.g., constructors emit `0.10`, smelters `0.08`, belts `0.03`).【F:src/simulation.js†L902-L942】

### Noise emission
`emitNoise(tileIdx, amount)` provides a generic way to broadcast sound for movement or other actions, incrementing the noise field at the specified tile (defaulting to the configured noise deposit).【F:src/simulation.js†L944-L955】

### Fire-triggered emission
When a tile is ignited via `igniteTile`, the simulation also emits:
- Noise (`+0.3 × normalized intensity`) to represent crackling flames.
- Panic (`+0.2 × normalized intensity`) to signal danger from fire.【F:src/simulation.js†L1771-L1801】

## Field interactions
- The computed tension field is recalculated each update as `tension = fear × (1 − comfort) + 0.5 × aggro`, blending panic, safe comfort, and aggression into a single pressure metric.【F:src/simulation.js†L299-L320】
- Fear suppresses curiosity, but awe now buffers that effect: when panic exceeds `0.6`, curiosity is multiplied by `1 − (fear × 0.7 × (1 − awe relief))`, so spectacular sights keep curiosity from collapsing. In calmer regions (`panic < 0.35`), awe gently boosts curiosity (up to 25% × awe) to reward exploration.【F:src/simulation.js†L322-L348】

## Takeaways
- Agents can emit a mix of fear, hostility, sound, and curiosity-related signals, with combat and fire primarily pushing fear/aggro/noise and exploration events boosting awe/curiosity.
- Derived tension and curiosity suppression couple these emissions, ensuring high-threat areas dampen exploration while discoveries or factory objects proactively attract agents.

## Design ideas to evolve the fields
- Centralize field metadata in a registry so decay/diffusion/deposit rules and intended ranges are discoverable and shared by emission, diffusion, and UI overlays.
- Layer an optional tile-centric view/helper on top of the structure-of-arrays storage so agents can ask for "tile emotions" (raw + derived blends) without bespoke array plumbing.
- Express coupling (fear→curiosity suppression, awe buffers, noise spillover, etc.) via a declarative table to make interactions easier to tune and extend.
- Consider derived blends such as "hazard" or "interest" channels to reduce per-agent recomputation while keeping raw fields untouched.
- See `docs/emotion_field_brainstorm.md` for a fuller brainstorm on storage, coupling, and agent-read ergonomics.
