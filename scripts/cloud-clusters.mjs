#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import {
  createPresetCloudClusterRegistry,
  deserialiseCloudClusters,
  serialiseCloudClusters,
  getCloudClusterPresets,
} from '../src/cloudCluster/index.js';

const workspaceRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

function resolveFromWorkspace(targetPath){
  if(!targetPath) return null;
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(workspaceRoot, targetPath);
}

function parseArgs(argv){
  const options = {
    pretty: false,
    format: 'json',
  };
  for(let i = 0; i < argv.length; i += 1){
    const arg = argv[i];
    switch(arg){
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--list':
      case '-l':
        options.list = true;
        break;
      case '--export':
      case '-e':
        options.exportPath = resolveFromWorkspace(argv[i + 1]);
        i += 1;
        break;
      case '--import':
        options.importPath = resolveFromWorkspace(argv[i + 1]);
        i += 1;
        break;
      case '--out':
      case '-o':
        options.outPath = resolveFromWorkspace(argv[i + 1]);
        i += 1;
        break;
      case '--pretty':
      case '-p':
        options.pretty = true;
        break;
      case '--format':
      case '-f':
        options.format = (argv[i + 1] ?? 'json').toLowerCase();
        i += 1;
        break;
      default:
        break;
    }
  }
  return options;
}

function printHelp(){
  console.log(`Usage: cloud-clusters [options]

Actions:
  --list, -l                 List bundled cloud cluster presets.
  --export <file>, -e        Export presets to the given file (JSON by default).
  --import <file>            Validate and normalise a preset payload from JSON.

Options:
  --out <file>, -o           Destination for --import normalised output.
  --format <json|module>     Output format for --export (default json).
  --pretty, -p               Pretty-print JSON output.
  --help, -h                 Show this message.`);
}

async function ensureDir(filePath){
  const dir = path.dirname(filePath);
  if(!existsSync(dir)){
    await mkdir(dir, { recursive: true });
  }
}

function createModuleSource(presets){
  const json = JSON.stringify(presets, null, 2);
  return `export const CLOUD_CLUSTER_PRESETS = Object.freeze(${json});

export default CLOUD_CLUSTER_PRESETS;
`;
}

async function exportPresets(filePath, { format = 'json', pretty = false } = {}){
  if(!filePath){
    throw new Error('No export path provided.');
  }
  const presets = getCloudClusterPresets();
  await ensureDir(filePath);
  if(format === 'module'){
    const source = createModuleSource(presets);
    await writeFile(filePath, source, 'utf8');
    console.log(`Exported ${presets.length} presets to ${path.relative(workspaceRoot, filePath)} (ES module).`);
    return;
  }
  const spacing = pretty ? 2 : 0;
  const payload = JSON.stringify(presets, null, spacing);
  await writeFile(filePath, `${payload}\n`, 'utf8');
  console.log(`Exported ${presets.length} presets to ${path.relative(workspaceRoot, filePath)}.`);
}

async function importPresets(filePath, outPath, { pretty = false } = {}){
  if(!filePath){
    throw new Error('No import file specified.');
  }
  if(!existsSync(filePath)){
    throw new Error(`Import file not found: ${filePath}`);
  }
  const raw = await readFile(filePath, 'utf8');
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error){
    throw new Error(`Failed to parse JSON from ${filePath}: ${error.message}`);
  }
  const registry = deserialiseCloudClusters(payload);
  const serialised = serialiseCloudClusters(registry);
  if(!outPath){
    console.log(`Validated ${serialised.length} preset(s). Use --out to write a normalised file.`);
    return;
  }
  await ensureDir(outPath);
  const spacing = pretty ? 2 : 0;
  await writeFile(outPath, `${JSON.stringify(serialised, null, spacing)}\n`, 'utf8');
  console.log(`Normalised ${serialised.length} preset(s) to ${path.relative(workspaceRoot, outPath)}.`);
}

function listPresets(){
  const registry = createPresetCloudClusterRegistry();
  const entries = Array.from(registry.byId.values());
  if(entries.length === 0){
    console.log('No bundled presets found.');
    return;
  }
  console.log(`Bundled cloud cluster presets (${entries.length}):`);
  for(const cluster of entries){
    const objectCount = cluster.objects?.size ?? 0;
    const linkCount = cluster.links?.size ?? 0;
    console.log(` - ${cluster.id}: ${cluster.name ?? '(no name)'} [objects: ${objectCount}, links: ${linkCount}]`);
  }
}

async function main(){
  const options = parseArgs(process.argv.slice(2));
  if(options.help || (!options.list && !options.exportPath && !options.importPath)){
    printHelp();
    if(options.help){
      process.exit(0);
    } else {
      process.exit(1);
    }
    return;
  }
  try {
    if(options.list){
      listPresets();
    }
    if(options.exportPath){
      await exportPresets(options.exportPath, { format: options.format, pretty: options.pretty });
    }
    if(options.importPath){
      await importPresets(options.importPath, options.outPath, { pretty: options.pretty });
    }
  } catch (error){
    console.error(error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
