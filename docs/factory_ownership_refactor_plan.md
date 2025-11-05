# Factory Ownership Refactoring Plan

## Context for Codex implementers
- **Language & toolchain.** The current repository is vanilla ESM JavaScript executed directly in the browser (see `package.json` scripts). Phase 0 of this roadmap introduces any TypeScript definitions, build tooling, or lint/test scripts that the later phases rely on. Until those scaffolds land, lean on the existing `npm test` / `npm run dev` flows and stage new commands in separate commits so CI changes remain reviewable.
- **Primary entry points.** The current orchestration lives in `src/factoryOwnership.js`. Snapshot capture touches `src/factory/state/index.js`, while the cluster UI consumes data from `src/cloudCluster/ui/index.js` and state glue in `src/cloudCluster/state/index.js`.
- **Existing bugs to guard against.** Manual links being duplicated, recipe metadata desyncing, and registry churn that drops faction clusters are active regressions motivating this refactor. Tests and tracing should explicitly call these out.
- **Collaboration contract.** Treat the DTO contracts in `src/factoryOwnership/model/` (introduced during Phase 0–1) as the shared language with UI and gameplay systems. Update the accompanying schema + docs whenever a field changes, and keep identifier names descriptive and intent-driven so downstream Codex agents can follow along without tribal knowledge.
- **Workflow tips.** Capture before/after snapshots when modifying allocator behaviour, run the deterministic diff logger locally (`npm run trace:factory-ownership` once it exists) to visualise changes, and check in docstrings whenever domain-specific terminology (e.g., "bioforge reservation") appears.

## Key architectural pressure points
- **Monolithic manager hides dependencies.** `createFactoryOwnershipManager` (currently defined in `src/factoryOwnership.js`) reaches into the global `world` object, mutates the cloud cluster registry, and orchestrates linking all in one file, forcing tests to boot large swaths of simulation state to inspect a single behavior.
- **Auto-linker mixes data gathering, mutation, and allocation.** `rebuildFactionClusterLinks` both computes supply/consumer pairings and mutates the live cluster, making it difficult to assert invariants—such as "a blood node may only feed one vat"—without diffing the whole cluster after the fact.
- **Object builders recreate business rules ad hoc.** Each `build*ClusterObject` hand-rolls port derivation from structures and recipes, so validating port shapes or metadata requires re-instantiating the factory rather than inspecting a reusable transform.

### Proposed module layout (post-refactor)
- `src/factoryOwnership/model/` – serialisable DTO definitions, schema validators, and generated types.
- `src/factoryOwnership/transform/` – pure functions that transform snapshots to ownership objects, allocation results, and diff summaries.
- `src/factoryOwnership/runtime/` – orchestration glue that reads from the live world, invokes pure transforms, and commits registry mutations. The runtime layer should be the **only** place that talks to `world`, `ensureFactoryState()`, or other mutable singletons so tests can substitute canned snapshots without stubbing globals.
- `src/factoryOwnership/devtools/` – optional tracing subscribers, diff visualisers, and debug helpers that can be excluded from production bundles.
- All modules must adopt descriptive names for variables, classes, and functions so intent is obvious without cross-referencing implementation details; prefer `allocatedBloodProviderCount` over generic identifiers like `num` or `tmp`.

## Gap closure checklist (post-Codex review)
- **Tooling confirmation.** Add a tracked task to either (a) adopt TypeScript + Vite and wire dedicated lint/test scripts (e.g., `npm run lint:factory-ownership`, `npm run test:factory-ownership`), or (b) stay on vanilla ESM and scope the roadmap accordingly. Do not begin Phase 1 until the decision is made and the supporting scripts (tsconfig, Vitest aliases, ESLint config) are in place.
- **Transitional adapter plan.** Draft how `createFactoryOwnershipManager` will delegate to the new `transform/` module without breaking current imports (notably `src/factory.js` and any tests that mock the manager). Document this adapter in code comments to ease review.
- **Declarative intent alignment.** Identify every mutation currently performed inside `syncFactionCloudClusters`, `updateFactionCluster`, and the linker (lines 462-520) and classify whether it should become an "intent" output or remain a runtime side effect.
- **Registry lifecycle audit.** Map the call flow from `ensureFactoryCloudRegistry` (lines 91-117) through `setCloudClusterRegistry` and flag where the new diff-driven `commitRegistryDiff()` should intercept mutations. Capture these diagrams in the devdocs so reviewers can trace how data flows today versus post-refactor.
- **Testing footprint expansion.** Update the engineering plan and CI checklist to account for the broader test suite (snapshot approvals, property fuzzing, mutation harness). Make sure reviewers expect the extra runtime.

