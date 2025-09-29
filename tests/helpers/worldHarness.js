import { world, resetWorld, idx } from '../../src/state.js';
import { baseStringFor } from '../../src/materials.js';

export function initWorld({ o2 = 0.21 } = {}) {
  resetWorld(o2);
  return world;
}

export function placeMode(x, y, mode) {
  const i = idx(x, y);
  world.strings[i] = baseStringFor(mode);
  return i;
}

export function tileIndex(x, y) {
  return idx(x, y);
}
