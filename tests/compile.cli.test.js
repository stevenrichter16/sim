import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const workspaceRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const cliPath = join(workspaceRoot, 'scripts', 'compile-scripts.mjs');

describe('compile-scripts CLI', () => {
  let root;
  let srcDir;
  let nestedDir;
  let outDir;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'scenario-cli-'));
    srcDir = join(root, 'scenarios');
    nestedDir = join(srcDir, 'nested');
    outDir = join(root, 'data', 'scenarios');
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(nestedDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });
  });

  afterEach(() => {
    if (root && existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('compiles .sscript files to JSON assets with metadata', () => {
    const source = `
      let counter = 0;

      fn onInit(seed) {
        counter = seed;
      }

      fn onTick(frame, dt) {
        counter = counter + 1;
        schedule(1, "onTick");
      }
    `;

    const scriptPath = join(srcDir, 'loop.sscript');
    writeFileSync(scriptPath, source.trim(), 'utf8');
    writeFileSync(join(srcDir, 'loop.config.json'), JSON.stringify({
      name: 'loop-test',
      capabilities: ['fire.write', 'runtime.schedule'],
    }, null, 2));

    const nestedSource = `
      fn onTick(frame, dt) {
        call ignite(5, 0.6);
      }
    `;
    const nestedScriptPath = join(nestedDir, 'hazard.sscript');
    writeFileSync(nestedScriptPath, nestedSource.trim(), 'utf8');
    writeFileSync(join(nestedDir, 'hazard.config.json'), JSON.stringify({
      name: 'nested-hazard',
      capabilities: ['fire.write', 'unknown.cap'],
    }, null, 2));

    const result = spawnSync(
      process.execPath,
      [cliPath, '--src', srcDir, '--out', outDir],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('unknown capability "unknown.cap"');

    const outputPath = join(outDir, 'loop.json');
    expect(existsSync(outputPath)).toBe(true);

    const asset = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(asset.name).toBe('loop-test');
    expect(Array.isArray(asset.capabilities)).toBe(true);
    expect(asset.capabilities).toContain('runtime.schedule');
    expect(asset.bytecode).toBeDefined();
    expect(Array.isArray(asset.bytecode.chunks)).toBe(true);
    expect(typeof asset.bytecode.entryPoints?.onTick).toBe('string');
    expect(asset.meta?.source).toBe(basename(scriptPath));
    expect(asset.meta?.relativeSource).toBe('loop.sscript');

    const nestedOutputPath = join(outDir, 'nested', 'hazard.json');
    expect(existsSync(nestedOutputPath)).toBe(true);
    const nestedAsset = JSON.parse(readFileSync(nestedOutputPath, 'utf8'));
    expect(nestedAsset.capabilities).toContain('unknown.cap');
    expect(nestedAsset.meta?.relativeSource).toBe('nested/hazard.sscript');

    const indexPath = join(outDir, 'index.json');
    expect(existsSync(indexPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(typeof manifest.generatedAt).toBe('string');
    expect(Array.isArray(manifest.scenarios)).toBe(true);
    const manifestKeys = manifest.scenarios.map((entry) => entry.key);
    expect(manifestKeys).toEqual(expect.arrayContaining(['loop', 'nested/hazard']));
  });
});
