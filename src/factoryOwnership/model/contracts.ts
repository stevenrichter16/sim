/**
 * Shared data-transfer contracts for factory ownership transforms.
 * These interfaces provide a typed bridge between the simulation,
 * cloud-cluster UI, and devtool layers as we migrate into TypeScript.
 *
 * The goal for Phase 1+ is to have the runtime emit these shapes
 * from pure transforms while the orchestration layer remains thin.
 */

export type FactoryOwnershipObjectType = 'node' | 'structure';

export type FactoryOrientation = 'north' | 'east' | 'south' | 'west' | null;

export interface TileCoordsDTO {
  x: number;
  y: number;
}

export interface OwnershipEntryDTO {
  id: string;
  tileIdx: number;
  coords: TileCoordsDTO;
  type: FactoryOwnershipObjectType;
  kind: string | null;
  control: number;
  factionId: number | null;
  dominantFactionId: number | null;
  resource?: string | null;
  orientation?: FactoryOrientation;
  metadata?: Record<string, unknown>;
}

export interface FactoryNodeDTO extends OwnershipEntryDTO {
  type: 'node';
  kind: 'node';
  resource: string | null;
}

export interface StructureDTO extends OwnershipEntryDTO {
  type: 'structure';
  kind: string;
  orientation: FactoryOrientation;
}

export interface LinkEndpointDTO {
  objectId: string;
  portId: string;
}

export type LinkDirection = 'input' | 'output';

export interface LinkPortDTO {
  id: string;
  direction: LinkDirection;
  label: string;
  itemKeys: string[];
  metadata?: Record<string, unknown>;
}

export interface ClusterObjectDTO {
  id: string;
  kind: string;
  label: string;
  description?: string;
  metadata: Record<string, unknown>;
  ports: LinkPortDTO[];
}

export interface LinkDTO {
  id: string;
  source: LinkEndpointDTO;
  target: LinkEndpointDTO;
  metadata?: Record<string, unknown>;
}

export interface RejectionLogEntry {
  consumerId: string;
  consumerPortId: string;
  requiredItem?: string | null;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface AllocationAuditEntry {
  consumerId: string;
  consumerPortId: string;
  assignedProviders: Array<{
    providerId: string;
    portId: string;
    item?: string | null;
  }>;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface MetadataDelta {
  objectId: string;
  key: string;
  previousValue: unknown;
  nextValue: unknown;
}

export interface ManualLinkReconciliationDTO {
  preservedLinks: LinkDTO[];
  droppedLinks: LinkDTO[];
  missingTargets: LinkDTO[];
}

export interface FactionOwnershipSnapshot {
  nodes: FactoryNodeDTO[];
  structures: StructureDTO[];
  existingLinks: LinkDTO[];
  existingManualLinks: LinkDTO[];
}

export interface AllocationResult {
  links: LinkDTO[];
  rejectedPorts: RejectionLogEntry[];
  auditTrail: AllocationAuditEntry[];
  reconciliation?: ManualLinkReconciliationDTO;
}

export interface RegistryDiffV1 {
  addedObjects: ClusterObjectDTO[];
  removedObjects: ClusterObjectDTO[];
  addedLinks: LinkDTO[];
  removedLinks: LinkDTO[];
  metadataChanges: MetadataDelta[];
  preservedManualLinks: LinkDTO[];
  droppedManualLinks: LinkDTO[];
}

export interface FactoryOwnershipDiffBundle {
  version: FactoryOwnershipSchemaVersion;
  snapshot: FactionOwnershipSnapshot;
  allocation: AllocationResult;
  diff: RegistryDiffV1;
}

export const FACTORY_OWNERSHIP_SCHEMA_VERSION = 'v1' as const;

export type FactoryOwnershipSchemaVersion = typeof FACTORY_OWNERSHIP_SCHEMA_VERSION;
