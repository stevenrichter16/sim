# Stigmergic Script VM Integration Plan

This plan adapts the lightweight C-style scripting concept to the existing stigmergic evacuation simulation. The immediate focus is **scenario scripting**: an orchestrator VM that can author complex run setups (random fire seeds, timed faction swaps, scripted hazards). Agent-level scripting remains on the roadmap but is intentionally out of scope until the scenario layer is stable.

## Engine Prerequisites

Before integrating the VM, address the following engine gaps so the scripting ABI behaves as promised:

1. **Stable Agent Handles**
   - Assign persistent IDs when agents are created and keep an `id → index` lookup so host bindings such as `switchFaction(agentId, newFactionId)` and `agentTile(agentId)` can target individuals reliably.
   - Ensure the handle map updates when agents despawn or swap indices to avoid dangling references.

2. **Deterministic Randomness**
   - Replace direct `Math.random()` usage in core constructors (e.g., material generation and mycelium propagation) with calls to the shared deterministic RNG that is seeded for the run. This keeps scenario playback deterministic even when scripts rely on the orchestrator’s seed.

3. **Spawn Validation & Handles**
   - Extend the spawning pipeline to accept explicit tile requests, validate faction/mode combinations, and return the stable agent ID generated above. This powers `spawnAgent(factionId, mode, tileIdx)` and provides immediate feedback on failure.

4. **Fire Ignition Parameters**
   - Update fire/heat routines to accept an intensity parameter, clamping to safe ranges while mutating `world.fire`, `world.strings`, heat, and O₂ consistently. The `ignite(tileIdx, intensity)` native should call through this new path.

5. **Scenario Ownership Tracking**
   - Track which fires, agents, and other mutable entities were created by scenario scripts (e.g., add scenario-owned flags or maintain shadow collections). On hot reload, use this bookkeeping to roll back prior scenario effects before instantiating the new script.

## Architecture Overview

```
script source
   ↓
token stream (lexer tuned for sim keywords)
   ↓
AST (aware of TAP fields & factions)
   ↓
bytecode (ops sized for per-step execution)
   ↓
scenario VM (single instance per run) / future agent fibers
   ↓
host bindings (pheromone IO, TAP mutation, diagnostics)
```

Key constraints:

- Deterministic execution inside `stepSimulation`.
- Bounded per-tick instruction budget to respect existing performance envelopes.
- Safe exposure of simulation data (read-only world tiles unless explicitly granted).

## Language Surface (Scenario-Focused)

- Statements: `let`, `fn`, `if/else`, `while`, `return`, `call`.
- Top-level functions reserved for scenario entry points:
  - `fn onInit(seed)` — runs once after `worldInit`, before the first frame.
  - `fn onTick(frame, dt)` — runs every simulation step; `frame` is an integer tick, `dt` is seconds-equivalent.
- Expressions: arithmetic, comparisons, logical ops, parentheses.
- Built-ins tuned for scenarios:
  - `rand()` / `randRange(min, max)` seeded from the run.
  - `ignite(tileIdx, intensity)` to start fires.
  - `spawnAgent(factionId, mode, tileIdx)` to populate NPCs.
  - `switchFaction(agentId, newFactionId)` for scripted defections.
  - `field(tileIdx, "help")`, `fieldWrite(tileIdx, "route", value)` for field manipulation.
  - `schedule(delayTicks, code)` lightweight scheduler for deferred actions.
- Reserved constants for convenience: `MODE_CALM`, `MODE_PANIC`, `FACTION_A`, etc.

Example scenario script:

```c
let nextIgnite = 45;

fn onInit(seed) {
  let t = 0;
  while (t < 4) {
    call ignite(randTile("open"), 0.6 + rand() * 0.2);
    t = t + 1;
  }
}

fn onTick(frame, dt) {
  if (frame >= nextIgnite) {
    call ignite(randTile("open"), 0.5);
    nextIgnite = frame + 60 + (rand() * 60);
  }
  if (frame % 120 == 0) {
    let agent = selectAgent({ faction: FACTION_A, mode: MODE_CALM });
    if (agent != -1) {
      call switchFaction(agent, FACTION_B);
      call fieldWrite(agentTile(agent), "panic", 0.4);
    }
  }
}
```

## Bytecode Specification (Extended)

| Opcode        | Operands        | Notes |
|---------------|-----------------|-------|
| `PUSH_CONST`  | index           | Constants table stores numbers & strings. |
| `LOAD_LOCAL`  | slot            | Locals per frame. |
| `STORE_LOCAL` | slot            | – |
| `LOAD_UP`     | slot            | Captured agent/environment handles. |
| `STORE_UP`    | slot            | For script-level globals like `cooldown`. |
| `ADD/SUB/MUL/DIV/MOD` | –      | Numeric ops. |
| `CMP_*`       | –               | `LT`, `GT`, `LE`, `GE`, `EQ`, `NE`. |
| `LOGIC_AND`, `LOGIC_OR` | address | Short-circuit jumps. |
| `JMP`         | address         | – |
| `JMPF`        | address         | – |
| `CALL_NATIVE` | nativeId, argc  | Host functions (registered per VM). |
| `CALL_USER`   | functionId, argc| For user-defined helpers. |
| `RET`         | –               | Return value optional. |
| `HALT`        | –               | Safety stop at instruction budget. |

Limits:
- Max locals per stack frame: 16 (configurable per script family).
- Max globals (script `let` at top level): 32 (stored in upvalues).
- Hard instruction cap per tick: 256 (configurable).

## Implementation Roadmap

1. **Engine Backfill (Prerequisites Above)**
   - Land the deterministic RNG plumbing, agent ID map, spawn validation, ignition intensity, and scenario ownership tracking.
   - Add regression tests ensuring these systems remain deterministic under seeded runs.

