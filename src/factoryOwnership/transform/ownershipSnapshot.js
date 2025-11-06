const DEFAULT_INFLUENCE_THRESHOLD = 0.05;

/**
 * Compute ownership entries for the provided snapshot without mutating runtime state.
 * @param {object} input
 * @param {{ width: number, dominantFaction: ArrayLike<number>, controlLevel: ArrayLike<number> }} input.world
 * @param {Array<{ tileIdx: number, resource: string | null }>} input.nodes
 * @param {Array<{ tileIdx: number, kind: string | null, orientation: string | null }>} input.structures
 * @param {number} [input.influenceThreshold]
 */
export function computeOwnershipEntries(input){
  const {
    world,
    nodes = [],
    structures = [],
    influenceThreshold = DEFAULT_INFLUENCE_THRESHOLD,
  } = input ?? {};

  const entries = [];
  const byFaction = new Map();
  const unassigned = [];

  const registerEntry = (entry) => {
    if(!entry) return;
    entries.push(entry);
    if(entry.factionId != null){
      if(!byFaction.has(entry.factionId)){
        byFaction.set(entry.factionId, []);
      }
      byFaction.get(entry.factionId).push(entry);
    } else {
      unassigned.push(entry);
    }
  };

  for(const node of nodes){
    if(!Number.isFinite(node?.tileIdx) || node.tileIdx < 0) continue;
    const ownership = resolveOwnershipAtTile(node.tileIdx, world, influenceThreshold);
    registerEntry(createNodeOwnershipEntry(node.tileIdx, node.resource ?? null, ownership, world.width));
  }

  for(const structure of structures){
    if(!Number.isFinite(structure?.tileIdx) || structure.tileIdx < 0) continue;
    const ownership = resolveOwnershipAtTile(structure.tileIdx, world, influenceThreshold);
    registerEntry(createStructureOwnershipEntry(structure, ownership, world.width));
  }

  sortOwnershipEntries(entries);
  sortOwnershipEntries(unassigned);
  for(const list of byFaction.values()){
    sortOwnershipEntries(list);
  }

  return { entries, byFaction, unassigned };
}

function resolveOwnershipAtTile(tileIdx, world, influenceThreshold){
  const rawDominant = world?.dominantFaction ? world.dominantFaction[tileIdx] : null;
  const dominantFactionId = typeof rawDominant === 'number' && rawDominant >= 0 ? rawDominant : null;
  const rawControl = world?.controlLevel ? world.controlLevel[tileIdx] : null;
  const control = clamp01(typeof rawControl === 'number' ? rawControl : 0);
  const hasOwnership = dominantFactionId != null && control > influenceThreshold;
  return {
    factionId: hasOwnership ? dominantFactionId : null,
    dominantFactionId,
    control,
  };
}

function createNodeOwnershipEntry(tileIdx, resource, ownership, worldWidth){
  return {
    id: `node:${tileIdx}:node`,
    tileIdx,
    coords: tileIdxToPoint(tileIdx, worldWidth),
    type: 'node',
    kind: 'node',
    control: ownership.control,
    factionId: ownership.factionId,
    dominantFactionId: ownership.dominantFactionId,
    resource,
  };
}

function createStructureOwnershipEntry(structure, ownership, worldWidth){
  const tileIdx = structure.tileIdx;
  return {
    id: `structure:${tileIdx}:${structure.kind ?? 'unknown'}`,
    tileIdx,
    coords: tileIdxToPoint(tileIdx, worldWidth),
    type: 'structure',
    kind: structure.kind ?? null,
    control: ownership.control,
    factionId: ownership.factionId,
    dominantFactionId: ownership.dominantFactionId,
    orientation: structure.orientation ?? null,
  };
}

function sortOwnershipEntries(list){
  if(!Array.isArray(list)) return;
  list.sort((a, b) => {
    const tileDelta = (a?.tileIdx ?? 0) - (b?.tileIdx ?? 0);
    if(tileDelta !== 0) return tileDelta;
    const typeDelta = String(a?.type ?? '').localeCompare(String(b?.type ?? ''));
    if(typeDelta !== 0) return typeDelta;
    return String(a?.kind ?? '').localeCompare(String(b?.kind ?? ''));
  });
}

function clamp01(value){
  if(!Number.isFinite(value)) return 0;
  if(value <= 0) return 0;
  if(value >= 1) return 1;
  return value;
}

function tileIdxToPoint(tileIdx, width){
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1;
  return {
    x: tileIdx % safeWidth,
    y: Math.floor(tileIdx / safeWidth),
  };
}
