# Scenario Runtime Integration Module (SRIM)

This implementation plan turns the existing scripting toolchain (lexer → parser → compiler → VM) into an integrated runtime that drives scenario scripts inside the simulation loop. It scopes required deliverables, sequencing, owners, and validation so work can progress in predictable TDD-sized slices.

## 1. Objectives
- Instantiate the compiled scenario bytecode at simulation start, applying deterministic seed configuration.
- Provide a host binding surface that maps script natives (`ignite`, `spawnAgent`, etc.) to the existing simulation subsystems with capability enforcement and diagnostics.
- Invoke scenario entry points (`onInit`, `onTick`) at the correct times within `stepSimulation`, honoring per-tick instruction budgets and watchdog outcomes.
- Surface runtime errors, watchdog violations, and capability denials to both logs and the in-game diagnostics overlay.
- Ensure scenario-owned entities and effects are tracked for cleanup and hot reload flows.

## 2. Deliverables
1. **`src/script/runtime.js`** — SRIM owner exporting `createScenarioRuntime({ getSettings, diagnostics })`.
2. **Integration hooks in `src/simulation.js`** — load compiled scenario payloads, wire `onInit`/`tick`, teardown on reset/hot reload.
3. **Host binding registry** — deterministic RNG adapter, capability map, native wrappers leveraging `scenarioIgnite`, `spawnNPC`, `fieldWrite`, etc.
4. **Diagnostics channel** — structured payloads (`type`, `message`, `chunk`, `span`, `tick`, `native`) delivered to logger + `world.spawnDiagnostics` (or successor).
5. **Tooling updates** — CLI entry for compiling scripts, configuration for selecting scenario bytecode.
6. **Test suites** — Vitest specs asserting runtime lifecycle, native dispatch, capability enforcement, and error propagation.

## 3. Milestones & Sequencing
### M1: Runtime Skeleton
- Load compiled JSON payload (`chunks`, `constants`, `nativeIds`, `entryPoints`).
- Instantiate VM via `createScenarioVM`.
- Provide `bootstrap(settings)` and `tick(frame, dt)` hooks returning `{ status, error }`.
- Tests: verify stub natives invoked, watchdog errors surface.

### M2: Host Bindings
- Implement deterministic RNG wrapper, `schedule`, `ignite`, `spawnAgent`, `switchFaction`, field read/write proxies.
- Introduce capability configuration and per-native validation.
- Tests: native call success path, capability denial, error handling.

### M3: Simulation Integration
- Integrate SRIM into `stepSimulation` before agent updates; ensure `onInit` invoked once on reset.
- Wire cleanup/hot reload using `state.cleanupScenarioArtifacts`.
- Tests: integration harness running simplified simulation step, verifying native effects applied.

### M4: Diagnostics & Tooling
- Emit structured diagnostics to logger/test double; expose last runtime error in `world`.
- Add `npm run compile-scripts` placeholder invoking compiler pipeline.
- Tests: runtime error path populates diagnostics target; CLI script returns non-zero on compilation failure (mocked).

### M5: Watchdog & Scheduling Hardening
- Propagate per-tick instruction budgets from config.
- Validate deferred `schedule` tasks execute at expected frames.
- Tests: scheduled task invocation order, watchdog budget exhaustion halting script.

## 4. API Contracts
### `createScenarioRuntime(options)`
| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `compiled` | `CompiledProgram` | yes | Output of `compileProgram`. |
| `capabilities` | `Set<string>` | no | Capabilities enabled for scenario script. |
| `natives` | `Record<string, NativeBinding>` | no | Overrides for default host bindings. |
| `diagnostics` | `{ log(event) }` | no | Callback receiving structured events. |

Returns `{ runInit(seed), tick(frame, dt), dispose(), getStatus() }`.

### Diagnostics Event Payload
```ts
type ScenarioDiagnostic = {
  type: 'info' | 'error' | 'watchdog' | 'native-denied',
  message: string,
  chunk: string | null,
  span: Span | null,
  tick: number | null,
  native?: string | null,
  data?: Record<string, unknown>,
};
```

