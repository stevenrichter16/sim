import {
  CloudFactoryPortDirection,
  createFactoryObject,
  getPortById,
  isFactoryObject,
  serialiseFactoryObject,
} from './factoryObject.js';

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

function createEndpoint(def){
  if(!def){
    throw new TypeError('Link endpoint payload must be provided.');
  }
  const objectId = def.objectId ? String(def.objectId) : null;
  const portId = def.portId ? String(def.portId) : null;
  if(!objectId || !portId){
    throw new Error('Link endpoint requires both an objectId and portId.');
  }
  return { objectId, portId };
}

function resolvePortDirection(objects, endpoint){
  const object = objects.get(endpoint.objectId);
  if(!isFactoryObject(object)){
    throw new Error(`Link references unknown factory object: ${endpoint.objectId}`);
  }
  const port = getPortById(object, endpoint.portId);
  if(!port){
    throw new Error(`Link references missing port ${endpoint.portId} on ${endpoint.objectId}`);
  }
  return port.direction;
}

function createClusterLink(def, objects){
  if(!def){
    throw new TypeError('Cluster link definition must be provided.');
  }
  const id = def.id ? String(def.id) : null;
  if(!id){
    throw new Error('Cluster link requires a stable identifier.');
  }
  const source = createEndpoint(def.source ?? def.from);
  const target = createEndpoint(def.target ?? def.to);
  const sourceDirection = resolvePortDirection(objects, source);
  const targetDirection = resolvePortDirection(objects, target);
  if(sourceDirection !== CloudFactoryPortDirection.OUTPUT){
    throw new Error(`Link source must be an output port. Received ${sourceDirection}.`);
  }
  if(targetDirection !== CloudFactoryPortDirection.INPUT){
    throw new Error(`Link target must be an input port. Received ${targetDirection}.`);
  }
  return Object.freeze({
    id,
    source,
    target,
    metadata: cloneMetadata(def.metadata),
  });
}

export function createCluster(def = {}){
  const id = def.id ? String(def.id) : null;
  if(!id){
    throw new Error('Cluster requires a stable identifier.');
  }
  const name = def.name ?? id;
  const description = def.description ?? '';
  const metadata = cloneMetadata(def.metadata);
  const objects = new Map();
  if(Array.isArray(def.objects)){
    for(const objectDef of def.objects){
      const object = createFactoryObject(objectDef);
      if(objects.has(object.id)){
        throw new Error(`Duplicate factory object id detected: ${object.id}`);
      }
      objects.set(object.id, object);
    }
  }
  const links = new Map();
  if(Array.isArray(def.links)){
    for(const linkDef of def.links){
      const link = createClusterLink(linkDef, objects);
      if(links.has(link.id)){
        throw new Error(`Duplicate link id detected: ${link.id}`);
      }
      links.set(link.id, link);
    }
  }
  return {
    id,
    name,
    description,
    metadata,
    objects,
    links,
  };
}

export function isCluster(value){
  return !!value && typeof value === 'object' && typeof value.id === 'string' && value.objects instanceof Map;
}

export function serialiseCluster(cluster){
  if(!isCluster(cluster)){
    throw new TypeError('Cannot serialise value that is not a cluster.');
  }
  return {
    id: cluster.id,
    name: cluster.name,
    description: cluster.description,
    metadata: clonePlainObject(cluster.metadata),
    objects: Array.from(cluster.objects.values(), (object) => serialiseFactoryObject(object)),
    links: Array.from(cluster.links.values(), (link) => ({
      id: link.id,
      source: { ...link.source },
      target: { ...link.target },
      metadata: clonePlainObject(link.metadata),
    })),
  };
}

export function cloneCluster(cluster){
  return createCluster(serialiseCluster(cluster));
}

export function upsertFactoryObject(cluster, def){
  if(!isCluster(cluster)){
    throw new TypeError('Expected a cluster instance.');
  }
  const object = createFactoryObject(def);
  cluster.objects.set(object.id, object);
  return object;
}

export function removeFactoryObject(cluster, objectId){
  if(!isCluster(cluster)){
    throw new TypeError('Expected a cluster instance.');
  }
  const targetId = String(objectId);
  const removed = cluster.objects.delete(targetId);
  if(removed){
    for(const [linkId, link] of cluster.links.entries()){
      if(link.source.objectId === targetId || link.target.objectId === targetId){
        cluster.links.delete(linkId);
      }
    }
  }
  return removed;
}

export function upsertLink(cluster, def){
  if(!isCluster(cluster)){
    throw new TypeError('Expected a cluster instance.');
  }
  const link = createClusterLink(def, cluster.objects);
  cluster.links.set(link.id, link);
  return link;
}

export function removeLink(cluster, linkId){
  if(!isCluster(cluster)){
    throw new TypeError('Expected a cluster instance.');
  }
  return cluster.links.delete(String(linkId));
}
