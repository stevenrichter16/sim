export interface CloudClusterRegistry {
  byId: Map<string, unknown>;
  order: string[];
}

export function ensureRegistry(registry?: unknown): CloudClusterRegistry;
