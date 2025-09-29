import { describe, it, beforeEach } from 'vitest';
import { world } from '../../src/state.js';
import { Mode } from '../../src/constants.js';
import { reactAcidBase, reactFireWater } from '../../src/materials.js';
import { handlePhaseTransitions } from '../../src/simulation.js';
import { initWorld, placeMode } from '../helpers/worldHarness.js';

const snapshotTile = (index) => {
  const S = world.strings[index];
  return {
    mode: S?.mode ?? null,
    tension: S?.tension != null ? Number(S.tension.toFixed(3)) : null,
    amplitude: S?.amplitude != null ? Number(S.amplitude.toFixed(3)) : null,
    heat: Number(world.heat[index].toFixed(3)),
    o2: Number(world.o2[index].toFixed(3)),
  };
};

describe('Observation: material interactions', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
  });

  it('acid and base interaction snapshots', () => {
    const acidIdx = placeMode(10, 10, Mode.ACID);
    const baseIdx = placeMode(11, 10, Mode.BASE);

    const initial = {
      acid: snapshotTile(acidIdx),
      base: snapshotTile(baseIdx),
    };

    reactAcidBase(acidIdx, baseIdx, { triggerFlash: false });
    const afterOne = {
      acid: snapshotTile(acidIdx),
      base: snapshotTile(baseIdx),
    };

    reactAcidBase(acidIdx, baseIdx, { triggerFlash: false });
    const afterTwo = {
      acid: snapshotTile(acidIdx),
      base: snapshotTile(baseIdx),
    };

    expect({ initial, afterOne, afterTwo }).toMatchInlineSnapshot(`
{
  "afterOne": {
    "acid": {
      "amplitude": 0.6,
      "heat": 0,
      "mode": 21,
      "o2": 0.21,
      "tension": 0.495,
    },
    "base": {
      "amplitude": 0.6,
      "heat": 0.052,
      "mode": 22,
      "o2": 0.21,
      "tension": 0.495,
    },
  },
  "afterTwo": {
    "acid": {
      "amplitude": 0.6,
      "heat": 0,
      "mode": 21,
      "o2": 0.21,
      "tension": 0.49,
    },
    "base": {
      "amplitude": 0.6,
      "heat": 0.104,
      "mode": 22,
      "o2": 0.21,
      "tension": 0.49,
    },
  },
  "initial": {
    "acid": {
      "amplitude": 0.6,
      "heat": 0,
      "mode": 21,
      "o2": 0.21,
      "tension": 0.5,
    },
    "base": {
      "amplitude": 0.6,
      "heat": 0,
      "mode": 22,
      "o2": 0.21,
      "tension": 0.5,
    },
  },
}
`);
  });

  it('fire and water interaction snapshots', () => {
    const fireIdx = placeMode(20, 20, Mode.FIRE);
    const waterIdx = placeMode(21, 20, Mode.WATER);
    world.fire.add(fireIdx);

    const initial = {
      fire: snapshotTile(fireIdx),
      water: snapshotTile(waterIdx),
    };

    reactFireWater(fireIdx, waterIdx);

    const after = {
      fire: snapshotTile(fireIdx),
      water: snapshotTile(waterIdx),
    };

    expect({ initial, after }).toMatchInlineSnapshot(`
{
  "after": {
    "fire": {
      "amplitude": 0.966,
      "heat": 0,
      "mode": 31,
      "o2": 0.21,
      "tension": 0.1,
    },
    "water": {
      "amplitude": 0.1,
      "heat": 0.006,
      "mode": 12,
      "o2": 0.21,
      "tension": 0.8,
    },
  },
  "initial": {
    "fire": {
      "amplitude": 1,
      "heat": 0,
      "mode": 31,
      "o2": 0.21,
      "tension": 0.1,
    },
    "water": {
      "amplitude": 0.1,
      "heat": 0,
      "mode": 12,
      "o2": 0.21,
      "tension": 0.8,
    },
  },
}
`);
  });

  it('phase transitions around thresholds', () => {
    const warmIdx = placeMode(30, 30, Mode.WATER);
    world.heat[warmIdx] = 0.16;
    const coldIdx = placeMode(31, 30, Mode.WATER);
    world.heat[coldIdx] = 0.12;
    const iceIdx = placeMode(32, 30, Mode.ICE);
    world.heat[iceIdx] = 0.25;

    const before = {
      warmWater: snapshotTile(warmIdx),
      coldWater: snapshotTile(coldIdx),
      warmIce: snapshotTile(iceIdx),
    };

    handlePhaseTransitions();

    const after = {
      warmWater: snapshotTile(warmIdx),
      coldWater: snapshotTile(coldIdx),
      warmIce: snapshotTile(iceIdx),
    };

    expect({ before, after }).toMatchInlineSnapshot(`
{
  "after": {
    "coldWater": {
      "amplitude": 0.05,
      "heat": 0.14,
      "mode": 13,
      "o2": 0.21,
      "tension": 0.95,
    },
    "warmIce": {
      "amplitude": 0.1,
      "heat": 0.23,
      "mode": 12,
      "o2": 0.21,
      "tension": 0.8,
    },
    "warmWater": {
      "amplitude": 0.1,
      "heat": 0.16,
      "mode": 12,
      "o2": 0.21,
      "tension": 0.8,
    },
  },
  "before": {
    "coldWater": {
      "amplitude": 0.1,
      "heat": 0.12,
      "mode": 12,
      "o2": 0.21,
      "tension": 0.8,
    },
    "warmIce": {
      "amplitude": 0.05,
      "heat": 0.25,
      "mode": 13,
      "o2": 0.21,
      "tension": 0.95,
    },
    "warmWater": {
      "amplitude": 0.1,
      "heat": 0.16,
      "mode": 12,
      "o2": 0.21,
      "tension": 0.8,
    },
  },
}
`);
  });

  it('placing base over an acid tile (same coordinate)', () => {
    const acidIdx = placeMode(40, 40, Mode.ACID);
    const initialAcid = snapshotTile(acidIdx);

    placeMode(40, 40, Mode.BASE);
    const overwritten = snapshotTile(acidIdx);

    reactAcidBase(acidIdx, acidIdx, { triggerFlash: false });
    const afterReaction = snapshotTile(acidIdx);

    expect({ initialAcid, overwritten, afterReaction }).toMatchInlineSnapshot(`
{
  "afterReaction": {
    "amplitude": 0.6,
    "heat": 0.384,
    "mode": 22,
    "o2": 0.21,
    "tension": 0.423,
  },
  "initialAcid": {
    "amplitude": 0.6,
    "heat": 0,
    "mode": 21,
    "o2": 0.21,
    "tension": 0.5,
  },
  "overwritten": {
    "amplitude": 0.6,
    "heat": 0,
    "mode": 22,
    "o2": 0.21,
    "tension": 0.5,
  },
}
`);
  });
});
