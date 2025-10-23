# Factory Workers Roadmap

The current factory module (`src/factory.js`) already supports basic Satisfactory-style logistics:

- Brush placement (`factory-node`, `factory-miner`, `factory-belt`, `factory-smelter`, `factory-constructor`, `factory-storage`) stamps structures on the grid and stores them in `world.factory`.
- `stepFactory()` runs each tick (see `src/simulation.js`) to mine ore, push items along belts, smelt ingots, assemble plates, and update production stats exposed via `getFactoryStatus()`.
- Tests (`tests/factory.gameplay.test.js`) validate the full chain (miner → belt → smelter → belt → constructor → belt → storage).

To make workers visibly handle resources, we’ll layer a job/worker system on top of this foundation.

## 1. Job & Task System

- Track outstanding tasks in `world.factory.jobs`: e.g. `Mine 1x IronOre at tile`, `Deliver IronIngot to smelter`, `Pickup output from constructor`.
- Provide enqueue helpers so structures request input. Miners emit “mine” jobs when the node has capacity; smelters enqueue “fetch ore” when their input buffer is low.
- Jobs should record target tile, required item, action type (`mine | pickup | drop | deposit`), and dwell time.

## 2. Worker Agents

- Introduce `Mode.WORKER` agents or a dedicated worker class with a small state machine:
  - `Idle → AcquireJob → MoveToTarget → Act → Complete`
- Reuse the pathing logic from medics (BFS) with new helper functions for general pathfinding. Ensure structures/belts set walkable flags so workers can move around them.
- Each worker keeps an inventory slot (`carriedItem`, `carriedAmount`) and uses a different sprite/color when carrying resources.

## 3. Scheduler & Coordination

- Add a dispatcher (e.g. `factory.assignJob(worker)`) that matches idle workers to queued jobs. Use simple heuristics at first (closest job, round-robin per type).
- Support job failure/retry if a worker cannot reach the target or resources changed.
- Optionally allow priority tags (mining > smelting > constructors) to avoid starved machines when worker count is low.

## 4. Inventory & Resource Flow

- Workers mine nodes by staying on the tile for a dwell time; once complete they “carry” an ore item to the next structure.
- Update structure logic to rely on deliveries rather than automatic push:
  - Belts: disable the auto-miner output; require workers to place items onto the belt (first stage). The existing belt logic can move items once placed.
  - Smelters/constructors: consume inputs only when a worker delivers them to the input tile or belt.
  - Storage: accept item deposits when workers drop off goods.
- Expose APIs for workers to query/modify structure inventories (e.g. `factory.requestItem(structure, item)`, `factory.depositItem(structure, worker)`).

## 5. Visual Feedback & UI

- New worker sprite or overlay to indicate carrying status.
- Trigger `emitEffect` or `logDebug` calls on job completion (handy for debugging).
- Extend the factory HUD to display active jobs, worker states (idle/moving/working), and job queue composition.

## 6. Implementation Stages

1. **Mining Loop:** workers walk from a base to an ore node, mine, drop ore into storage—no machines yet.
2. **Feeding Machines:** enable belts and smelters but require workers to load ore into smelters and deliver ingots back to storage.
3. **Constructors & Distribution:** workers transport ingots to constructors and deliver plates.
4. **Hybrid Automation:** keep belts for long hauls, but workers still load/unload at machine endpoints.

## 7. Documentation & Tooling

- Document worker controls and job states (update factory section in docs).
- Add tests to ensure workers can keep a sample production line running (e.g. a scenario that spawns two workers and verifies plates accumulate).
- Provide instrumentation (log overlay, job queue inspector) to tune scheduling/performance.

This staged approach retains the existing automated chain but layers human-visible logistics—workers walking, loading, and delivering resources—making the sim feel alive while preserving deterministic production. Once the base loop is solid, you can explore worker upgrades, fatigue, or specialty roles to deepen gameplay.
