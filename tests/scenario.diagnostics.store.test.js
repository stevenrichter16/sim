import { describe, it, expect } from 'vitest';
import { createScenarioDiagnosticsStore, formatDiagnostic } from '../src/scenarioDiagnosticsStore.js';

describe('scenario diagnostics store', () => {
  it('normalises diagnostic events', () => {
    const formatted = formatDiagnostic({
      type: 'error',
      message: 'Capability missing',
      tick: 42,
      chunk: { name: 'onTick' },
      native: 'ignite',
    });
    expect(formatted).toEqual(expect.objectContaining({
      type: 'error',
      message: 'Capability missing',
      tick: 42,
      chunk: 'onTick',
      native: 'ignite',
    }));
  });

  it('stores entries and respects max size', () => {
    const store = createScenarioDiagnosticsStore({ maxEntries: 2 });
    store.record({ message: 'First' });
    store.record({ message: 'Second' });
    store.record({ message: 'Third' });

    const entries = store.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].message).toBe('Third');
    expect(entries[1].message).toBe('Second');
  });

  it('clears entries', () => {
    const store = createScenarioDiagnosticsStore();
    store.record({ message: 'Event' });
    expect(store.size()).toBe(1);
    store.clear();
    expect(store.size()).toBe(0);
  });
});