## Refactoring steps for testability & observability
1. **Split orchestration from pure transforms.**
   - Extract stateless helpers (e.g., `resolveFactoryOwnershipAtTile`, `build*ClusterObject`, `rebuildFactionClusterLinks`) so they accept plain data snapshots and return new data structures without mutating global registries.
   - Hoist world access into an explicit `captureFactoryOwnershipSnapshot(world)` helper that freezes the minimal slices of `world.dominantFaction`, `world.controlLevel`, `factory.nodes`, and `factory.structures`. Pass that snapshot through every pure transform instead of reading globals deep in the call stack. While carving this helper out, leave the existing `createFactoryOwnershipManager` in place and pipe its runtime data through the snapshot API so current callers (e.g., `src/factory.js` around line 602) continue working.
   - Publish explicit function signatures (`(worldSnapshot, factorySnapshot) => OwnershipEntries[]`) so tests can construct fixtures without spelunking through runtime objects, and capture them in a `factoryOwnership.d.ts` declaration file for editors.
   - Leave a thin effect layer that invokes these helpers and commits their results back into `setCloudClusterRegistry`, enabling unit tests to exercise the pure transforms with fixture JSON. The effect layer should also own writes to mutable structures (e.g., selecting a new smelter recipe) so transforms like `selectSmelterRecipeFromCounts` can return intent descriptors (`{ nextRecipeKey, justification }`) rather than mutating `structure` objects in place. This reconciles the current behavioural coupling inside `syncFactionCloudClusters`/`updateFactionCluster` (see `src/factoryOwnership.js`, lines 462-520) with the new declarative flow.
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
- **Phase 0 – Tooling & contract scaffolding.** Decide on the TypeScript/Vite adoption path, land shared ESLint rules for naming, wire Vitest aliases for the new module layout, and publish the initial DTO contract files (even if they only wrap existing JS shapes). Ship `npm run lint:factory-ownership`, `npm run test:factory-ownership`, and `npm run trace:factory-ownership` scripts—even as placeholders—so downstream phases can fill them in.
- **Phase 1 – Extract pure transforms.** Land module splits, the snapshot capture helper, and fixture builders together so subsequent phases can rely on the new APIs. Ensure existing integration tests continue to pass by retaining the orchestration shim.
- **Phase 2 – Allocation engine & invariants.** Replace the current linker logic with the allocator, wiring invariant checks behind a debug flag initially, then defaulting them on after burn-in. Include manual reservation support in this phase so tests confirm a blood node cannot serve two vats.
- **Phase 3 – Schema-driven builders.** Introduce shared templates and migrate smelter/constructor builders over one at a time, accompanied by golden snapshot updates and naming audits.
- **Phase 4 – Diff, tracing, & registry commits.** Implement the diff calculator, structured logging, subscriber API, and `commitRegistryDiff()` entry point. Update integration tests to assert against emitted diffs for critical scenarios (e.g., manual link preservation, recipe churn).
- **Phase 5 – Manual reconciliation UX hooks.** Wire the editor/runtime to emit reservation updates, expose reconciliation diagnostics in devtools, and document manual-link workflows for QA.
- **Phase 6 – Tooling polish.** Add devtools visualisations for diffs and allocation logs, and document workflows for adding new schemas, allocator constraints, or snapshot capture extensions.
- **Phase 7 – Rollout governance & fallback paths.** Ship the refactor behind faction-specific feature flags and preserve adapters that can translate between the new diff outputs and the legacy registry format. Document an explicit rollback playbook (reverting to the adapter while retaining telemetry) so on-call engineers can stabilise production quickly if unforeseen edge cases emerge.
- **Phase 8 – Post-launch hardening.** After the new stack is live, schedule a hardening phase focused on perf tuning, invariant coverage audits, and removing deprecated compatibility layers. Capture learnings in the runbook and backlog any follow-up schema or tooling gaps surfaced during rollout.

