export const APP_STATE_STORAGE_KEY = 'resonance.appState.v1';

function getBrowserStorage() {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function readSavedAppState(storage = getBrowserStorage()) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(APP_STATE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeSavedAppState(state, storage = getBrowserStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    // Ignore storage failures so playback controls remain usable in private or restricted contexts.
    return false;
  }
}
