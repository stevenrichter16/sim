export const CloudFactoryPortDirection: Readonly<{
  INPUT: 'input';
  OUTPUT: 'output';
}>;

export type CloudFactoryPortDirectionValue =
  (typeof CloudFactoryPortDirection)[keyof typeof CloudFactoryPortDirection];

export function createFactoryObject(def: unknown): unknown;
export function cloneFactoryObject(object: unknown): unknown;
export function serialiseFactoryObject(object: unknown): unknown;
export function isFactoryObject(value: unknown): value is Record<string, unknown>;
export function getPortById(object: unknown, portId: string): unknown;
