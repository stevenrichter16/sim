import { FactoryKind } from '../../factory.js';

export const CloudFactoryPortDirection = Object.freeze({
  INPUT: 'input',
  OUTPUT: 'output',
});

function normaliseFactoryKind(kind){
  if(typeof kind !== 'string'){
    throw new TypeError('Factory object kind must be a string.');
  }
  const normalised = kind.toLowerCase();
  if(Object.values(FactoryKind).includes(normalised)){
    return normalised;
  }
  throw new RangeError(`Unsupported factory object kind: ${kind}`);
}

function normalisePortDirection(direction){
  if(!direction) return CloudFactoryPortDirection.INPUT;
  const lowered = String(direction).toLowerCase();
  if(lowered === CloudFactoryPortDirection.INPUT || lowered === CloudFactoryPortDirection.OUTPUT){
    return lowered;
  }
  throw new RangeError(`Unsupported port direction: ${direction}`);
}

function clonePlainObject(value){
  if(!value || typeof value !== 'object'){
    return {};
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error){
    return {};
  }
}

function cloneMetadata(metadata){
  return Object.freeze(clonePlainObject(metadata));
}

function createPortIdCandidate(port){
  if(port?.id) return String(port.id);
  if(port?.label) return String(port.label).trim().toLowerCase().replace(/\s+/g, '_');
  return null;
}

function createFactoryPort(def){
  if(!def){
    throw new TypeError('Cannot create a factory port from null or undefined.');
  }
  const idCandidate = createPortIdCandidate(def);
  if(!idCandidate){
    throw new Error('Factory port requires an identifier or label.');
  }
  const direction = normalisePortDirection(def.direction);
  const itemKeys = Array.isArray(def.itemKeys) ? [...new Set(def.itemKeys.map(String))] : [];
  const capacity = typeof def.capacity === 'number' && Number.isFinite(def.capacity) ? def.capacity : null;
  return Object.freeze({
    id: idCandidate,
    label: def.label ?? idCandidate,
    direction,
    itemKeys,
    capacity,
    metadata: cloneMetadata(def.metadata),
  });
}

export function createFactoryObject(def){
  if(!def){
    throw new TypeError('Factory object definition must be provided.');
  }
  const id = def.id ? String(def.id) : null;
  if(!id){
    throw new Error('Factory object requires a stable identifier.');
  }
  const kind = normaliseFactoryKind(def.kind);
  const label = def.label ?? kind;
  const description = def.description ?? '';
  const ports = Array.isArray(def.ports) ? def.ports.map(createFactoryPort) : [];
  const metadata = cloneMetadata(def.metadata);
  return Object.freeze({ id, kind, label, description, ports, metadata });
}

export function isFactoryObject(value){
  return !!value && typeof value === 'object' && typeof value.id === 'string' && typeof value.kind === 'string';
}

export function serialiseFactoryObject(object){
  if(!isFactoryObject(object)){
    throw new TypeError('Cannot serialise value that is not a factory object.');
  }
  return {
    id: object.id,
    kind: object.kind,
    label: object.label,
    description: object.description,
    ports: object.ports.map((port) => ({
      id: port.id,
      label: port.label,
      direction: port.direction,
      itemKeys: [...port.itemKeys],
      capacity: port.capacity,
      metadata: clonePlainObject(port.metadata),
    })),
    metadata: clonePlainObject(object.metadata),
  };
}

export function cloneFactoryObject(object){
  return createFactoryObject(serialiseFactoryObject(object));
}

export function getPortById(object, portId){
  if(!isFactoryObject(object)) return null;
  const targetId = String(portId);
  return object.ports.find((port) => port.id === targetId) ?? null;
}
