declare module '../../cloudCluster/domain/factoryObject.js' {
  export const CloudFactoryPortDirection: Readonly<{
    INPUT: 'input';
    OUTPUT: 'output';
  }>;

  export type CloudFactoryPortDirectionValue =
    (typeof CloudFactoryPortDirection)[keyof typeof CloudFactoryPortDirection];

  export function createFactoryObject(def: unknown): unknown;
  export function isFactoryObject(value: unknown): value is Record<string, unknown>;
  export function serialiseFactoryObject(object: unknown): unknown;
  export function cloneFactoryObject(object: unknown): unknown;
  export function getPortById(object: unknown, portId: string): unknown;
}

declare module '../../cloudCluster/domain/cluster.js' {
  export function serialiseCluster(cluster: unknown): {
    id: string;
    name?: string;
    description?: string;
    metadata?: Record<string, unknown>;
    objects?: Array<Record<string, unknown>>;
    links?: Array<Record<string, unknown>>;
  };
  export function upsertFactoryObject(cluster: unknown, def: unknown): unknown;
  export function removeFactoryObject(cluster: unknown, objectId: string): unknown;
  export function upsertLink(cluster: unknown, def: unknown): unknown;
  export function removeLink(cluster: unknown, linkId: string): unknown;
}

declare module '../../cloudCluster/sim/index.js' {
  export function updateClusterAccumulatorMembership(
    clusterId: string,
    payload?: { added?: string[]; removed?: string[] },
  ): void;
}

declare module '../../cloudCluster/registry.js' {
  export function ensureRegistry(registry?: unknown): {
    byId: Map<string, unknown>;
    order: string[];
  };
}

declare module '../../cloudCluster/state/index.js' {
  export function getCloudClusterRegistry(): {
    byId: Map<string, unknown>;
    order: string[];
  };
  export function setCloudClusterRegistry(registry: {
    byId: Map<string, unknown>;
    order: string[];
  }): void;
  export function getCloudClusterState(): Record<string, unknown>;
}

export {};
