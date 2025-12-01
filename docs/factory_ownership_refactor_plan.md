# Factory Ownership Refactoring Plan

## Context for Codex implementers
- **Language & toolchain.** We are standardising on a TypeScript + Vite toolchain. Phase 0 delivers the foundational scaffolding—`tsconfig.json`, Vite build config, ESLint/Prettier rules, Vitest aliases, and updated `package.json` scripts (`npm run lint:factory-ownership`, `npm run test:factory-ownership`, `npm run trace:factory-ownership`). New modules ship in TypeScript immediately; legacy JavaScript stays valid during the transition via `allowJs` and incremental typing, with follow-up tasks to tighten compiler settings once coverage improves.
- **Primary entry points.** The current orchestration lives in `src/factoryOwnership.js`. Snapshot capture touches `src/factory/state/index.js`, while the cluster UI consumes data from `src/cloudCluster/ui/index.js` and state glue in `src/cloudCluster/state/index.js`.
- **Existing bugs to guard against.** Manual links being duplicated, recipe metadata desyncing, and registry churn that drops faction clusters are active regressions motivating this refactor. Tests and tracing should explicitly call these out.
- **Collaboration contract.** Treat the DTO contracts in `src/factoryOwnership/model/` (introduced during Phase 0–1) as the shared language with UI and gameplay systems. Update the accompanying schema + docs whenever a field changes, and keep identifier names descriptive and intent-driven so downstream Codex agents can follow along without tribal knowledge.
- **Workflow tips.** Capture before/after snapshots when modifying allocator behaviour, run the deterministic diff logger locally (`npm run trace:factory-ownership` once it exists) to visualise changes, and check in docstrings whenever domain-specific terminology (e.g., "bioforge reservation") appears.

## Key architectural pressure points
- **What we mean by “transform.”** Throughout this plan a transform is a pure function that accepts an immutable snapshot of simulation data and returns new data structures (ownership entries, cluster objects, link intents) without touching global state. Because transforms are side‑effect free, they can be unit tested in isolation, fed into tooling, and diffed before the runtime commits any mutations.
- **What we mean by “intent.”** An intent is the structured output of a transform describing what should happen—e.g., the objects that should exist in a cloud cluster, which auto links to create, or which smelter recipe to select—without performing the mutation itself. The runtime reads these intents and applies them to the live registry.
- **Monolithic manager hides dependencies.** `createFactoryOwnershipManager` (currently defined in `src/factoryOwnership.js`) reaches into the global `world` object, mutates the cloud cluster registry, and orchestrates linking all in one file, forcing tests to boot large swaths of simulation state to inspect a single behavior.
- **Auto-linker mixes data gathering, mutation, and allocation.** `rebuildFactionClusterLinks` both computes supply/consumer pairings and mutates the live cluster, making it difficult to assert invariants—such as "a blood node may only feed one vat"—without diffing the whole cluster after the fact.
- **Object builders recreate business rules ad hoc.** Each `build*ClusterObject` hand-rolls port derivation from structures and recipes, so validating port shapes or metadata requires re-instantiating the factory rather than inspecting a reusable transform.

### Proposed module layout (post-refactor)
- `src/factoryOwnership/model/` – serialisable DTO definitions, schema validators, and generated types.
- `src/factoryOwnership/transform/` – pure functions that transform snapshots to ownership objects, allocation results, and diff summaries.
- `src/factoryOwnership/runtime/` – orchestration glue that reads from the live world, invokes pure transforms, and commits registry mutations. The runtime layer should be the **only** place that talks to `world`, `ensureFactoryState()`, or other mutable singletons so tests can substitute canned snapshots without stubbing globals.
- `src/factoryOwnership/devtools/` – optional tracing subscribers, diff visualisers, and debug helpers that can be excluded from production bundles.
- All modules must adopt descriptive names for variables, classes, and functions so intent is obvious without cross-referencing implementation details; prefer `allocatedBloodProviderCount` over generic identifiers like `num` or `tmp`.