2. **Lexer & Parser**
   - Extend keyword table with `MODE_PANIC`, `MODE_MEDIC`, `agent`, `field`.
   - Numeric literals stay float; add string literal support for native calls.
   - Parser produces AST nodes carrying source spans for diagnostics overlay.

3. **Compiler**
   - Assign global slots to top-level `let` declarations—persist between ticks.
   - Inject implicit parameters for `onInit(seed)` and `onTick(frame, dt)` entry points.
   - Emit `HALT` when instruction budget would overflow and surface a compile-time error if static analysis detects impossible budgets.

4. **Virtual Machine**
   - Stack + call frames implemented with preallocated arrays to avoid GC.
   - Instruction dispatch uses numeric opcodes (avoid string compare in hot loop).
   - Track execution time; abort script if budget exceeded (flag script as unhealthy) and produce structured diagnostics (file, function, frame).

5. **Host Bindings**
   - Provide curated natives (scenario scope detailed below) using the deterministic RNG and new engine hooks.
   - Validate arguments, clamp values, and enforce per-tick quotas (e.g., max spawns, max ignites) to keep scenarios bounded.

6. **Integration**
   - New registry in `world` storing compiled scripts keyed by scenario ID.
   - During `stepSimulation`, invoke the scenario VM before agent updates so host bindings can enqueue hazards, faction swaps, etc.
   - Provide `dt` derived from `speedMultiplier` to keep scripts time-aware.

7. **Tooling**
   - CLI command `npm run compile-scripts` to precompile `.sscript` files to JSON bytecode placed in `data/scripts`.
   - Editor hooks: highlight syntax errors with line/column info.
   - Unit tests in `tests/scripts.vm.test.js` covering lex/parse/compile/vm/hook contract.

8. **Safety & Sandboxing**
   - Scripts cannot mutate `world.agents` directly; only via host functions that validate indices and clamp outcomes.
   - Instruction watchdog to prevent infinite loops; on violation, disable script and log to diagnostics.
   - Memory cap per script (max globals + stack) to guard against runaway allocations.

## Embed Points in Simulation Loop

- `worldInit`: load compiled scenario bytecode, instantiate a single VM, invoke `onInit(seed)`.
- `stepSimulation` (before agent updates):
  1. Compute frame index and `dt`.
  2. Run `scenarioVM.tick(frame, dt)`; host bindings may enqueue hazards, faction swaps, etc.
  3. Apply queued effects before agents step.
- Diagnostics frame: log instruction count and native call usage for the scenario VM.

## Native Function Reference (Initial Draft)

| Native               | Args                                | Description |
|----------------------|-------------------------------------|-------------|
| `rand`               | –                                   | Returns 0..1 deterministic float. |
| `randRange`          | `min`, `max`                        | Convenience wrapper around `rand`. |
| `randTile`           | `filterKey`                         | Picks a tile meeting a named filter (`open`, `door`, `fireFree`). |
| `ignite`             | `tileIdx`, `intensity`              | Starts/boosts fire via deterministic ignition pipeline. |
| `spawnAgent`         | `factionId`, `mode`, `tileIdx`      | Spawns NPC if tile open; returns agent id or -1. |
| `switchFaction`      | `agentId`, `newFactionId`           | Retargets existing agent (with affinity validation). |
| `agentTile`          | `agentId`                           | Returns tile index or -1 using the agent handle map. |
| `tileField`          | `tileIdx`, `fieldName`              | Returns scalar pheromone (0..1). |
| `fieldWrite`         | `tileIdx`, `fieldName`, `value`     | Writes pheromone with clamp + diffusion seed. |
| `schedule`           | `delayTicks`, `codeId`              | Posts a deferred callback identified by compiled label. |
| `emitEffect`         | `type`, `x`, `y`                    | Bridges to `emitParticleBurst` / `emitFlash`. |
| `logDebug`           | `code`, `value`                     | Sends value to diagnostics overlay.

Each call validates arguments and enforces per-tick quotas to keep scenarios bounded.

## Script Lifecycle

1. Author writes a `.scenario` script (same syntax).
2. Build tool compiles to bytecode JSON (constants + code) stored in `data/scenarios`.
3. Simulation loads selected scenario bytecode during `worldInit`; errors abort the run with actionable diagnostics.
4. Scenario VM executes `onInit(seed)` once, then `onTick(frame, dt)` each step.
5. VM globals persist throughout the run, enabling timers/counters.
6. Hot reload path: stop current scenario VM, roll back scenario-owned effects, load new bytecode, rerun `onInit`.

## Testing Checklist

- Lexer recognizes scenario keywords (`onInit`, `onTick`, `schedule`, etc.).
- Parser emits AST with correct precedence for combined logical/phero comparisons.
- Compiler produces instruction stream for sample scenarios (fire seeding, faction flip).
- VM respects instruction ceilings and returns control to main loop without blocking.
- Host binding tests verify tile filters, spawn limits, and field writes obey all clamps.
- Deterministic run tests confirm removing RNG divergence in materials and spawning.
- End-to-end run: scenario script randomly ignites tiles and swaps factions on schedule; metrics confirm effects.

## Future Enhancements

- Coroutines (`yield dt`) to schedule multi-step behaviors without busy loops.
- Access to control debt fields for territory-aware scripts.
- Scripted overlays for debug view (e.g., draw vectors or text).
- WASM emitter if performance budget tightens.
- Editor auto-complete using JSON schema describing natives and constants.

This plan anchors the scenario scripting layer directly in the existing stigmergic systems, giving designers a deterministic, controllable way to author complex run setups without bypassing the simulation’s safety and faction mechanics. Agent-level scripting will be layered on later, reusing the same compiler/VM core once the scenario pipeline is proven.
