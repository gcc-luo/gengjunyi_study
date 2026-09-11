import { createSeedSnapshot } from '../data/seed';
import type { Snapshot } from '../types/domain';

export const STORAGE_KEY = 'family-learning-app:v1';

function clone(snapshot: Snapshot): Snapshot {
  return JSON.parse(JSON.stringify(snapshot)) as Snapshot;
}

export function persistSnapshot(snapshot: Snapshot): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export function loadSnapshot(): Snapshot {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const snapshot = createSeedSnapshot();
    persistSnapshot(snapshot);
    return snapshot;
  }
  try {
    return clone(JSON.parse(raw) as Snapshot);
  } catch {
    const snapshot = createSeedSnapshot();
    persistSnapshot(snapshot);
    return snapshot;
  }
}

export function resetStorage(): Snapshot {
  localStorage.removeItem(STORAGE_KEY);
  return loadSnapshot();
}