## Current status (TypeScript migration progress)
- ✅ **Tooling + build output.** `tsconfig.factory-ownership.json` emits `dist/factoryOwnership/**/*`, and `npm run build:factory-ownership` now runs automatically before `test:factory-ownership` and CI suites so reviewers consume the compiled JS.
- ✅ **Pure transforms typed.** `ownershipSnapshot`, `clusterIntents`, and `allocationIntents` have been renamed to `.ts`, run under strict null checks, and their consumers (tests + runtime) import from `dist`.
- ✅ **Runtime extraction.** `clusterRuntime.ts` and `orchestrator.ts` capture inputs, emit DTO bundles, and validate against `FACTORY_OWNERSHIP_SCHEMA_VERSION`. `src/factoryOwnership.js` and scripts pull from the built runtime.
- ✅ **Devtools/UI consumers updated.** `scripts/trace-factory-ownership.mjs` and `src/cloudCluster/ui/index.js` read DTOs from `dist` and log schema mismatches so designers see dropped manual links inside the editor.
- 🔜 **Documentation & integration tests.** This plan (and related docs) still referenced the pre-TypeScript world; update remaining sections as tasks land. Add automated coverage for the UI/CLI diagnostics filtering to guard the new codepaths.

## Solo developer checkpoints
- **Tooling baseline.** TypeScript/Vite configs, lint/test/typecheck scripts, and the factory-ownership DTO contracts (`contracts.ts` + schema helper) are present. Keep `allowJs` on while the rest of the codebase remains JavaScript.
- **Adapter note.** Leave yourself a brief comment/TODO in `src/factoryOwnership.js` describing how the future transform layer will plug in so Phase 1 starts smoothly.
- **Mutation TODO.** Maintain a personal checklist of the side effects in `syncFactionCloudClusters`, `updateFactionCluster`, and `rebuildFactionClusterLinks` that need to become declarative intents.
- **Testing focus.** Plan on adding golden snapshot tests and allocator fuzzing once transforms are extracted. Defer heavier tooling (Storybook, mutation testing) unless a concrete bug demands it.

## Refactoring steps for testability & observability
1. **Split orchestration from pure transforms.**
   - Extract stateless helpers (e.g., `resolveFactoryOwnershipAtTile`, `build*ClusterObject`, `computeAllocationIntents`) so they accept plain data snapshots and return new data structures without mutating global registries.
   - Hoist world access into an explicit `captureOwnershipInputs(world)` helper that freezes the minimal slices of `world.dominantFaction`, `world.controlLevel`, `factory.nodes`, and `factory.structures`. Pass that snapshot through every pure transform instead of reading globals deep in the call stack. While carving this helper out, leave the existing `createFactoryOwnershipManager` in place and pipe its runtime data through the snapshot API so current callers (e.g., `src/factory.js` around line 602) continue working.
   - Extract builders and auto-link logic into pure transforms (`computeOwnershipEntries`, `computeClusterIntents`) so the runtime layer only applies their outputs to the live registry.
   - Publish explicit function signatures (`(worldSnapshot, factorySnapshot) => OwnershipEntries[]`) so tests can construct fixtures without spelunking through runtime objects, and capture them in a `factoryOwnership.d.ts` declaration file for editors.
   - Leave a thin effect layer that invokes these helpers and commits their results back into `setCloudClusterRegistry`, enabling unit tests to exercise the pure transforms with fixture JSON. The effect layer should also own writes to mutable structures (e.g., selecting a new smelter recipe) so transforms can return intent descriptors (`{ nextRecipeKey, justification }`) rather than mutating `structure` objects in place. This reconciles the previous behavioural coupling inside `syncFactionCloudClusters` / `updateFactionCluster` with the new declarative flow.
   - Document the new module boundaries (e.g., `src/factoryOwnership/transform/` for pure code, `src/factoryOwnership/runtime/` for orchestration) to guide future contributions.
   - Add a debug-only guardrail (`assertPureTransformContracts`) that ensures transforms do not accidentally mutate their inputs by freezing fixtures in tests. Couple the guardrail with descriptive failure messages (`"rebuildFactionClusterLinks mutated providerPool"`) so regressions immediately hint at the culprit.
