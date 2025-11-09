#!/usr/bin/env node

import process from 'node:process';
import { getFactoryOwnership } from '../src/factory.js';

const args = new Set(process.argv.slice(2));
const ownership = getFactoryOwnership();
const bundles = ownership.diffBundles ?? [];
const manualWarnings = ownership.manualLinkWarnings ?? [];

if(args.has('--json')){
  console.log(JSON.stringify({ bundles, manualWarnings }, null, 2));
  process.exit(0);
}

console.log(`[trace:factory-ownership] captured ${bundles.length} diff bundle(s).`);
for(const envelope of bundles){
  const { factionId, clusterId, bundle } = envelope;
  const addedObjects = bundle?.diff?.addedObjects?.length ?? 0;
  const removedObjects = bundle?.diff?.removedObjects?.length ?? 0;
  const addedLinks = bundle?.diff?.addedLinks?.length ?? 0;
  const removedLinks = bundle?.diff?.removedLinks?.length ?? 0;
  console.log(`- faction ${factionId} (${clusterId}): +${addedObjects} obj, -${removedObjects} obj, +${addedLinks} links, -${removedLinks} links`);
}

if(manualWarnings.length){
  console.log('\nManual link warnings:');
  for(const warning of manualWarnings){
    const ids = (warning.droppedLinks ?? []).map((link) => link.id).join(', ') || 'unknown';
    console.warn(`- cluster ${warning.clusterId} dropped manual links: ${ids}`);
  }
} else {
  console.log('\nNo manual link warnings detected.');
}
