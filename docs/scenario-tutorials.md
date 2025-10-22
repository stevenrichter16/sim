# Scenario Script Examples

These examples live under `scenarios/tutorial/` and demonstrate the native call surface your scripts can rely on. Each sample ships with a matching `*.config.json` file declaring the required capability set; run `npm run compile-scripts` (or `npm run compile-scripts:watch`) to generate JSON assets in `data/scenarios/`.

## Getting Started

```c
// scenarios/hazard-demo.sscript
let nextIgnite = 30;

fn onInit(seed) {
  call logDebug("scenario", "hazard-demo onInit");
}

fn onTick(frame, dt) {
  if (frame >= nextIgnite) {
    call ignite(315, 0.6);
    nextIgnite = frame + 45;
  }
}
```

Capabilities (`hazard-demo.config.json`): `fire.write`, `diag.write`.

## Agent Queries & Effects

```c
// scenarios/tutorial/agent-effects.sscript
let pulseTicks = 0;

fn onInit(seed) {
  call logDebug("tutorial", "agent effects ready");
}

fn onTick(frame, dt) {
  let population = call agentCount();
  if (population == 0) {
    return;
  }

  if (frame % 120 == 0) {
    let ids = call agentIds({ scenarioOwned: true, limit: 8 });
    if (ids.length > 0) {
      let focus = ids[0];
      let tile = call agentTile(focus);
      call emitEffect("flash", tile % 80, tile / 80, { radius: 2, life: 18 });
    }
  }
}
```

Capabilities (`agent-effects.config.json`): `agent.read`, `effects.emit`, `diag.write`.

## Field Manipulation & Scheduling

```c
// scenarios/tutorial/seeded-loop.sscript
let tickCount = 0;

fn onInit(seed) {
  tickCount = 0;
  call logDebug("tutorial", seed);
}

fn onTick(frame, dt) {
  tickCount = tickCount + 1;
  if (tickCount % 60 == 0) {
    let hotspot = call randTile("open");
    if (hotspot != -1) {
      call fieldWrite(hotspot, "panic", 0.6);
    }
  }
  if (tickCount % 120 == 0) {
    call schedule(10, "onTick");
  }
}
```

Capabilities (`seeded-loop.config.json`): `field.write`, `rng.use`, `runtime.schedule`, `diag.write`.

## Diagnostics & Hazard Pulses

```c
fn onTick(frame, dt) {
  if (frame % 30 == 0) {
    call logDebug("frame", frame);
  }
  if (frame % 180 == 0) {
    call emitEffect("burst", 40, 20, { type: "spark", intensity: 0.8 });
  }
}
```

Recommended capabilities: `effects.emit`, `diag.write`.

## Building & Loading

```bash
npm run compile-scripts          # compile everything under ./scenarios
npm run compile-scripts:watch    # rebuild on file changes while authoring
```

In-game, open the **Scenario** dropdown (top toolbar) and pick the compiled asset to hot swap scripts. Use the diagnostics overlay to verify `logDebug` output and runtime errors.
