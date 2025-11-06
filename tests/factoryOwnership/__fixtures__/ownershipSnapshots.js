const WIDTH = 12;

function buildWorldTemplate(){
  return {
    width: WIDTH,
    dominantFaction: new Array(WIDTH * WIDTH).fill(-1),
    controlLevel: new Array(WIDTH * WIDTH).fill(0),
  };
}

export function makeBasicOwnershipSnapshot(){
  const world = buildWorldTemplate();
  const nodeTile = 14;
  const forgeTile = 26;

  world.dominantFaction[nodeTile] = 1;
  world.controlLevel[nodeTile] = 0.65;

  world.dominantFaction[forgeTile] = 1;
  world.controlLevel[forgeTile] = 0.72;

  return {
    world,
    nodes: [
      { tileIdx: nodeTile, resource: 'blood_vial' },
    ],
    structures: [
      { tileIdx: forgeTile, kind: 'factory-smelter-omni', orientation: 'north' },
    ],
  };
}

export function makeContestedOwnershipSnapshot(){
  const world = buildWorldTemplate();
  const contestedNode = 30;
  const claimedStructure = 42;

  world.dominantFaction[contestedNode] = 2;
  world.controlLevel[contestedNode] = 0.02; // below influence threshold

  world.dominantFaction[claimedStructure] = 3;
  world.controlLevel[claimedStructure] = 0.6;

  return {
    world,
    nodes: [
      { tileIdx: contestedNode, resource: 'nerve_thread' },
    ],
    structures: [
      { tileIdx: claimedStructure, kind: 'factory-belt', orientation: 'east' },
    ],
  };
}
