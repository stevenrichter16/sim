# Testing Notes

- Run `npm test -- --run tests/simulation.smoke.test.js` after significant gameplay or engine changes. This suite ensures the simulation loop stays stable (no NaNs, agent count, heat bounds).
- Update `tests/simulation.smoke.test.js` whenever new subsystems or features are introduced so the smoke coverage reflects current behaviour.
- Keep observation suite (`tests/observations/materialInteractions.observe.test.js`) in sync with behaviour changes to avoid bias in future assertions.
- Add targeted unit tests for new mechanics alongside smoke coverage to catch regressions early.
