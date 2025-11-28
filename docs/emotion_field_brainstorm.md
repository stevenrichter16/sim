# Emotion field design brainstorm

This note collects forward-looking ideas for how the emotion/psychology fields could be structured, stored, and consumed by agents. The aim is to make field semantics clearer, reduce per-frame overhead, and give agents consistent APIs for reasoning about their surroundings.

## Goals
- Keep fields self-documenting: name, intent, units, and expected range are discoverable in one place.
- Make field math predictable: shared clamping/decay/diffusion rules instead of ad-hoc scaling.
- Improve agent ergonomics: expose "what matters here" queries rather than requiring agents to combine raw arrays each tick.
- Preserve performance: avoid unnecessary per-frame allocations and cache common blends (e.g., hazard, interest).

## Structural ideas

### 1) Central field registry
Maintain a registry describing each field (type, units, decay, diffusion, base deposit, coupling rules). This lives next to the config so any field logic references a single source of truth.

Example shape:
```js
const FIELD_REGISTRY = {
  panic:    { kind: 'threat', range:[0,1], decay: 'half-life', diffusionRate: 0.1, baseDeposit: 0.05 },
  aggro:    { kind: 'threat', range:[0,1], decay: 'half-life', diffusionRate: 0.05, baseDeposit: 0.15 },
  curiosity:{ kind: 'interest', range:[0,1], decay: 'half-life', diffusionRate: 0.08, baseDeposit: 0.08 },
  awe:      { kind: 'interest', range:[0,1], decay: 'half-life', diffusionRate: 0.04, baseDeposit: 0.04 },
  noise:    { kind: 'signal', range:[0,1], decay: 'half-life', diffusionRate: 0.12, baseDeposit: 0.2 },
  blood:    { kind: 'marker', range:[0,1], decay: 'half-life', diffusionRate: 0.03, baseDeposit: 0.25 },
  discovery:{ kind: 'marker', range:[0,1], decay: 'half-life', diffusionRate: 0.02, baseDeposit: 0.12 },
};
```

Benefits:
- Field creation/reset uses the registry (no orphan fields).
- Emission functions can be data-driven (e.g., `depositFromConfig` reads `baseDeposit` from the registry entry instead of the global config).
- Future UI overlays can show field definitions and ranges without spelunking code.

### 2) Tile-centric storage facade
Currently each field is a separate array (structure-of-arrays) which is fast for diffusion but clumsy for agent reads. Introduce a lightweight facade for tile-level access without abandoning the existing arrays.

Idea: maintain the arrays as-is for diffusion/decay, but add a view helper:
```js
function sampleTileFields(idx){
  return tileViews[idx] ?? (tileViews[idx] = {
    panic: () => world.panicField[idx] ?? 0,
    aggro: () => world.aggroField[idx] ?? 0,
    curiosity: () => world.curiosityField[idx] ?? 0,
    awe: () => world.aweField[idx] ?? 0,
    noise: () => world.noiseField[idx] ?? 0,
    blood: () => world.bloodField[idx] ?? 0,
    discovery: () => world.discoveryField[idx] ?? 0,
    tension: () => world.computedTensionField[idx] ?? 0,
  });
}
```

Notes:
- The view returns closures so agents only read values when needed; nothing is allocated per-tick.
- The backing arrays remain the single source of truth, preserving diffusion performance.
- Tile views can be expanded to include derived blends (see next section).

### 3) Derived blends and channels
Define a small set of derived channels that the simulation updates alongside raw fields. Examples:
- **hazard**: `panic × (1 - safe) + aggro` (similar to tension but reserved for navigation).
- **interest**: `curiosity × (1 - panic) + awe × 0.3` to bias exploration without requiring every agent to recompute suppression/boost rules.
- **noisePressure**: combine `noise` and `blood` to nudge stealthy behavior.

These blends can be updated where `computedTensionField` is currently computed, and exposed via the tile view helper so agents read a stable interface.

### 4) Coupling table instead of hardcoded branches
Replace hardcoded coupling inside `applyFieldCoupling` with a declarative matrix, e.g.:
```js
const COUPLINGS = [
  { source:'panic', target:'curiosity', mode:'suppress', factor:0.7, bufferField:'awe', bufferFactor:0.5, high:0.6, low:0.35 },
  { source:'awe', target:'curiosity', mode:'boost', factor:0.25, threshold:0.3 },
];
```
This makes it easier to add new interactions (e.g., noise dampening curiosity) and tie them back to the registry.

### 5) Compression and persistence hooks
For saved games or large maps, consider:
- RLE/quantization for low-entropy fields like `blood` or `discovery`.
- A dirty-bit mask per field to only serialize tiles that changed meaningfully.
- Optional regional aggregation (chunk-level averages) for faraway agent queries.

## Agent read ergonomics
- Provide `readTileEmotions(idx)` that returns both raw values and derived blends; keep it pure and side-effect-free.
- Offer distance-aware samplers (e.g., `scanFieldsInRadius(agentPos, radius, filter)` returning the top-N tiles by interest/hazard) to avoid repeated bespoke loops in agent behaviors.
- Normalize all agent-facing values to `[0,1]` and document their meaning in the registry so behavior code can be tuned without guessing units.

## Next steps
1. Stand up the registry and refactor `depositFromConfig` to reference it.
2. Implement the tile view helper and derived blends near `updateComputedTension`.
3. Convert `applyFieldCoupling` into a coupling table, keeping awe/fear logic but making it data-driven.
4. Add agent helpers that consume the tile view instead of poking arrays directly.
