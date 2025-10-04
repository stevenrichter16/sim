# Stigmergic Tag Modulation

## Guiding Principles
- **Local-only rules**: keep interactions driven by existing diffusion/coupling math; no global rule dispatcher.
- **Tags as coefficients**: tags supply weights, phase offsets, or decay rates that feed into the shared fields (heat, O₂, amplitude) instead of branching behavior.
- **Shared medium first**: heat, oxygen, tension, and phase remain the mediums through which agents communicate; tags only modulate how strongly a material imprints on or senses those fields.
- **Dynamic feedback**: derived tags emerge from gradients in the medium (e.g., `env.o2.high` when local oxygen exceeds a rolling mean). No fixed thresholds sprinkled through code; let simple filters generate them.
- **Composable, not combinatorial**: each tag contributes an independent tweak. Multiple tags stack multiplicatively or additively without needing explicit pairwise rules.

## Tag Schema
```
Tag = {
  id: 'phase.sync',
  weight: 0.8,           // multiplier applied to relevant coefficients
  decay: 0.98,           // optional per-tick decay for transient tags
  source: 'phase-field'  // producer that emits/updates this tag
}
```
Tag identifiers live in namespaces (`state.fire`, `element.oxygen`, `env.o2.high`). Tags never encode actions; they describe material qualities or sensed conditions.

## Coefficient Tables
Store per-tag contributions in small lookup tables. Examples:
- **Emission coefficients** determine how a tag alters the material’s imprint on a field.
```
emissionCoefficients = {
  heat: {
    'state.fire': +1.2,
    'temp.cold': -0.4,
    'behavior.cooling': -0.7,
  },
  o2: {
    'behavior.oxidizer': -0.5,
    'behavior.extinguishing': +0.2,
  }
};
```
- **Coupling modifiers** adjust the strength/phase of the generic coupling function.
```
couplingModifiers = {
  gain: {
    'phase.sync': +0.3,
    'phase.offbeat': -0.5,
    'insulation.high': -0.6,
  },
  phaseDrift: {
    'behavior.combusting': +0.15,
    'behavior.extinguishing': -0.1,
  }
};
```
Each table is additive: final coefficient = base value + sum(tag weights * table entry). No rule explosion; a new tag just adds one row.

## Runtime Flow
1. **Tag Assembly**
   - Base tags come from mode definitions.
   - Derived tags emitted by field observers (e.g., `env.o2.high` from oxygen diffusion analyzer that compares the cell’s O₂ to a smoothed neighborhood mean).
   - Transient tags decay via their `decay` factor each tick.

2. **Field Update**
   - When updating heat/O₂ fields, compute each tile’s emission coefficient from its tags and add to the diffusion source term.
   - Example: fire tile heat source = baseHeat + Σ(tagWeight * emissionCoefficients.heat[tagId]).

3. **Coupling & Phase**
   - `couple(A, B)` returns the shared magnitude. Modify it by combining both entities’ tags:
     - gain = baseGain * exp(Σ modifiers from A tags + modifiers from B tags).
     - preferred phase shift = Σ phaseDrift contributions.
   - This keeps `couple` continuous and stigmergic; tags only bias strength.

4. **Response**
   - Agent/material state updates (amplitude, tension) use the modulated coupling value. No bespoke reactions—just different numeric responses based on tags present.

5. **Decay / Diffusion**
   - After applying updates, decay transient tag weights. Derived tags recompute naturally next frame from field observers, creating feedback loops.

## Example: Fire + Oxygen
- Fire tile tags: `['state.fire', 'behavior.combusting', 'volatility.high']`.
- Oxygen tile tags: `['element.oxygen', 'env.o2.high']`.
- Heat emission = baseHeat + contributions from `state.fire` (+1.2) and `volatility.high` (+0.4).
- Coupling gain = baseGain * exp(+0.3 from `volatility.high` + 0.0 from oxygen tag).
- Oxygen consumption = baseSink + Σ tag contributions (`behavior.combusting` = -0.6). The stronger the coupling, the more the sink draws from the shared O₂ field.
- No explicit “fire meets oxygen” rule—the emergent effect comes from each tag’s coefficients.

## Implementation Notes
- **Data format**: store coefficient tables in JSON (e.g., `data/tag-coefficients.json`). Each entry lists additive offsets or multipliers.
- **Normalization**: when summing contributions, clamp only if the field demands (e.g., O₂ ≥ 0). Avoid blanket `clamp01` to preserve gradients.
- **Derived tags**: implement observers as pure functions `(world, idx) -> tagWeight`. Examples:
  - Oxygen observer: compare `world.o2[idx]` to an exponential moving average of neighbors.
  - Heat observer: issue `env.overheated` when heat exceeds mean + σ.
  - Phase observer: issue `phase.sync` when local phase variance < threshold.
- **Debugging**: add instrumentation to output the coefficient breakdown per tile when toggled. That reveals why an interaction intensified or faded.
- **Testing**: snapshot coefficient sums for representative combinations, run mini-sims to ensure expected monotonic responses (e.g., more `volatility.high` ⇒ larger heat emission).

## Migration Strategy
1. **Tag Backbone**: adopt simple tag definitions (Mode → tags) plus derived tag observers.
2. **Coefficient Tables**: map existing behaviors into coefficient sums by matching current numbers (e.g., heat gain from fire) to tag contributions.
3. **Refactor Coupling**: replace discrete reaction functions with the modulated coupling pipeline; keep old outputs side-by-side until parity holds.
4. **Iterate**: once parity achieved, new materials are just tag bundles + coefficient rows.

## Benefits
- **Stigmergic**: all influence flows through shared fields; no central rule arbiter.
- **Composable**: adding a tag tweaks coefficients globally without combinatorial explosion.
- **Mod-friendly**: mods append rows to coefficient tables, introduce new tags, or new observers.
- **Predictable**: designers see how tags bias the math; players read tags to infer tendencies.
