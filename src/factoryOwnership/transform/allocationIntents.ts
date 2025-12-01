/// <reference path="../types/external-modules.d.ts" />

import {
  CLOUD_CLUSTER_AUTO_LINK_PREFIX,
} from '../constants.js';
import { CloudFactoryPortDirection } from '../../../src/cloudCluster/domain/factoryObject.js';

export function computeAllocationIntents({
  clusterId,
  desiredObjects,
  ownershipInputs,
  clusterSnapshot,
  manualReservations = [],
  dependencies = {},
}: any = {}){
  const objectsMap = desiredObjects instanceof Map ? desiredObjects : new Map();
  const manualReservationList = Array.isArray(manualReservations) ? manualReservations : [];
  const { FactoryKind } = dependencies;

  const providersByItem = buildProviderInventory(objectsMap);
  applyManualReservations(providersByItem, manualReservationList);

  const { links: existingLinks } = normaliseClusterSnapshot(clusterSnapshot);
  const existingAutoLinkKeys = new Map();
  for(const [id, link] of existingLinks.entries()){
    if(isAutoLink(link, id)){
      const key = makeAutoLinkKey(link.source?.objectId, link.source?.portId, link.target?.objectId, link.target?.portId, link.metadata?.item);
      existingAutoLinkKeys.set(key, link);
    }
  }

  const allocationLinks = new Map<string, any>();
  const rejectedPorts: any[] = [];
  const auditTrail: any[] = [];

  for(const object of objectsMap.values()){
    if(!object?.id){
      continue;
    }
    const isSmelter = FactoryKind ? object.kind === FactoryKind.SMELTER : object.kind === 'smelter';
    if(!isSmelter){
      continue;
    }
    const inputPorts = Array.isArray(object.ports)
      ? object.ports.filter((port: any) => port.direction === CloudFactoryPortDirection.INPUT)
      : [];
    for(const port of inputPorts){
      const auditEntry: any = {
        consumerId: object.id,
        consumerPortId: port.id,
        assignedProviders: [],
      };
      const preferredItem = port?.metadata?.item ?? (Array.isArray(port?.itemKeys) && port.itemKeys.length ? port.itemKeys[0] : null);
      const provider = takeProvider(providersByItem, preferredItem);
      if(provider){
        const linkKey = makeAutoLinkKey(provider.objectId, provider.portId, object.id, port.id, provider.item);
        const linkId = buildAutoLinkId(clusterId, provider.objectId, object.id, provider.item);
        if(!allocationLinks.has(linkKey)){
          allocationLinks.set(linkKey, {
            id: linkId,
            source: { objectId: provider.objectId, portId: provider.portId },
            target: { objectId: object.id, portId: port.id },
            metadata: {
              auto: true,
              factionClusterId: clusterId,
              item: provider.item,
            },
          });
        }
        auditEntry.assignedProviders.push({
          providerId: provider.objectId,
          portId: provider.portId,
          item: provider.item,
        });
        auditTrail.push(auditEntry);
        continue;
      }
      rejectedPorts.push({
        consumerId: object.id,
        consumerPortId: port.id,
        requiredItem: preferredItem,
        reason: 'provider_unavailable',
      });
      auditEntry.notes = 'provider_unavailable';
      auditTrail.push(auditEntry);
    }
    if(!inputPorts.length){
      auditTrail.push({
        consumerId: object.id,
        consumerPortId: null,
        assignedProviders: [],
        notes: 'no_input_ports_detected',
      });
    }
  }

  for(const [key, link] of existingAutoLinkKeys.entries()){
    if(allocationLinks.has(key)){
      continue;
    }
    const sourceId = link?.source?.objectId ?? null;
    const targetId = link?.target?.objectId ?? null;
    if(!sourceId || !targetId){
      continue;
    }
    if(!objectsMap.has(sourceId) || !objectsMap.has(targetId)){
      continue;
    }
    allocationLinks.set(key, link);
  }

  return {
    links: Array.from(allocationLinks.values()),
    rejectedPorts,
    auditTrail,
  };
}

