const DEFAULT_MAX_ENTRIES = 50;

export function formatDiagnostic(event) {
  if (!event || typeof event !== 'object') {
    return {
      type: 'info',
      message: 'Unknown event',
      tick: null,
      chunk: null,
      native: null,
      raw: event,
    };
  }
  return {
    type: typeof event.type === 'string' ? event.type : 'info',
    message: typeof event.message === 'string' ? event.message : 'No message provided.',
    tick: Number.isFinite(event.tick) ? event.tick : null,
    chunk: typeof event.chunk === 'string' ? event.chunk : (event.chunk?.name ?? null),
    native: typeof event.native === 'string' ? event.native : null,
    data: event.data ?? null,
    span: event.span ?? null,
    raw: event,
  };
}

export function createScenarioDiagnosticsStore(options = {}) {
  const maxEntries = Number.isFinite(options.maxEntries) && options.maxEntries > 0
    ? Math.floor(options.maxEntries)
    : DEFAULT_MAX_ENTRIES;
  const entries = [];

  function record(event) {
    const formatted = formatDiagnostic(event);
    entries.push({
      ...formatted,
      id: `${Date.now()}-${entries.length}`,
      timestamp: new Date(),
    });
    if (entries.length > maxEntries) {
      entries.splice(0, entries.length - maxEntries);
    }
    return formatted;
  }

  function clear() {
    entries.splice(0, entries.length);
  }

  function getEntries() {
    return entries.slice().reverse();
  }

  return {
    record,
    clear,
    getEntries,
    size: () => entries.length,
    maxEntries,
  };
}

export default {
  createScenarioDiagnosticsStore,
  formatDiagnostic,
};
