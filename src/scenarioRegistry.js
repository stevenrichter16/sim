const INDEX_URL = 'data/scenarios/index.json';

function normaliseScenarios(data) {
  if (!data || !Array.isArray(data)) return [];
  return data
    .map((entry) => ({
      key: typeof entry.key === 'string' ? entry.key : null,
      name: typeof entry.name === 'string' ? entry.name : (typeof entry.key === 'string' ? entry.key : 'Unnamed Scenario'),
      file: typeof entry.file === 'string' ? entry.file : null,
      source: typeof entry.source === 'string' ? entry.source : null,
      capabilities: Array.isArray(entry.capabilities) ? entry.capabilities : [],
    }))
    .filter((entry) => entry.file);
}

export async function fetchScenarioManifest() {
  if (typeof fetch !== 'function') {
    return [];
  }
  try {
    const response = await fetch(INDEX_URL, { cache: 'no-store' });
    if (!response.ok) {
      return [];
    }
    const body = await response.json();
    const scenarios = normaliseScenarios(body?.scenarios ?? body);
    return scenarios;
  } catch (error) {
    console.warn('[scenarioRegistry] failed to fetch manifest', error);
    return [];
  }
}

export async function fetchScenarioAsset(file) {
  const path = typeof file === 'string' ? file : file?.file;
  if (!path || typeof fetch !== 'function') {
    return null;
  }
  try {
    const response = await fetch(`data/scenarios/${path}`, { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (error) {
    console.warn('[scenarioRegistry] failed to fetch asset', path, error);
    return null;
  }
}

export default {
  fetchScenarioManifest,
  fetchScenarioAsset,
};