2. **Introduce deterministic snapshot fixtures and golden tests.**
   - Define serialisable DTOs such as `{ nodes, structures, existingLinks }` and expose a `computeFactionClusterSnapshot()` helper that returns `{ objects, links, diagnostics }`.
   - Provide a fixture builder that can compose scenarios via small helper functions (e.g., `withBioforge('neuralWeave')`, `withManualLink('bloodVial')`) to keep tests readable.
   - Back the helper with golden tests that capture snapshots for edge cases (single blood node shared across vats, missing recipes, etc.) so regressions surface immediately, and store generated fixtures alongside an auto-generated README explaining their scenarios.
   - Add regression-focused property tests that fuzz provider/consumer counts to ensure the snapshot stays internally consistent under randomized layouts, seeding the RNG from test names so failures are reproducible.
   - Provide helper macros (e.g., `expectSnapshotStable({ scenario, snapshot })`) that automatically compare against approved fixtures and print diffs with semantic annotations (added providers, recipe churn). These helpers double as the bridge between the legacy Vitest runtime state tests and the new snapshot-driven approach until the suite fully migrates.
3. **Layer an explicit allocation engine.**
   - Refactor provider selection within `rebuildFactionClusterLinks` into a pure allocator that tracks provider capacity, chosen consumers, rejection reasons, and manual lock-ins. Start the prototype in `src/factoryOwnership/transform/allocateProviders.js` (new file) and proxy the existing runtime through it so behaviour can be diffed incrementally.
   - Model the allocator state with lightweight classes or tagged unions (e.g., `Available`, `Reserved`, `Exhausted`) so debugging output can reference well-defined states.
   - Emit both the resulting links and an audit log of unfulfilled ports, making it trivial to debug why a node failed to wire, and expose a `validateAllocation()` helper that can be invoked in tests and dev builds.
   - Support capacity modifiers ("node can serve N consumers") through a unified `capacity` property so future balance patches do not require rewiring the allocator.
   - Include a deterministic tie-breaker (e.g., stable sort by tile position + structure id) so allocator results stay reproducible across runs and platforms. Capture the tie-breaker strategy in tests so future contributors can reason about how two nerve nodes compete for the same vat without re-reading allocator internals.
   - Enforce self-documenting identifiers within the allocator (e.g., `providerReservationMap`, `pendingConsumerQueue`) to make data flow legible during reviews and tracing sessions.
4. **Generate factory-object definitions from shared templates.**
   - Replace bespoke metadata builders with declarative schemas that drive both runtime wiring and tests, keeping recipe/blueprint port shapes consistent. Author the schemas alongside DTO contracts before touching the builders so UI and allocator work off identical definitions from the outset.
   - Store the schemas alongside migration scripts so updates to recipe definitions automatically patch old snapshots in tests.
   - Centralise these templates so they double as documentation for UI and simulation consumers, and generate TypeScript types from the schema to catch drift at compile time.
   - Provide a schema linter that checks for missing localisation keys, port labels, or incompatible combinations (e.g., intake/outtake mismatches) during CI.
   - Document naming conventions alongside each schema to ensure downstream generated types (e.g., `BioforgeIntakePortDefinition`) remain descriptive and unambiguous.
5. **Add invariant checks and tracing hooks.**
   - After computing snapshots, run assertion helpers (e.g., `assertNoDuplicateProviders`, `assertAllAutoLinksResolvable`) that throw with actionable messages.
   - Surface invariant failures through a dedicated `factoryOwnership:warning` channel so they can be toggled in devtools without polluting production logs.
   - Allow integration tests or the editor to subscribe to lifecycle events ("ownership entry generated", "auto link pruned") without sprinkling console logs through production code.
   - Bundle quick opt-in toggles (query-param or dev console command) to activate deep tracing in live builds, aiding QA without requiring code changes.
   - Require tracing payloads to use explicit property names (`resolvedProviderId`, `previousLinkCount`) rather than single-letter keys so logs remain readable months later.