## Additional critical considerations
- **Client/UI contract alignment.** Coordinate with the cloud cluster UI owners to adopt the new DTOs and diff payloads in lockstep. Provide stubbed stories (e.g., in Storybook) that feed the UI with recorded diffs and snapshots so front-end regressions surface before full integration. Include acceptance criteria that verify manual link preservation, recipe listings, and allocator audits render as expected.
- **Feature-flag instrumentation.** Track feature flag adoption metrics (percentage of factions using the new allocator, number of diffs emitted per tick) and alert on anomalous spikes. Incorporate these counters into the tracing subscriber so QA and telemetry dashboards can observe rollout health in real time.
- **Runtime concurrency safeguards.** If multiple async systems can trigger ownership syncs, introduce a debounced executor or mutex to ensure only one `commitRegistryDiff()` runs at a time. Document these guardrails and add stress tests that simulate rapid palette edits concurrent with auto-link ticks to confirm idempotency.
- **Data provenance & audit trails.** Persist diff metadata with actor/context information (e.g., `triggeredBy: 'manualLinkEdit'`, `sourceTick`) so future debugging efforts can trace which user or simulation event drove a change. Provide a sanitised export flow for these logs to support QA bug reports without exposing player-sensitive data.
- **Training & documentation.** Expand the developer onboarding guide with a refactor FAQ, architecture diagrams of the new module layout, and a migration checklist for teams extending the allocator or schemas. Host internal walkthroughs to familiarise stakeholders with the diff viewer and snapshot-based testing so the new tooling becomes part of daily workflows.
- **Continuous verification hooks.** Add CI gates that ensure new recipes or node types include schema entries, allocator capacity tests, and golden snapshot updates. Require pull requests touching factory ownership code to attach diff subscriber output for at least one representative scenario, giving reviewers immediate visibility into behavioural changes.

## Testing & verification strategy
- Maintain a suite of golden snapshots under `tests/factoryOwnership/golden/` and add an approval workflow (CI job requiring explicit ack when diffs change) to prevent accidental churn.
- Augment CI with targeted property tests that randomise provider/consumer graphs, ensuring invariants (single-use providers, respect manual links) are enforced.
- Provide a smoke-test harness that runs the allocation engine against live world saves captured from QA, comparing emitted diffs against known-good baselines.
- Capture performance metrics for each phase to confirm the purer transforms, reservation logic, and diff layer do not regress tick times; if they do, document and profile with the new tracing hooks.
- Add contract tests that instantiate historical world saves and assert that the diff output remains compatible (schema version, field presence) before rolling out to QA.
- Introduce mutation tests (using tools like Stryker or a lightweight custom harness) on the allocator to ensure invariants truly guard against double-consumption bugs, including manual reservation edge cases.
- Publish example devtools scripts that consume the diff subscriber API and render allocation graphs, validating end-to-end that the tracing layer surfaces actionable information.

## Risks & mitigations
- **Risk: refactor stalls due to wide surface area.** Mitigation: land Phase 1 with feature flags and maintain backwards-compatible adapters so parallel workstreams can adopt the new APIs gradually.
- **Risk: performance regressions from additional allocations or diff calculations.** Mitigation: benchmark the pure transforms and diff engine against recorded workloads; cache invariant results when inputs are unchanged within a tick.
- **Risk: schema churn breaks saved fixtures.** Mitigation: version JSON schemas and provide migration scripts; enforce approval on schema bumps via CI.
- **Risk: developers bypass pure transforms and mutate runtime state directly.** Mitigation: enforce lint rules/import restrictions that forbid runtime modules from importing pure transform internals without going through public entry points.

## Developer workflow updates
- Document a "writing tests" guide demonstrating how to build fixtures, invoke transforms, and assert on diffs.
- Update the PR checklist to include items for snapshot approvals, schema migrations, and diff-subscriber verification.
- Provide VS Code snippets / tasks that run the golden tests and launch the diff visualiser, lowering the barrier to using the new tooling.
- Add a naming appendix that enumerates preferred prefixes/suffixes (e.g., `Snapshot`, `Allocation`, `Diff`) and illustrates poor vs. strong identifier examples so contributions stay self-documenting.
- Embed the naming guidelines into lint rules (e.g., ESLint custom rule set) and pre-commit hooks that scan for ambiguous identifiers in the factory ownership modules. Pair the automation with reviewer checklists that call out descriptive naming as a hard requirement before merging.

## Naming conventions for self-documenting code
- Use descriptive, domain-specific identifiers for variables, classes, and functions—avoid single-letter or legacy abbreviations unless the domain mandates them.
- Mirror intent in names: e.g., `synchronizeFactionClusterRegistry()` instead of `syncClusters()`, `bloodVialSupplyNode` instead of `node1`.
- Apply consistent suffixes/prefixes to communicate roles (`*Snapshot`, `*Diff`, `*Allocator`, `is*`, `has*`). Document deviations directly in code comments.
- Require reviews to block on vague naming; add lint rules (e.g., custom ESLint rule set) to forbid placeholders such as `data`, `obj`, or `tmp` in exported APIs.
- Encourage docstrings and JSDoc annotations to complement naming, especially when domain terms are novel, so new contributors can map identifiers to gameplay concepts quickly.

## Testing
⚠️ Tests not run (documentation-only change).
