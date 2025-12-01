export interface ManualReservationEndpoint {
  objectId?: string | null;
  portId?: string | null;
}

export interface ManualReservation {
  item?: string | null;
  provider?: ManualReservationEndpoint;
}

export interface SerializedClusterSnapshot {
  id: string;
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  objects?: Array<Record<string, unknown>>;
  links?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface RegistrySnapshot {
  clustersById: Map<string, SerializedClusterSnapshot>;
}

export interface NodeSnapshot {
  tileIdx: number;
  resource: string | null;
}

export interface StructureSnapshot {
  tileIdx: number;
  kind: string | null;
  orientation: string | null;
  recipeKey: string | null;
  availableRecipeKeys: string[] | null;
  activeRecipeIndex: number | null;
  blueprintKey: string | null;
  availableBlueprintKeys: string[] | null;
}

export interface FactoryOwnershipRuntimeInputs {
  world: {
    width: number;
    dominantFaction: ArrayLike<number>;
    controlLevel: ArrayLike<number>;
  };
  nodes: NodeSnapshot[];
  structures: StructureSnapshot[];
  nodesByTile: Map<number, NodeSnapshot>;
  structuresByTile: Map<number, StructureSnapshot>;
  registrySnapshot: RegistrySnapshot;
  manualReservations: ManualReservation[];
}
