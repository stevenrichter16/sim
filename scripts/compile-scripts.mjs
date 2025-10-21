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
  const capabilities = Array.isArray(config.capabilities) && config.capabilities.length > 0
    ? [...config.capabilities]
    : [...DEFAULT_CAPABILITIES];
  const sourceName = path.basename(sourcePath);
  const relativeSource = path.relative(options.src, sourcePath);
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

  const outFile = path.join(options.out, `${path.basename(sourcePath, path.extname(sourcePath))}.json`);
  await ensureDir(path.dirname(outFile));
  await writeFile(outFile, `${JSON.stringify(asset, null, 2)}\n`, 'utf8');
  return outFile;
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

  const entries = await readdir(options.src, { withFileTypes: true });
  const scripts = entries
    .filter((entry) => entry.isFile() && isScriptFile(entry.name))
    .map((entry) => path.join(options.src, entry.name));

  if (scripts.length === 0) {
    console.warn(`No .sscript or .scenario files found in ${options.src}.`);
    return;
  }

  let failure = false;
  for (const scriptPath of scripts) {
    try {
      const outputFile = await compileScript(scriptPath, options);
      console.log(`Compiled ${path.basename(scriptPath)} → ${path.relative(workspaceRoot, outputFile)}`);
    } catch (error) {
      failure = true;
      console.error(error.message);
    }
  }

  if (failure) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
