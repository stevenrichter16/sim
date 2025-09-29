# Simulation Guardrails Checklist

## Behaviour Documentation
- Keep `docs/simulation-behavior.md` current. Update it whenever interactions, thresholds, or mode stats change.
- Convert critical observation logs (e.g., acid–base tension drop, phase transitions) into structured snapshots. Treat changes in those logs as regressions unless explicitly intended.

## Test Coverage
- Add a unit/integration test for every new mode, material, or mechanic.
- Run the full suite (`npm test -- --run`) before shipping significant changes.
- Run smoke tests (`npm test -- --run tests/simulation.smoke.test.js`) whenever core systems or performance-sensitive paths are touched.
- Enable and monitor coverage reports to reveal untested code paths.

## Configuration Hygiene
- Centralise tunable thresholds (freeze point, oxygen cut, social stress constants) to avoid scattering magic numbers across modules.
- Use configuration objects or data tables to add new materials/modes instead of hardcoding values inline.

## Observability & Logging
- Introduce lightweight logging for key state changes (e.g., agent mode flips, reaction triggers) to aid debugging.
- Maintain observation tests (`tests/observations/...`) and promote important log entries into assertions as behaviour stabilises.

## Determinism & Tooling
- Allow seeding of random number generation for reproducible tests and debugging sessions.
- Provide helper scripts to dump slices of `world` state (heat, O₂, strings) for visual inspection when unexpected behaviour occurs.

## Performance Awareness
- Track average simulation step time when profiling new features. Add perf smoke tests or instrumentation if runtime becomes a concern.

## Process
- Document new guardrails and expectations alongside new features.
- Review and expand automated tests before expanding the feature set to keep scaling risk low.