6. **Introduce a deterministic diff & tracing layer.**
   - Before mutating the live registry, compute an explicit diff structure such as `{ addedObjects, removedObjects, addedLinks, removedLinks }` by comparing the previous and next snapshots. Insert the diff calculator directly after `ensureFactoryCloudRegistry` normalises its cache so even the "initial bootstrap" path records consistent mutations.
   - Version the diff schema (`v1`, `v2`, …) so tooling and tests can deserialize historical diffs even as metadata grows.
   - Emit the diff through a structured logger or devtools hook so debugging sessions can visualise exactly which providers were reused, and tests can snapshot the diff to ensure recipe metadata, port layouts, and provider counts stay consistent across scenarios.
   - Expose a pluggable subscriber API (`onRegistryDiff(diff, context)`) that both automated tests and in-editor diagnostics can hook into, enabling side-channel metrics (e.g., link churn counters) without modifying the core allocator.
   - Persist the most recent diff into a ring buffer (per faction) so developers can query historical changes from devtools and correlate them with in-game actions.
   - Provide sample JSON payloads and TypeScript types for diffs in the documentation to accelerate tooling integration. If TypeScript is deferred, ship JSDoc typedefs as an interim solution so tooling still benefits from descriptive field names.
   - Standardise descriptive naming within diff objects (`addedBioforgeLinks`, `removedSupplyNodes`) to prevent ambiguous field proliferation over time.

7. **Manual link reconciliation & reservation tracking.**
   - Model manual wires explicitly inside the allocator by seeding it with `ReservedProvider` entries that consume a provider’s capacity before auto-wiring begins; this prevents issues like a single blood node feeding two vats.
   - Persist manual reservations inside the snapshot (`existingManualLinks`) so tests can cover hybrid scenarios where some inputs are hand-wired and others are auto-selected.
   - Emit reconciliation diagnostics (`{ preservedLinks, supersededLinks, missingManualTargets }`) through the diff/tracing layer so QA can spot when a manual link was dropped or auto-assigned unexpectedly.
   - Document how UI actions update the reservation set and ensure naming reflects intent (e.g., `manualProviderReservations` rather than `manualLinks`) to keep cross-team communication precise.

8. **Registry lifecycle isolation.**
   - Replace `ensureFactoryCloudRegistry`’s in-place mutation with an immutable `cloneRegistry()` helper so tests can diff pre- and post-sync registries without side effects.
   - Introduce a `commitRegistryDiff(registry, diff)` function inside `runtime/` that owns all mutations and can be wrapped with the deterministic diff logger.
   - Assert in development builds that registry order is stable and matches the snapshot’s faction ordering, logging descriptive errors when orphaned cluster IDs linger after removal.

### Data contracts & type definitions
```ts
// Modelled in src/factoryOwnership/model/contracts.ts
export interface FactionOwnershipSnapshot {
  nodes: FactoryNodeDTO[];
  structures: StructureDTO[];
  existingLinks: LinkDTO[];
  existingManualLinks: LinkDTO[];
}

export interface AllocationResult {
  links: LinkDTO[];
  rejectedPorts: RejectionLogEntry[];
  auditTrail: AllocationAuditEntry[];
}

export interface RegistryDiffV1 {
  addedObjects: ClusterObjectDTO[];
  removedObjects: ClusterObjectDTO[];
  addedLinks: LinkDTO[];
  removedLinks: LinkDTO[];
  metadataChanges: MetadataDelta[];
  preservedManualLinks: LinkDTO[];
  droppedManualLinks: LinkDTO[];
}
```
- Co-locate JSON schema files with these interfaces and validate them at runtime in development builds using `ajv` or a similar lightweight validator.
- Generate API docs from the contracts so downstream consumers (e.g., UI layer, external tooling) can rely on stable field names and types.

