# Cloud Cluster Plan

## Recommended scaffolding

- **Domain modeling (`src/cloudCluster/domain/`):**
  - Define persistent `Cluster`, `FactoryObject`, and `Link` records that wrap existing `FactoryKind` entries so cluster metadata (name, flavor text, routing rules) is centralized while still pointing to the canonical recipes and stats already declared in the factory module.
  - Add serialization helpers to convert between in-memory cloud cluster state and save-game payloads, alongside JSON schema definitions in `docs/schemas/cloud-cluster/` for validation in the UI/editor.

- **State & runtime services (`src/cloudCluster/state/` and `src/cloudCluster/sim/`):**
  - Introduce a `cloudClusterState` singleton that mirrors how `world.factory` is currently created/reset, so the “cloud” collection can be bootstrapped with the rest of the simulation lifecycle.
  - Provide simulation workers that resolve throughput, check routing cycles, and emit telemetry snapshots consumable by both UI overlays and scripting events.

- **UI integration (`src/ui/cloudCluster/`):**
  - Build a graph-based editor surface that consumes the domain schemas, supporting drag-to-connect flows, port validation, and inspector panels for smelter/constructor recipes. Persist edits through a lightweight command API served from the new state layer.
  - Extend existing render hooks so the “cloud” inventory surfaces in tooltips and scenario diagnostics without disturbing current grid rendering.

- **Tooling & data fixtures (`data/cloudClusters/`, `tests/cloudCluster/`):**
  - Maintain example cluster presets and vitest suites covering domain validation, serialization, and routing edge cases, keeping parity with current simulation test layout.

## Implementation approach plan

1. **Foundations:** Implement the domain models, schemas, and serialization helpers; add conversion utilities to load/save clusters through `world.factory` so the save pipeline stays coherent.
2. **Simulation services:** Layer in routing validation, throughput calculators, and telemetry publishers, ensuring they reuse existing recipe data and timing constants for smelters/constructors to avoid duplication.
3. **UI workflow:** Build the graph editor, palette, and inspector components incrementally, wiring them to the new state APIs and adding real-time feedback (errors, throughput hints) sourced from the telemetry channel.
4. **Persistence & tooling:** Backfill fixture data, unit/integration tests, and documentation so scenario authors can script against cloud clusters; expose helper commands for importing/exporting clusters during scenario compilation.

## Testing

⚠️ Tests not run (not requested).
