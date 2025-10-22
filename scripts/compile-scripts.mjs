#!/usr/bin/env node
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { compileSource } from '../src/script/compiler.js';
import { serialiseCompiledProgram } from '../src/script/bytecode.js';
import { DEFAULT_CAPABILITIES } from '../src/script/runtime.js';

const workspaceRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

function parseArgs(argv) {
  const options = {
    src: path.join(workspaceRoot, 'scenarios'),
    out: path.join(workspaceRoot, 'data', 'scenarios'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--src' || arg === '-s') {
      options.src = path.resolve(workspaceRoot, argv[i + 1]);
      i += 1;
    } else if (arg === '--out' || arg === '-o') {
      options.out = path.resolve(workspaceRoot, argv[i + 1]);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }
  return options;
}

const KNOWN_CAPABILITIES = new Set(DEFAULT_CAPABILITIES);

function isScriptFile(filename) {
  return filename.endsWith('.sscript') || filename.endsWith('.scenario');
}

async function ensureDir(dir) {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function loadConfig(scriptPath) {
  const base = scriptPath.replace(/\.(sscript|scenario)$/i, '');
  const configPath = `${base}.config.json`;
  if (!existsSync(configPath)) {
    return {};
  }
  const raw = await readFile(configPath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse config for ${path.basename(scriptPath)}: ${error.message}`);
  }
}

async function compileScript(sourcePath, options) {
  const source = await readFile(sourcePath, 'utf8');
  const compiled = await compileSource(source);
  if (compiled.diagnostics.length > 0) {
    const formatted = compiled.diagnostics.map((d) => ` - ${d.message}`).join('\n');
    throw new Error(`Compilation failed for ${path.basename(sourcePath)}:\n${formatted}`);
  }
  const bytecode = serialiseCompiledProgram(compiled);
  const config = await loadConfig(sourcePath);
  const name = config.name ?? path.basename(sourcePath, path.extname(sourcePath));
  const capabilitiesFromConfig = Array.isArray(config.capabilities) ? config.capabilities.filter((cap) => typeof cap === 'string' && cap.trim().length > 0) : null;
  const capabilities = capabilitiesFromConfig && capabilitiesFromConfig.length > 0
    ? [...capabilitiesFromConfig]
    : [...DEFAULT_CAPABILITIES];
  const strictCapabilities = process.env.CI || process.env.SCENARIO_STRICT_CAPABILITIES === 'true';
  if (capabilitiesFromConfig && capabilitiesFromConfig.length > 0) {
    for (const cap of capabilitiesFromConfig) {
      if (!KNOWN_CAPABILITIES.has(cap)) {
        const message = `[compile-scripts] ${path.relative(options.src, sourcePath)}: unknown capability "${cap}"`;
        if (strictCapabilities) {
          throw new Error(message);
        }
        console.warn(message);
      }
    }
  }
  const sourceName = path.basename(sourcePath);
  const relativeSource = path.relative(options.src, sourcePath).replace(/\\/g, '/');
  const asset = {
    name,
    capabilities,
    bytecode,
    meta: {
      source: sourceName,
      relativeSource,
      generatedAt: new Date().toISOString(),
    },
  };

  const relativeFile = relativeSource.replace(/\.(sscript|scenario)$/i, '.json');
  const outFile = path.join(options.out, relativeFile);
  await ensureDir(path.dirname(outFile));
  await writeFile(outFile, `${JSON.stringify(asset, null, 2)}\n`, 'utf8');
  return {
    outputFile: outFile,
    manifestEntry: {
      key: relativeFile.replace(/\.json$/i, ''),
      name,
      file: relativeFile,
      source: relativeSource,
      capabilities,
    },
  };
}

async function collectScripts(dir, scripts = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectScripts(fullPath, scripts);
    } else if (entry.isFile() && isScriptFile(entry.name)) {
      scripts.push(fullPath);
    }
  }
  return scripts;
}

async function main() {
  const argv = process.argv.slice(2);
  const options = parseArgs(argv);
  if (options.help) {
    console.log('Usage: compile-scripts [--src <dir>] [--out <dir>]');
    process.exit(0);
    return;
  }

  try {
    const srcStat = await stat(options.src);
    if (!srcStat.isDirectory()) {
      throw new Error(`Source directory "${options.src}" is not a directory.`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
    return;
  }

  const scripts = await collectScripts(options.src);

  if (scripts.length === 0) {
    console.warn(`No .sscript or .scenario files found in ${options.src}.`);
    return;
  }

  let failure = false;
  const manifestEntries = [];
  for (const scriptPath of scripts) {
    try {
      const { outputFile, manifestEntry } = await compileScript(scriptPath, options);
      manifestEntries.push(manifestEntry);
      console.log(`Compiled ${path.basename(scriptPath)} → ${path.relative(workspaceRoot, outputFile)}`);
    } catch (error) {
      failure = true;
      console.error(error.message);
    }
  }

  if (manifestEntries.length > 0) {
    const indexPath = path.join(options.out, 'index.json');
    await ensureDir(path.dirname(indexPath));
    const manifest = {
      generatedAt: new Date().toISOString(),
      scenarios: manifestEntries.sort((a, b) => a.name.localeCompare(b.name)),
    };
    await writeFile(indexPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }

  if (failure) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
