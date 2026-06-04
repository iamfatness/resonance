import { describe, expect, it, vi } from 'vitest';
import { APP_STATE_STORAGE_KEY, readSavedAppState, writeSavedAppState } from './storage.js';

function createMemoryStorage(initialValue) {
  const values = new Map();
  if (initialValue !== undefined) values.set(APP_STATE_STORAGE_KEY, initialValue);
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value)),
  };
}

describe('app state storage', () => {
  it('returns null when no storage is available', () => {
    expect(readSavedAppState(null)).toBeNull();
    expect(writeSavedAppState({ activeDeck: 'A' }, null)).toBe(false);
  });

  it('returns null for missing or malformed saved state', () => {
    expect(readSavedAppState(createMemoryStorage())).toBeNull();
    expect(readSavedAppState(createMemoryStorage('{bad json'))).toBeNull();
  });

  it('reads valid saved state JSON', () => {
    const savedState = { activeDeck: 'B', repeatMode: true };

    expect(readSavedAppState(createMemoryStorage(JSON.stringify(savedState)))).toEqual(savedState);
  });

  it('writes saved state with the stable storage key', () => {
    const storage = createMemoryStorage();
    const savedState = { activeDeck: 'A', deckCount: 2 };

    expect(writeSavedAppState(savedState, storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(APP_STATE_STORAGE_KEY, JSON.stringify(savedState));
  });

  it('ignores storage read/write failures', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      setItem: vi.fn(() => {
        throw new Error('blocked');
      }),
    };

    expect(readSavedAppState(storage)).toBeNull();
    expect(writeSavedAppState({ activeDeck: 'A' }, storage)).toBe(false);
  });
});
