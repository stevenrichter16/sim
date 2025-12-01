export interface SerializedClusterSnapshot {
  id: string;
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  objects?: Array<Record<string, unknown>>;
  links?: Array<Record<string, unknown>>;
}

export function serialiseCluster(cluster: unknown): SerializedClusterSnapshot;
export function upsertFactoryObject(cluster: unknown, def: unknown): unknown;
export function removeFactoryObject(cluster: unknown, objectId: string): unknown;
export function upsertLink(cluster: unknown, def: unknown): unknown;
export function removeLink(cluster: unknown, linkId: string): unknown;