## 5. Capability Matrix
| Native | Capability | Notes |
|--------|------------|-------|
| `ignite` | `fire.write` | Uses `scenarioIgnite`. |
| `spawnAgent` | `agent.spawn` | Returns agent ID. |
| `switchFaction` | `agent.switch` | Validates handle. |
| `agentTile` | `agent.read` | Returns tile index for an agent handle. |
| `agentCount` | `agent.read` | Counts agents, optionally by faction. |
| `agentIds` | `agent.read` | Returns filtered agent IDs (capped). |
| `fieldWrite` | `field.write` | Clamps values. |
| `field`/`tileField` | `field.read` | Read-only. |
| `rand`/`randRange`/`randTile` | `rng.use` | Delegates to deterministic RNG. |
| `schedule` | `runtime.schedule` | Already provided by VM. |
| `emitEffect` | `effects.emit` | Bridges to `emitParticleBurst` / `emitFlash`. |
| `logDebug` | `diag.write` | Diagnostics channel. |

Default capability set for scenarios: `{ 'fire.write', 'agent.spawn', 'agent.switch', 'agent.read', 'field.write', 'field.read', 'rng.use', 'runtime.schedule', 'effects.emit', 'diag.write' }`.

## 6. Testing Strategy
- **Unit Tests (`tests/scenario.runtime.test.js`)**
  - SRIM boots VM and calls `onInit` once with seed.
  - `tick()` runs `onTick`, returning VM results (success/error).
  - Native bindings invoked with deterministic RNG; capability denial raises error.
  - Scheduled tasks executed at correct frames.
- **Integration Tests (`tests/scenario.integration.test.js`)**
  - Simulated `stepSimulation` loop with SRIM stub ensures scenario-owned entities tracked.
  - Hot reload triggers `cleanupScenarioArtifacts`.
- **Tooling Tests**
  - `tests/compile.cli.test.js` drives the `compile-scripts` CLI end-to-end, producing JSON assets with capabilities metadata.
  - `tests/scenario.asset.load.test.js` loads the compiled asset through the simulation, enforcing capability gating (e.g., `runtime.schedule`) and verifying error propagation.

Each test begins red (failing), then drive implementation to green, with refactors after green.

## 7. Risks & Mitigations
- **Circular dependencies** between `simulation.js` and SRIM: keep SRIM in `src/script/runtime.js`, inject dependencies rather than import `simulation.js` wholesale.
- **Capability drift** as new natives added: centralize capability definitions in SRIM to avoid scattering logic.
- **Performance regressions** from diagnostics: throttle logging to once per frame per error type; use lightweight objects.
- **Hot reload consistency**: rely on existing `cleanupScenarioArtifacts` and ensure SRIM reset clears schedule queue and VM state.

## 8. Work Breakdown (Initial Sprint)
1. Add SRIM unit-test harness (failing).
2. Implement minimal SRIM loader with deterministic native scaffolds.
3. Integrate with simulation (guarded behind feature flag until stable).
4. Extend host bindings & diagnostics incrementally.

The following sections will be updated as milestones complete, including test coverage tables and dependency notes.

## 9. Tooling Pipeline Snapshot
- Run `npm run compile-scripts` to compile every `.sscript`/`.scenario` under `scenarios/` into JSON bytecode assets in `data/scenarios/`.
- Each asset includes the serialised bytecode payload plus a `capabilities` array (defaults to the SRIM bundle including `runtime.schedule`) and metadata about the source file and generation time.
- `createSimulation` exposes `loadScenarioAsset(asset)` which materialises the JSON back into bytecode, seeds the runtime, and honours the declared capabilities. Missing capabilities (e.g., omitting `runtime.schedule`) raise runtime errors surfaced via `getScenarioStatus()`.
- CLI sidecar configs (`*.config.json`) can override the asset name and capability manifest while reusing the same source script, enabling content authors to gate natives explicitly.
- **Quick usage**:
  ```bash
  # compile scripts from the default ./scenarios folder
  npm run compile-scripts
  # compile from a custom source/output directory
  npm run compile-scripts -- --src ./designer-scenarios --out ./data/scenarios
  ```