function buildProviderInventory(desiredObjects: any){
  const providers = new Map();
  for(const object of desiredObjects.values()){
    const outputPorts = Array.isArray(object?.ports)
      ? object.ports.filter((port: any) => port.direction === CloudFactoryPortDirection.OUTPUT)
      : [];
    for(const port of outputPorts){
      const items = extractPortItems(port);
      for(const item of items){
        registerProvider(providers, item, {
          objectId: object.id,
          portId: port.id,
          item,
        });
      }
    }
  }
  return providers;
}

function extractPortItems(port: any){
  const items = [];
  if(port?.metadata?.item){
    items.push(port.metadata.item);
  }
  if(Array.isArray(port?.itemKeys) && port.itemKeys.length){
    items.push(port.itemKeys[0]);
  }
  return items.filter(Boolean);
}

function registerProvider(store: any, item: string | null, provider: any){
  if(!item || !provider){
    return;
  }
  let list = store.get(item);
  if(!list){
    list = [];
    store.set(item, list);
  }
  list.push({ ...provider });
}

function applyManualReservations(store: any, reservations: any[]){
  for(const reservation of reservations){
    const item = reservation?.item ?? null;
    const providerId = reservation?.provider?.objectId;
    const providerPortId = reservation?.provider?.portId;
    if(!item || !providerId || !providerPortId) continue;
    const list = store.get(item);
    if(!Array.isArray(list)) continue;
    const index = list.findIndex((entry) => entry.objectId === providerId && entry.portId === providerPortId);
    if(index >= 0){
      list.splice(index, 1);
      if(list.length === 0){
        store.delete(item);
      }
    }
  }
}

function takeProvider(store: any, preferredItem: string | null){
  if(preferredItem){
    return pullProviderForItem(store, preferredItem);
  }
  for(const item of store.keys()){
    const provider = pullProviderForItem(store, item);
    if(provider){
      return provider;
    }
  }
  return null;
}

function pullProviderForItem(store: any, item: string | null){
  if(!item || !store.has(item)){
    return null;
  }
  const list = store.get(item);
  if(!Array.isArray(list) || !list.length){
    store.delete(item);
    return null;
  }
  const provider = list.shift();
  if(!list.length){
    store.delete(item);
  }
  return provider;
}

function normaliseClusterSnapshot(snapshot: any){
  const objects = new Map();
  const links = new Map();
  if(snapshot?.objects instanceof Map){
    for(const [id, object] of snapshot.objects.entries()){
      objects.set(id, object);
    }
  } else if(Array.isArray(snapshot?.objects)){
    for(const object of snapshot.objects){
      if(object?.id){
        objects.set(object.id, object);
      }
    }
  }
  if(snapshot?.links instanceof Map){
    for(const [id, link] of snapshot.links.entries()){
      links.set(id, link);
    }
  } else if(Array.isArray(snapshot?.links)){
    for(const link of snapshot.links){
      const id = link?.id ?? makeAutoLinkKey(
        link?.source?.objectId ?? '',
        link?.source?.portId ?? '',
        link?.target?.objectId ?? '',
        link?.target?.portId ?? '',
        link?.metadata?.item ?? '',
      );
      links.set(id, link);
    }
  }
  return { objects, links };
}

function isAutoLink(link: any, linkId: string){
  if(!link){
    return false;
  }
  const metaAuto = link?.metadata?.auto === true;
  const idAuto = typeof linkId === 'string' && linkId.startsWith(CLOUD_CLUSTER_AUTO_LINK_PREFIX);
  return metaAuto || idAuto;
}

function makeAutoLinkKey(sourceObjectId: string | null, sourcePortId: string | null, targetObjectId: string | null, targetPortId: string | null, item: string | null){
  return `${sourceObjectId ?? ''}:${sourcePortId ?? ''}->${targetObjectId ?? ''}:${targetPortId ?? ''}:${item ?? ''}`;
}

function buildAutoLinkId(clusterId: string | null, sourceObjectId: string, targetObjectId: string, item: string | null){
  return `${CLOUD_CLUSTER_AUTO_LINK_PREFIX}${clusterId}:${sourceObjectId}->${targetObjectId}:${item ?? ''}`;
}
