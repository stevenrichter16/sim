import { describe, it, expect, beforeEach } from 'vitest';
import { world } from '../src/state.js';
import { Mode } from '../src/constants.js';
import { reactFireWater, reactAcidBase } from '../src/materials.js';
import { initWorld, placeMode } from './helpers/worldHarness.js';
import { Agent } from '../src/simulation.js';

describe('amplitude and tension effects', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
  });

  it('fire amplitude decays gradually with repeated water reactions', () => {
    const fireIdx = placeMode(10, 12, Mode.FIRE);
    const waterIdx = placeMode(11, 12, Mode.WATER);
    world.fire.add(fireIdx);

    const amplitudes = [];
    for(let i = 0; i < 5; i++){
      reactFireWater(fireIdx, waterIdx);
      amplitudes.push(world.strings[fireIdx].amplitude);
    }

    expect(amplitudes[0]).toBeLessThan(1.0);
    for(let i = 1; i < amplitudes.length; i++){
      expect(amplitudes[i]).toBeLessThanOrEqual(amplitudes[i-1]);
      expect(amplitudes[i]).toBeGreaterThan(0);
    }
    expect(world.heat[waterIdx]).toBeGreaterThan(0);
  });

  it('acid and base tensions fall with sustained reactions', () => {
    const acidIdx = placeMode(20, 20, Mode.ACID);
    const baseIdx = placeMode(21, 20, Mode.BASE);

    const acidTensions = [];
    const baseTensions = [];
    for(let i = 0; i < 4; i++){
      reactAcidBase(acidIdx, baseIdx, { triggerFlash: false });
      acidTensions.push(world.strings[acidIdx].tension);
      baseTensions.push(world.strings[baseIdx].tension);
    }

    for(let i = 1; i < acidTensions.length; i++){
      expect(acidTensions[i]).toBeLessThanOrEqual(acidTensions[i-1]);
      expect(baseTensions[i]).toBeLessThanOrEqual(baseTensions[i-1]);
    }
    expect(world.heat[baseIdx]).toBeGreaterThan(0);
  });

  it('social stress pushes agent panic level higher', () => {
    const active = new Agent(30, 30, Mode.PANIC);
    active.S.amplitude = 1.1;
    const active2 = new Agent(30, 31, Mode.PANIC);
    active2.S.amplitude = 1.05;
    const calm = new Agent(31, 30, Mode.CALM);
    calm.S.amplitude = 0.6;
    calm.S.tension = 0.8;

    world.agents = [active, active2, calm];
    const bins = new Map();
    const key = '7,7';
    bins.set(key, world.agents);

    const initialTension = calm.S.tension;

    for(let i = 0; i < world.W * world.H; i++){
      world.o2[i] = 0.14;
    }

    for(let i = 0; i < 8; i++){
      calm._doStep(bins);
    }

    expect(calm.S.tension).toBeLessThan(initialTension);
    expect(calm.panicLevel).toBeGreaterThan(0);
  });

  it('medic aura boosts tension and lowers amplitude for nearby agents', () => {
    const medic = new Agent(40, 40, Mode.MEDIC);
    const subject = new Agent(41, 40, Mode.CALM);
    subject.S.tension = 0.5;
    subject.S.amplitude = 0.5;
    world.agents = [medic, subject];

    medic._doStep(null);

    expect(subject.S.tension).toBeGreaterThan(0.5);
    expect(subject.S.amplitude).toBeLessThan(0.5);
  });

  it('medic moves toward panicking agent to provide support', () => {
    const medic = new Agent(10, 10, Mode.MEDIC);
    const target = new Agent(15, 10, Mode.PANIC);
    target.S.tension = 0.2;
    target.S.amplitude = 0.9;
    world.agents = [medic, target];
    const initialDistance = Math.abs(medic.x - target.x) + Math.abs(medic.y - target.y);

    for(let i = 0; i < 12; i++){
      medic._doStep(null);
    }

    const movedDistance = Math.abs(medic.x - target.x) + Math.abs(medic.y - target.y);
    expect(movedDistance).toBeLessThan(initialDistance);
  });
});