## Implementation roadmap
- **Phase 0 – Tooling & contract scaffolding.** Stand up the TypeScript/Vite toolchain (compiler config, Vite build entry, ESLint/Prettier presets, Vitest aliases), add the new npm scripts, and publish the initial DTO contract files (typed, even if they wrap existing JS shapes). Include migration notes for mixed TS/JS usage and CI jobs that exercise the new scripts so later phases build on a typed foundation. Contracts live in `src/factoryOwnership/model/contracts.ts` with a companion JSON schema (`contracts.schema.json`) and `schemas.ts` helper for runtime validation wiring.
- **Phase 1 – Extract pure transforms.** Land module splits, the snapshot capture helper, and fixture builders together so subsequent phases can rely on the new APIs. Ensure existing integration tests continue to pass by retaining the orchestration shim.
- **Phase 2 – Allocation engine & invariants.** Replace the current linker logic with the allocator, wiring invariant checks behind a debug flag initially, then defaulting them on after burn-in. Include manual reservation support in this phase so tests confirm a blood node cannot serve two vats.
- **Phase 3 – Schema-driven builders.** Introduce shared templates and migrate smelter/constructor builders over one at a time, accompanied by golden snapshot updates and naming audits.
- **Phase 4 – Diff, tracing, & registry commits.** Implement the diff calculator, structured logging, subscriber API, and `commitRegistryDiff()` entry point. Update integration tests to assert against emitted diffs for critical scenarios (e.g., manual link preservation, recipe churn).
- **Phase 5 – Manual reconciliation UX hooks.** Wire the editor/runtime to emit reservation updates, expose reconciliation diagnostics in devtools, and document manual-link workflows for QA.
- **Phase 6 – Tooling polish.** Add devtools visualisations for diffs and allocation logs, and document workflows for adding new schemas, allocator constraints, or snapshot capture extensions.
- **Phase 7 – Rollout governance & fallback paths.** Ship the refactor behind faction-specific feature flags and preserve adapters that can translate between the new diff outputs and the legacy registry format. Document an explicit rollback playbook (reverting to the adapter while retaining telemetry) so on-call engineers can stabilise production quickly if unforeseen edge cases emerge.
- **Phase 8 – Post-launch hardening.** After the new stack is live, schedule a hardening phase focused on perf tuning, invariant coverage audits, and removing deprecated compatibility layers. Capture learnings in the runbook and backlog any follow-up schema or tooling gaps surfaced during rollout.

## Optional future polish
- Add diff subscribers, telemetry, or visualisers if debugging needs more visibility once the allocator is live.
- Introduce concurrency guards (`commitRegistryDiff()` mutex/debounce) only if overlapping updates show up in practice.
- Layer in audit logs or sanitised exports if you start sharing traces externally.
- Revisit mutation testing, Storybook scenarios, or schema migration tooling after the core transform work stabilises.

## Testing & verification strategy
- Start with targeted unit tests for the extracted transforms and allocator. Layer golden snapshots once the DTO pipeline is in place.
- Use property/fuzz tests for provider/consumer graphs to guard the “one blood node per vat” invariant when you have time.
- Keep an eye on performance by logging before/after timings locally; formal benchmarking can wait until you see regressions.

## Risks & mitigations
- **Refactor scope creep.** Keep the focus on the ownership bugs (manual link duplication, recipe desync, registry churn). Defer unrelated feature ideas.
- **Performance regressions.** Compare old vs. new snapshots periodically; roll back or profile if the diff layer adds noticeable cost.
- **Schema drift.** Update `contracts.ts` and the JSON schema together; the TypeScript compiler will flag mismatches as you convert callers.

## Naming conventions for self-documenting code
- Use descriptive, domain-specific identifiers for variables, classes, and functions—avoid single-letter or legacy abbreviations unless the domain mandates them.
- Mirror intent in names: e.g., `synchronizeFactionClusterRegistry()` instead of `syncClusters()`, `bloodVialSupplyNode` instead of `node1`.
- Apply consistent suffixes/prefixes to communicate roles (`*Snapshot`, `*Diff`, `*Allocator`, `is*`, `has*`). Document deviations directly in code comments.
- Require reviews to block on vague naming; add lint rules (e.g., custom ESLint rule set) to forbid placeholders such as `data`, `obj`, or `tmp` in exported APIs.
- Encourage docstrings and JSDoc annotations to complement naming, especially when domain terms are novel, so new contributors can map identifiers to gameplay concepts quickly.

## Testing
⚠️ Tests not run (documentation-only change).
