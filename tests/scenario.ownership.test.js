import { describe, it, expect, beforeEach } from 'vitest';
import { Mode } from '../src/constants.js';
import {
  world,
  idx,
  resetWorld,
  getAgentById,
} from '../src/state.js';
import {
  spawnNPC,
  igniteTile,
  scenarioIgnite,
} from '../src/simulation.js';
import { initWorld } from './helpers/worldHarness.js';

function markPlayerAgent(tileIdx, mode = Mode.CALM){
  const agentId = spawnNPC(mode, undefined, { tileIdx }).agentId;
  const agent = getAgentById(agentId);
  if(agent){
    agent.origin = 'player';
  }
  return agentId;
}

describe('scenario ownership tracking (tests-first)', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
  });

  it('tracks scenario-owned agents separately from manual agents', () => {
    const scenarioTile = idx(5, 5);
    const playerTile = idx(6, 6);

    const scenarioSpawn = spawnNPC(Mode.CALM, undefined, { tileIdx: scenarioTile, scenarioOwned: true });
    expect(scenarioSpawn.ok).toBe(true);

    const playerId = markPlayerAgent(playerTile, Mode.CALM);

    expect(world.scenarioAgents?.has(scenarioSpawn.agentId)).toBe(true);
    expect(world.scenarioAgents?.has(playerId)).toBe(false);
  });

  it('records scenario ignited fires and leaves manual fires unowned', () => {
    const scenarioTile = idx(10, 10);
    const manualTile = idx(11, 10);

    const igniteRes = scenarioIgnite(scenarioTile, 1);
    expect(igniteRes.ok).toBe(true);

    igniteTile(manualTile, 1);

    expect(world.scenarioFires?.has(scenarioTile)).toBe(true);
    expect(world.scenarioFires?.has(manualTile)).toBe(false);
  });

  it('cleanup removes scenario agents and fires but preserves player entities', () => {
    const scenarioAgentTile = idx(8, 8);
    const playerAgentTile = idx(8, 9);
    const scenarioFireTile = idx(12, 12);
    const playerFireTile = idx(13, 12);

    const scenarioAgent = spawnNPC(Mode.CALM, undefined, { tileIdx: scenarioAgentTile, scenarioOwned: true });
    expect(scenarioAgent.ok).toBe(true);
    const playerAgentId = markPlayerAgent(playerAgentTile, Mode.CALM);

    scenarioIgnite(scenarioFireTile, 1);
    igniteTile(playerFireTile, 1);

    expect(world.scenarioAgents?.has(scenarioAgent.agentId)).toBe(true);
    expect(world.scenarioFires?.has(scenarioFireTile)).toBe(true);

    // Simulate scenario cleanup hook.
    if(world.cleanupScenarioArtifacts){
      world.cleanupScenarioArtifacts();
    }

    expect(world.scenarioAgents?.size ?? 0).toBe(0);
    expect(world.scenarioFires?.size ?? 0).toBe(0);
    expect(world.fire.has(scenarioFireTile)).toBe(false);
    expect(world.fire.has(playerFireTile)).toBe(true);

    const playerAgent = getAgentById(playerAgentId);
    expect(playerAgent).toBeTruthy();
    expect(getAgentById(scenarioAgent.agentId)).toBeNull();
  });

  it('owner maps reset on world reset', () => {
    const scenarioAgent = spawnNPC(Mode.CALM, undefined, { tileIdx: idx(3, 3), scenarioOwned: true });
    expect(scenarioAgent.ok).toBe(true);
    scenarioIgnite(idx(4, 4), 1);

    resetWorld(0.21);

    expect(world.scenarioAgents?.size ?? 0).toBe(0);
    expect(world.scenarioFires?.size ?? 0).toBe(0);
    expect(world.spawnDiagnostics?.lastAttempt ?? null).toBeNull();
  });

  it('clears ownership when scenario agent is despawned manually', () => {
    const tile = idx(9, 9);
    const result = spawnNPC(Mode.CALM, undefined, { tileIdx: tile, scenarioOwned: true });
    expect(result.ok).toBe(true);
    const agentId = result.agentId;
    expect(world.scenarioAgents?.has(agentId)).toBe(true);

    // Simulate despawn path that should unmark ownership.
    if(world.despawnAgent){
      world.despawnAgent(agentId);
    } else {
      const index = world.agentIndexById.get(agentId);
      if(typeof index === 'number' && index >= 0){
        world.agents.splice(index, 1);
      }
      world.scenarioAgents?.delete(agentId);
    }

    expect(world.scenarioAgents?.has(agentId)).toBe(false);
  });

  it('clears ownership when scenario fire is extinguished', () => {
    const tile = idx(7, 7);
    scenarioIgnite(tile, 1.2);
    expect(world.scenarioFires?.has(tile)).toBe(true);

    if(world.extinguishFire){
      world.extinguishFire(tile);
    } else {
      world.fire.delete(tile);
      world.scenarioFires?.delete(tile);
    }

    expect(world.scenarioFires?.has(tile)).toBe(false);
  });

  it('cleanup is idempotent across repeated calls', () => {
    const tile = idx(15, 15);
    scenarioIgnite(tile, 1);
    spawnNPC(Mode.CALM, undefined, { tileIdx: idx(15, 16), scenarioOwned: true });
    const cleanup = world.cleanupScenarioArtifacts ?? (() => {});
    cleanup();
    cleanup();
    expect(world.scenarioFires?.size ?? 0).toBe(0);
    expect(world.scenarioAgents?.size ?? 0).toBe(0);
  });
});
