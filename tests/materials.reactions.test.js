import { describe, it, expect, beforeEach } from 'vitest';
import { world } from '../src/state.js';
import { Mode } from '../src/constants.js';
import { reactAcidBase, reactFireWater } from '../src/materials.js';
import { initWorld, placeMode } from './helpers/worldHarness.js';

const FREEZE_POINT = 0.15;

describe('material reactions', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
  });

  it('acid + base raises heat and lowers tension', () => {
    const acidIdx = placeMode(10, 10, Mode.ACID);
    const baseIdx = placeMode(11, 10, Mode.BASE);
    const baseHeatBefore = world.heat[baseIdx];
    const acidTensionBefore = world.strings[acidIdx].tension;
    const baseTensionBefore = world.strings[baseIdx].tension;

    reactAcidBase(acidIdx, baseIdx, { triggerFlash: false });

    expect(world.heat[baseIdx]).to.be.greaterThan(baseHeatBefore);
    expect(world.strings[acidIdx].tension).to.be.lessThan(acidTensionBefore);
    expect(world.strings[baseIdx].tension).to.be.lessThan(baseTensionBefore);
  });

  it('acid + base accumulates heat on the base tile across multiple reactions', () => {
    const acidIdx = placeMode(14, 14, Mode.ACID);
    const baseIdx = placeMode(15, 14, Mode.BASE);

    reactAcidBase(acidIdx, baseIdx, { triggerFlash: false });
    const afterOne = world.heat[baseIdx];

    reactAcidBase(acidIdx, baseIdx, { triggerFlash: false });
    const afterTwo = world.heat[baseIdx];

    expect(afterOne).to.be.greaterThan(0);
    expect(afterTwo).to.be.greaterThan(afterOne);
    expect(world.heat[acidIdx]).to.equal(0);
  });

  it('acid and base tensions continue to fall with repeated reactions', () => {
    const acidIdx = placeMode(18, 18, Mode.ACID);
    const baseIdx = placeMode(19, 18, Mode.BASE);

    const initialAcidTension = world.strings[acidIdx].tension;
    const initialBaseTension = world.strings[baseIdx].tension;

    reactAcidBase(acidIdx, baseIdx, { triggerFlash: false });
    const firstAcidTension = world.strings[acidIdx].tension;
    const firstBaseTension = world.strings[baseIdx].tension;

    reactAcidBase(acidIdx, baseIdx, { triggerFlash: false });
    const secondAcidTension = world.strings[acidIdx].tension;
    const secondBaseTension = world.strings[baseIdx].tension;

    expect(firstAcidTension).to.be.lessThan(initialAcidTension);
    expect(secondAcidTension).to.be.lessThan(firstAcidTension);
    expect(firstBaseTension).to.be.lessThan(initialBaseTension);
    expect(secondBaseTension).to.be.lessThan(firstBaseTension);
  });

  it('acid heating next to base keeps the local trio above freezing when water is added', () => {
    const acidIdx = placeMode(22, 22, Mode.ACID);
    const baseIdx = placeMode(23, 22, Mode.BASE);

    // Accumulate heat on the base tile until it exceeds the freeze threshold
    for(let i = 0; i < 20 && world.heat[baseIdx] <= FREEZE_POINT; i++){
      reactAcidBase(acidIdx, baseIdx, { triggerFlash: false });
    }

    expect(world.heat[baseIdx]).to.be.greaterThan(FREEZE_POINT);

    const waterIdx = placeMode(24, 22, Mode.WATER);

    const totalHeat = world.heat[acidIdx] + world.heat[baseIdx] + world.heat[waterIdx];
    expect(totalHeat).to.be.greaterThan(FREEZE_POINT);
  });

  it('fire + water dampens fire amplitude and heats water tile', () => {
    const fireIdx = placeMode(15, 15, Mode.FIRE);
    const waterIdx = placeMode(16, 15, Mode.WATER);
    world.fire.add(fireIdx);
    const ampBefore = world.strings[fireIdx].amplitude;

    reactFireWater(fireIdx, waterIdx);

    expect(world.strings[fireIdx].amplitude).to.be.lessThan(ampBefore);
    expect(world.heat[waterIdx]).to.be.greaterThan(0);
  });
});
