import type { CloudClusterRegistry } from '../registry.js';

export function getCloudClusterRegistry(): CloudClusterRegistry;
export function setCloudClusterRegistry(registry: CloudClusterRegistry): void;
export function getCloudClusterState(): Record<string, unknown>;
