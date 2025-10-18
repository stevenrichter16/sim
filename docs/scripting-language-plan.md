# Stigmergic Script VM Integration Plan

This plan adapts the lightweight C-style scripting concept to the existing stigmergic evacuation simulation. The immediate focus is **scenario scripting**: an orchestrator VM that can author complex run setups (random fire seeds, timed faction swaps, scripted hazards). Agent-level scripting remains on the roadmap but is intentionally out of scope until the scenario layer is stable.

---

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
- Bounded per-tick instruction budget to respect existing perf.
- Safe exposure of simulation data (readonly world tiles unless explicitly granted).

---

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

---

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
- Max locals per stack frame: 16.
- Max globals (script `let` at top level): 32 (stored in upvalues).
- Hard instruction cap per tick: 256 (configurable).

---

## Implementation Roadmap

1. **Lexer & Parser**
   - Extend keyword table with `MODE_PANIC`, `MODE_MEDIC`, `agent`, `field`.
   - Numeric literals stay float; add string literal support for native calls.
   - Parser produces AST nodes carrying source spans for diagnostics overlay.

2. **Compiler**
   - Assign global slots to top-level `let` declarations—persist between ticks.
   - Inject implicit parameters for `onInit(seed)` and `onTick(frame, dt)` entry points.
   - Emit `HALT` when instruction budget would overflow.

3. **Virtual Machine**
   - Stack + call frames implemented with preallocated arrays to avoid GC.
   - Instruction dispatch uses numeric opcodes (avoid string compare in hot loop).
   - Track execution time; abort script if budget exceeded (flag scenario script as unhealthy and surface a structured error).

4. **Host Bindings**
   - Provide curated natives (scenario scope detailed below).
   - Expose deterministic randomness tied to the run seed, and track capability requirements per native.

5. **Integration**
   - Add a `scenarioRuntime` module that loads compiled scenarios, seeds RNG, and owns the VM instance.
   - During `stepSimulation`, invoke `scenarioRuntime.tick(frame, dt)` before agent updates; host actions mark spawned entities/fires as scenario-owned so they can be rolled back or audited before movement/physics.
   - Provide `dt` derived from `speedMultiplier` to keep scripts time-aware.
   - Add a persistent diagnostics log plus overlay listing instruction counts, pending schedules, and last error payload.

6. **Tooling**
   - CLI command `npm run compile-scripts` to precompile `.sscript` files to JSON bytecode placed in `data/scripts`.
   - Editor hooks: highlight syntax errors with line/column info.
   - Unit tests in `tests/scripts.vm.test.js` covering lex/parse/compile/vm/hook contract.
   - Manifest-driven native registration (`data/scenarios/natives.json`) so new host bindings can be whitelisted without core code edits.

7. **Safety & Sandboxing**
   - Capability-gated natives ensure scripts only touch sanctioned systems; direct mutation of `world` arrays remains disallowed.
   - Instruction watchdog prevents infinite loops; on violation, the VM raises a structured runtime error, disables further execution, and surfaces diagnostics.
   - Memory caps (globals, stack, schedule queue) guard against runaway allocations; breaches trigger graceful degradation and warnings.

---

## Embed Points in Simulation Loop

- `worldInit`: load compiled scenario bytecode, instantiate a single VM, invoke `onInit(seed)`.
- `stepSimulation` (before agent updates):
  1. Compute frame index and `dt`.
  2. Run `scenarioVM.tick(frame, dt)`; host bindings may enqueue hazards, faction swaps, etc.
  3. Apply queued effects before agents step.
- Diagnostics frame: log instruction count and native call usage for the scenario VM.

---

## Native Function Reference (Initial Draft)

| Native               | Args                                | Description |
|----------------------|-------------------------------------|-------------|
| `rand`               | –                                   | Returns 0..1 deterministic float. |
| `randRange`          | `min`, `max`                        | Convenience wrapper around `rand`. |
| `randTile`           | `filterKey`                         | Picks a tile meeting a named filter (`open`, `door`, `fireFree`). |
| `ignite`             | `tileIdx`, `intensity`              | Starts/boosts fire; clamps and respects walls. |
| `spawnAgent`         | `factionId`, `mode`, `tileIdx`      | Spawns NPC if tile open; returns agent id or -1. |
| `switchFaction`      | `agentId`, `newFactionId`           | Retargets existing agent (with affinity validation). |
| `agentTile`          | `agentId`                           | Returns tile index or -1. |
| `tileField`          | `tileIdx`, `fieldName`              | Returns scalar pheromone (0..1). |
| `fieldWrite`         | `tileIdx`, `fieldName`, `value`     | Writes pheromone with clamp + diffusion seed. |
| `schedule`           | `delayTicks`, `codeId`              | Posts a deferred callback identified by compiled label. |
| `tileInfo`           | `tileIdx`                           | Returns terrain tags + wall/vent/fire flags. |
| `agentCount`         | `factionId`                         | Returns number of active agents for faction. |
| `agentIds`           | `filterSpec`                        | Returns array of agent ids (capped) matching criteria. |
| `controlLevel`       | `tileIdx`                           | Reads territory control (0..1). |
| `debt`               | `tileIdx`, `factionId`              | Reads control debt value (0..1). |
| `emitEffect`         | `type`, `x`, `y`                    | Bridges to `emitParticleBurst` / `emitFlash`. |
| `emitNotification`   | `type`, `payload`                   | Adds a throttled UI notification. |
| `logDebug`           | `code`, `value`                     | Sends value to diagnostics overlay. |

