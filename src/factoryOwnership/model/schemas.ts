import contractsSchema from './contracts.schema.json';

export const factoryOwnershipSchemas = {
  contracts: contractsSchema,
} as const;

export type FactoryOwnershipSchemaKey = keyof typeof factoryOwnershipSchemas;

export function getFactoryOwnershipSchema<T extends FactoryOwnershipSchemaKey>(
  key: T,
) {
  return factoryOwnershipSchemas[key];
}
