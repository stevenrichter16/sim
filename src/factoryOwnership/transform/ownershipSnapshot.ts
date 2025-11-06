import {
  OwnershipEntryDTO,
  FactoryOrientation,
} from '../model/contracts';

const FACTORY_INFLUENCE_THRESHOLD = 0.05;

export interface WorldOwnershipGridSnapshot {
  width: number;
  dominantFaction: ArrayLike<number | null | undefined>;
  controlLevel: ArrayLike<number | null | undefined>;
}

export interface FactoryNodeSnapshot {
  tileIdx: number;
  resource: string | null;
}

export interface FactoryStructureSnapshot {
  tileIdx: number;
  kind: string | null;
  orientation: FactoryOrientation;
}

export interface OwnershipComputationInput {
  world: WorldOwnershipGridSnapshot;
  nodes: ReadonlyArray<FactoryNodeSnapshot>;
  structures: ReadonlyArray<FactoryStructureSnapshot>;
  influenceThreshold?: number;
}

export interface OwnershipComputationResult {
  entries: OwnershipEntryDTO[];
  byFaction: Map<number, OwnershipEntryDTO[]>;
  unassigned: OwnershipEntryDTO[];
}

interface OwnershipAtTileResult {
  factionId: number | null;
  dominantFactionId: number | null;
  control: number;
}

export function computeOwnershipEntries(input: OwnershipComputationInput): OwnershipComputationResult {
  const {
    world,
    nodes,
    structures,
    influenceThreshold = FACTORY_INFLUENCE_THRESHOLD,
  } = input;

  const entries: OwnershipEntryDTO[] = [];
  const byFaction = new Map<number, OwnershipEntryDTO[]>();
  const unassigned: OwnershipEntryDTO[] = [];

  const registerEntry = (entry: OwnershipEntryDTO | null | undefined) => {
    if(!entry) return;
    entries.push(entry);
    if(entry.factionId != null){
      const list = byFaction.get(entry.factionId);
      if(list){
        list.push(entry);
      } else {
        byFaction.set(entry.factionId, [entry]);
      }
    } else {
      unassigned.push(entry);
    }
  };

  for(const node of nodes){
    if(!Number.isFinite(node?.tileIdx) || node.tileIdx < 0) continue;
    const ownership = resolveOwnershipAtTile(node.tileIdx, world, influenceThreshold);
    const entry = createNodeOwnershipEntry(node.tileIdx, node.resource ?? null, ownership, world.width);
    registerEntry(entry);
  }

  for(const structure of structures){
    if(!Number.isFinite(structure?.tileIdx) || structure.tileIdx < 0) continue;
    const ownership = resolveOwnershipAtTile(structure.tileIdx, world, influenceThreshold);
    const entry = createStructureOwnershipEntry(structure, ownership, world.width);
    registerEntry(entry);
  }

  sortOwnershipEntries(entries);
  sortOwnershipEntries(unassigned);
  for(const list of byFaction.values()){
    sortOwnershipEntries(list);
  }

  return { entries, byFaction, unassigned };
}

function resolveOwnershipAtTile(
  tileIdx: number,
  world: WorldOwnershipGridSnapshot,
  influenceThreshold: number,
): OwnershipAtTileResult {
  const dominant = world.dominantFaction?.[tileIdx];
  const controlRaw = world.controlLevel?.[tileIdx];
  const control = clamp01(typeof controlRaw === 'number' ? controlRaw : 0);
  const dominantFactionId = typeof dominant === 'number' ? dominant : null;
  const hasOwnership = typeof dominantFactionId === 'number' && dominantFactionId >= 0 && control > influenceThreshold;
  return {
    factionId: hasOwnership ? dominantFactionId : null,
    dominantFactionId,
    control,
  };
}

function createNodeOwnershipEntry(
  tileIdx: number,
  resource: string | null,
  ownership: OwnershipAtTileResult,
  worldWidth: number,
): OwnershipEntryDTO | null {
  if(!resource){
    return null;
  }
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

function createStructureOwnershipEntry(
  structure: FactoryStructureSnapshot,
  ownership: OwnershipAtTileResult,
  worldWidth: number,
): OwnershipEntryDTO {
  return {
    id: `structure:${structure.tileIdx}:${structure.kind ?? 'unknown'}`,
    tileIdx: structure.tileIdx,
    coords: tileIdxToPoint(structure.tileIdx, worldWidth),
    type: 'structure',
    kind: structure.kind ?? null,
    control: ownership.control,
    factionId: ownership.factionId,
    dominantFactionId: ownership.dominantFactionId,
    orientation: structure.orientation ?? null,
  };
}

function sortOwnershipEntries(list: OwnershipEntryDTO[]): void {
  if(!Array.isArray(list)){
    return;
  }
  list.sort((a, b) => {
    const tileDelta = a.tileIdx - b.tileIdx;
    if(tileDelta !== 0){
      return tileDelta;
    }
    const typeDelta = String(a.type ?? '').localeCompare(String(b.type ?? ''));
    if(typeDelta !== 0){
      return typeDelta;
    }
    return String(a.kind ?? '').localeCompare(String(b.kind ?? ''));
  });
}

function clamp01(value: number): number {
  if(!Number.isFinite(value)){
    return 0;
  }
  if(value <= 0){
    return 0;
  }
  if(value >= 1){
    return 1;
  }
  return value;
}

function tileIdxToPoint(tileIdx: number, width: number){
  return {
    x: tileIdx % width,
    y: Math.floor(tileIdx / width),
  };
}
