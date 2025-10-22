# sim

## Scenario Scripts

- Edit `.sscript` sources under `scenarios/` (e.g., `scenarios/hazard-demo.sscript`).
- Compile them to JSON bytecode assets with:
  ```bash
  npm run compile-scripts          # one-shot build
  npm run compile-scripts:watch    # watch mode while authoring scenarios
  ```
- Load the generated assets under `data/scenarios/` via `createSimulation().loadScenarioAsset`.
- See `docs/scenario-tutorials.md` for script patterns that use `agentIds`, `emitEffect`, and related natives.
