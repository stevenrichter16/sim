# Simulation Runtime Implementation Guide

This guide outlines the planned work for bringing the scripted scenario system online. It captures high-level goals, concrete implementation steps, and integration touchpoints across the codebase so new contributors can get oriented quickly.

## Vision

The simulation should execute scenario scripts deterministically, expose explicit host capabilities, and surface actionable diagnostics whenever a script misbehaves. Achieving this requires a purpose-built runtime that can load compiled scenario bytecode, drive it inside the main simulation loop, and coordinate side effects with existing subsystems.

## Core Milestones

1. **Build the execution runtime**  
   Implement the scenario VM to execute the compiled chunks with a fixed-size stack, instruction dispatch loop, and per-tick budget checks, following the roadmap’s VM requirements.  
   Introduce this runtime under `src/script/` (for example `vm.js`) so it can be required from simulation code without circular imports.

2. **Wire host bindings**  
   Define the native call surface (`ignite`, `spawnAgent`, `fieldWrite`, etc.) with capability checks and deterministic RNG sources, matching the plan’s host-binding list.  
   Locate the implementation alongside existing simulation helpers (see `src/effects.js`, `src/materials.js`, and `src/simulation.js`) so each native can delegate to the correct subsystem.

3. **Integrate with the simulation loop**  
   Add a `scenarioRuntime` owner that loads compiled bytecode, seeds RNG, invokes `onInit`, and calls `tick` before agent updates inside `src/simulation.js`’s main step pipeline.  
   Ensure scenario-owned entities (agents, fires) use the existing ownership helpers such as `markScenarioAgent` and `markScenarioFire` in `src/state.js` when applying native side effects.

4. **Extend tooling and safety nets**  
   Provide a build command (e.g., via `package.json`) that compiles `.sscript` files into `data/scripts`, and expand tests to cover VM execution paths as outlined in the tooling checklist.  
   Implement runtime diagnostics logging and watchdog handling so instruction overruns or capability violations surface to the UI, aligning with the safety guidance.

## Additional Brainstorming Notes

- **Scenario lifecycle**: The runtime should own initialization, per-tick advancement, suspension, and teardown hooks so scenarios can register interest in simulation phases and reclaim resources deterministically.
- **State introspection**: Consider exposing read-only selectors for commonly queried data (agent positions, fire status) to avoid native calls for simple lookups and keep host APIs small.
- **Testing harness**: Create fixtures that load compiled sample scripts and assert world state mutations, so we can regress both VM semantics and host binding behaviors with minimal setup.
- **Debug tooling**: A structured trace mode (instruction stream, stack snapshots) will help diagnose script bugs and watchdog trips when QA reports scenario issues.
- **Security posture**: Capability checks should emit explicit errors and halt offending scripts instead of mutating state. Logging should capture the capability, caller chunk, and offending span to make investigations straightforward.
- **Documentation**: Mirror this guide in contributor docs and keep a changelog of VM opcode additions so gameplay designers know what features are available.

Keeping these milestones and notes in view will help align implementation details with the broader simulation goals while giving each contributor a clear starting point.
