# Observed Material Interactions (Vitest snapshot run)

_Source: `tests/observations/materialInteractions.observe.test.js` run on current build._

## Acid + Base (adjacent tiles)
- Initial tensions both at `0.500`; amplitudes at `0.600`; heat `0.000`.
- First call to `reactAcidBase`:
  - Both tiles lose ~`0.005` tension (→ `0.495`).
  - Base tile heat jumps to `0.052`; acid heat stays `0`.
- Second consecutive call (no mode change between calls):
  - Tension drops another ~`0.005` per tile (→ `0.490`).
  - Base tile heat accumulates to `0.104` (another ~`0.052`).
  - No amplitude shift observed during these steps.

## Fire + Water (adjacent)
- Fire starts at amplitude `1.000`, tension `0.100`; water at amplitude `0.100`, tension `0.800`.
- After `reactFireWater`:
  - Fire amplitude reduces to `0.966` (≈ −0.034); tension unchanged.
  - Water tile heat rises to `0.006`; other water properties unchanged.

## Phase Transition Sweep
- Water at heat `0.160` (just above freeze threshold 0.15) stays water; no heat adjustment.
- Water at heat `0.120` converts to ice after `handlePhaseTransitions`; heat nudges up to `0.140`.
- Ice at heat `0.250` melts back to water; heat reduces to `0.230` and adopts water baseline stats.

These captures document current behaviour without assertions so future automated tests can be compared against the present baseline.