Each call validates arguments and enforces per-tick quotas (e.g., max spawns, max fires) to keep scenarios bounded.

**Permissions & Capabilities**

- Scenario scripts ship with capability set `{ map_read, map_write_limited, agent_spawn, agent_switch, emit_effect }`.
- Each native declares the capabilities it requires; the VM checks these before dispatching and rejects unauthorized calls with a runtime error.
- Future script classes (agent, faction AI) can be given alternate capability bundles without touching scenario scripts.

---

## Script Lifecycle

1. Author writes a `.scenario` script (same syntax).
2. Build tool compiles to bytecode JSON (constants + code) stored in `data/scenarios`.
3. Simulation loads selected scenario bytecode during `worldInit`; syntax/compile errors surface as structured payloads (`file`, `line`, `column`, `message`) in the inspector and block the run.
4. Scenario VM executes `onInit(seed)` once, then `onTick(frame, dt)` each step. Random seed derives from `settings.scenarioSeed` (or world RNG) and is injected into the VM’s deterministic RNG stream.
5. VM globals persist throughout the run, enabling timers/counters.
6. Hot reload path: stop current scenario VM, flush queued actions, roll back scenario-owned entities (fires/agents spawned via natives), reset globals to compiled defaults, load new bytecode, rerun `onInit`.

---

## Testing Checklist

- Lexer recognizes scenario keywords (`onInit`, `onTick`, `schedule`, etc.).
- Parser emits AST with correct precedence for combined logical/phero comparisons.
- Compiler produces instruction stream for sample scenarios (fire seeding, faction flip).
- VM respects instruction ceilings, enforces HALT, and returns control to main loop without blocking (regression tests guard against budget bypass).
- Host binding tests verify tile filters, spawn limits, capability checks, and field writes obey all clamps.
- Deterministic integration tests spin up a headless simulation with fixed seed, run scenario bytecode, and snapshot totals (fires, faction counts, field sums).
- End-to-end run: scenario script randomly ignites tiles and swaps factions on schedule; metrics confirm effects.

---

## Future Enhancements

- Coroutines (`yield dt`) to schedule multi-step behaviors without busy loops.
- Access to control debt fields for territory-aware scripts.
- Harmonized budget manager when agent-level scripting arrives (per-agent caps + global throttle).
- Scripted overlays for debug view (e.g., draw vectors or text).
- WASM emitter if performance budget tightens.
- Editor auto-complete using JSON schema describing natives and constants.

---

## Error Handling & Diagnostics

- **Syntax/compile**: build tooling and runtime loader emit structured errors (`file`, `line`, `column`, `message`) and block activation.
- **Runtime**: VM traps exceptions, captures stack traces (`function`, `pc`, source span), logs persistently, disables further scenario ticks, and falls back to baseline simulation until reset.
- **`onInit` failure**: scenario remains inactive; UI displays warning banner with retry option.
- **Diagnostics**: overlay shows VM state (`active`, `halted`, `errored`), instruction usage, pending schedules, and last native call summary; persistent log panel keeps chronological history.

---

## Scheduler Semantics

- `schedule(delayTicks, codeId)` enqueues a compiled helper function (declared as `fn eventFoo(){}`) to run after `delayTicks` frames.
- Scheduled callbacks have access to globals/upvalues but not to the original local stack frame; pass context via dedicated state APIs if needed.
- Events scheduled for the same frame execute FIFO before `onTick`.
- All scheduled executions share the frame’s instruction budget; if the cap is hit, remaining events defer to the next frame with a warning entry.
- Errors inside scheduled code follow runtime error rules and remove the offending event from the queue.

---

## Data Access & Permissions

- Read-only helpers expose:
  - `tileInfo(tileIdx)` → terrain tags, wall/vent/fire status.
  - `agentCount(factionId)` / `agentIds(filterSpec)` for population queries.
  - `controlLevel(tileIdx)` / `debt(tileIdx, factionId)` for territory awareness.
- Capability checks ensure only authorized script classes call each helper; scenario scripts default to `{ map_read, map_write_limited, agent_spawn, agent_switch, emit_effect }`.

---

## Bytecode, Limits & Versioning

- Bytecode packages include `{ version, consts, code, globalsMeta, capabilities }`.
- Runtime enforces semantic version compatibility; mismatched major versions trigger a “recompile required” error.
- Default limits: 16 locals, 32 globals, 256 instructions per frame, 128 scheduled events pending. Compiler flags allow higher limits per script (subject to runtime max).
- Runtime tracks stack depth and queue size; exceeding limits triggers graceful degradation (dropping oldest scheduled tasks) with diagnostics.

---

## Randomness & Asynchronous Effects

- Scenario RNG seeded from `settings.scenarioSeed`; additional VM instances derive child seeds via splitmix to maintain determinism.
- Host natives like `emitNotification(type, payload)` allow asynchronous UI cues but are throttled (e.g., max 5 per minute) to avoid spam.
- Additional natives are registered through a manifest (`data/scenarios/natives.json`) declaring name, capability, argument schema, and throttling limits—keeping core code small.

---

This plan anchors the scenario scripting layer directly in the existing stigmergic systems, giving designers a deterministic, controllable way to author complex run setups without bypassing the simulation’s safety and faction mechanics. Agent-level scripting will be layered on later, reusing the same compiler/VM core once the scenario pipeline is proven.
