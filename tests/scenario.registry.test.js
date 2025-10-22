import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchScenarioManifest, fetchScenarioAsset } from '../src/scenarioRegistry.js';

describe('scenario registry', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete global.fetch;
    }
    vi.restoreAllMocks();
  });

  it('fetches and normalises scenario manifest entries', async () => {
    const mockManifest = {
      generatedAt: new Date().toISOString(),
      scenarios: [
        { key: 'alpha', name: 'Alpha', file: 'alpha.json', capabilities: ['diag.write'] },
        { key: 'beta', file: 'nested/beta.json' },
      ],
    };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockManifest) });

    const manifest = await fetchScenarioManifest();

    expect(Array.isArray(manifest)).toBe(true);
    expect(manifest).toHaveLength(2);
    expect(manifest[0]).toEqual(expect.objectContaining({ key: 'alpha', file: 'alpha.json' }));
    expect(manifest[1]).toEqual(expect.objectContaining({ key: 'beta', file: 'nested/beta.json' }));
  });

  it('returns empty array when fetch fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'));
    const manifest = await fetchScenarioManifest();
    warn.mockRestore();
    expect(manifest).toEqual([]);
  });

  it('fetches scenario asset json', async () => {
    const assetData = { name: 'alpha-test' };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(assetData) });
    const result = await fetchScenarioAsset({ file: 'alpha.json' });
    expect(result).toEqual(assetData);
    expect(global.fetch).toHaveBeenCalledWith('data/scenarios/alpha.json', expect.any(Object));
  });

  it('returns null when asset fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
    const result = await fetchScenarioAsset({ file: 'missing.json' });
    expect(result).toBeNull();
  });
});
