# Tag-Based Interaction System

## Goals
- Replace bespoke pairwise reaction functions with configurable data.
- Allow new materials or environmental effects to be introduced via tags.
- Support layered influences (local, regional, global) without additional hard-coded control flow.

## Core Concepts

### Entities
Anything that can participate in reactions exposes a set of tags and scalar attributes.
- **Strings / Materials**: fire tiles, oxygen pockets, water, agents, etc.
- **Environment Cells**: ambient oxygen, heat fields, vents, walls.
- **Transient Effects**: cryofoam pulses, sparks, medics' aura.

### Tags
Tags are lightweight descriptors. Each tag has an identifier and optional payload:
```
Tag = {
  id: "state.fire",           // dot-namespace for clarity
  value: 1.0,                  // optional scalar, default 1
  ttl: 0 | undefined           // optional fade-out timer
}
```
Recommended categories:
- `state.*` (state.fire, state.foam, state.agent)
- `element.*` (element.oxygen, element.hydrogen)
- `temp.*` (temp.hot, temp.cold)
- `phase.*` (phase.sync, phase.offbeat)
- `volatility.*` (volatility.high, volatility.inert)
- `effect.*` (effect.stun, effect.heal)

### Attributes
Attributes are numeric fields the simulation already tracks (amplitude, tension, heat, oxygen, phase). Tags provide context; rules specify how attribute deltas are applied.

## Interaction Rules
Rules describe how tag combinations yield effects.
```
Rule = {
  id: "oxidation.fire",
  priority: 50,                     // higher runs later
  when: {
    actor: { includes: ["state.fire"] },
    target: { includes: ["element.oxygen"], excludes: ["state.foam"] },
    context: { any: ["env.oxygen-rich"] }
  },
  effects: [
    { target: "actor", attr: "amplitude", op: "add", amount: 0.05, scaleBy: "target.value" },
    { target: "target", attr: "oxygen", op: "add", amount: -0.04 },
    { target: "both", tag: { id: "phase.sync", value: 0.2 }, mode: "refresh" }
  ],
  visuals: [{ type: "spark", intensity: 0.6 }]
}
```
- **`when` clause** matches collections of tags on actor/target plus optional global tags.
- **`effects`** apply attribute changes or mutate tags; `scaleBy` references another attribute or tag value for proportional responses.
- Effects can be additive (`op: "add"`), multiplicative (`"mul"`), or clamp operations (`"clamp"`).
- Tag mutations (`mode: "refresh"`, `"remove"`, `"add"`) let rules manipulate future interactions.

## Evaluation Pipeline
1. **Tag Assembly**: Each tick, build actor/target tag lists from base definitions, dynamic telemetry (heat, oxygen), and queued transient tags.
2. **Candidate Search**: Index rules by tag IDs to quickly gather plausible matches.
3. **Matching**: Evaluate `includes`/`excludes`/`any` conditions. Support fuzzy comparisons (`phaseDelta < threshold`) by emitting derived tags like `phase.sync` ahead of matching.
4. **Resolution**: Sort matched rules by `priority`, then apply effects in order. Aggregated attribute deltas are queued and applied once per tick to avoid feedback oscillations.
5. **Decay & Diffusion**: After interactions, reduce tag TTLs, remove expired entries, and run existing diffusion models (heat, oxygen).

## Example Data Snippets
### Material Definitions (`src/data/materials.json`)
```
{
  "fire": {
    "baseTags": ["state.fire", "temp.hot", "volatility.high"],
    "attributes": { "amplitude": 1.0, "tension": 0.1, "phase": 0.4 }
  },
  "oxygenPocket": {
    "baseTags": ["element.oxygen"],
    "attributes": { "oxygen": 0.21, "volatility": 0.6 }
  }
}
```

### Rule Table (`src/data/rules.json`)
```
[
  {
    "id": "fire-oxygen",
    "priority": 40,
    "when": {
      "actor": { "includes": ["state.fire"] },
      "target": { "includes": ["element.oxygen"] }
    },
    "effects": [
      { "target": "actor", "attr": "amplitude", "op": "add", "amount": 0.06, "scaleBy": "target.oxygen" },
      { "target": "target", "attr": "oxygen", "op": "add", "amount": -0.05 },
      { "target": "context", "tag": { "id": "env.oxygen-rich", "value": -0.02 }, "mode": "add" }
    ]
  },
  {
    "id": "oxygen-recovery",
    "priority": 10,
    "when": {
      "actor": { "includes": ["element.oxygen"], "excludes": ["state.fire"] }
    },
    "effects": [
      { "target": "actor", "attr": "oxygen", "op": "lerp", "to": 0.21, "rate": 0.05 }
    ]
  }
]
```

## Implementation Notes
- **Caching**: Maintain per-tile caches of active tags to avoid rebuilding everything each tick; mark dirty when underlying attributes change significantly.
- **Performance**: Use bitsets or small integer IDs for common tags to speed comparisons.
- **Debugging**: Add a dev overlay that lists matched rules and resulting deltas per tile.
- **Testing**: Unit tests load rules and simulate miniature interactions (fire + oxygen) to assert delta sums and tag mutations.
- **Migration Path**: Phase reactions in by replicating current behaviors in rule data, then delete bespoke functions once parity tests pass.

## Benefits
- Designers tweak behavior from data files without touching simulation code.
- Complex scenarios (e.g., three-way interactions) described declaratively through layered rules.
- Extensible for future materials or AI behaviors by adding tags and rules rather than branching logic.
