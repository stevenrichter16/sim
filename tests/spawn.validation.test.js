import { describe, it, expect, beforeEach } from 'vitest';
import { Mode } from '../src/constants.js';
import { world, idx, getAgentById } from '../src/state.js';
import { spawnNPC, canSpawnAt } from '../src/simulation.js';
import { initWorld } from './helpers/worldHarness.js';

describe('spawn validation', () => {
  beforeEach(() => {
    initWorld({ o2: 0.21 });
  });

  it('spawns an agent at an explicit tile when open', () => {
    const tile = idx(10, 10);
    expect(canSpawnAt(tile)).toBe(true);

    const result = spawnNPC(Mode.CALM, undefined, { tileIdx: tile });
    expect(result.ok).toBe(true);
    expect(result.tileIdx).toBe(tile);
    expect(typeof result.agentId).toBe('number');
    expect(world.spawnDiagnostics.lastAttempt).toMatchObject({
      ok: true,
      tileIdx: tile,
      agentId: result.agentId,
      mode: Mode.CALM,
    });

    const agent = getAgentById(result.agentId);
    expect(agent).toBeTruthy();
    expect(idx(agent.x, agent.y)).toBe(tile);
    expect(canSpawnAt(tile)).toBe(false);
  });

  it('rejects spawning on an occupied tile', () => {
    const tile = idx(12, 12);
    const first = spawnNPC(Mode.CALM, undefined, { tileIdx: tile });
    expect(first.ok).toBe(true);

    const second = spawnNPC(Mode.CALM, undefined, { tileIdx: tile });
    expect(second.ok).toBe(false);
    expect(second.error).toBe('tile-occupied');
    expect(world.spawnDiagnostics.lastAttempt).toMatchObject({
      ok: false,
      error: 'tile-occupied',
      tileIdx: tile,
    });
  });

  it('fails gracefully when no open tile exists for random spawn', () => {
    // Fill the interior with walls to block every candidate tile.
    for(let y = 1; y < world.H - 1; y++){
      for(let x = 1; x < world.W - 1; x++){
        world.wall[idx(x, y)] = 1;
      }
    }
    const result = spawnNPC(Mode.CALM);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('no-open-tile');
    expect(world.spawnDiagnostics.lastAttempt).toMatchObject({
      ok: false,
      error: 'no-open-tile',
      tileIdx: -1,
    });
  });

  it('accepts fractional coordinates via options { x, y }', () => {
    const result = spawnNPC(Mode.CALM, undefined, { x: 15.2, y: 18.7 });
    expect(result.ok).toBe(true);
    const agent = getAgentById(result.agentId);
    expect(agent).toBeTruthy();
    expect(agent.x).toBe(Math.round(15.2));
    expect(agent.y).toBe(Math.round(18.7));
    expect(world.spawnDiagnostics.lastAttempt).toMatchObject({
      ok: true,
      tileIdx: idx(Math.round(15.2), Math.round(18.7)),
      agentId: result.agentId,
    });
  });
});
