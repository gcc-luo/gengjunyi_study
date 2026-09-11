import { createSeedSnapshot } from '../data/seed';
import type { Snapshot } from '../types/domain';

export const STORAGE_KEY = 'family-learning-app:v1';

function clone(snapshot: Snapshot): Snapshot {
  return JSON.parse(JSON.stringify(snapshot)) as Snapshot;
}

const SNAPSHOT_ARRAY_KEYS: Array<keyof Snapshot> = [
  'subjects',
  'children',
  'courses',
  'videos',
  'watchProgress',
  'watchEvents',
  'favorites',
  'uploadTasks',
];

function isSnapshot(value: unknown): value is Snapshot {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return SNAPSHOT_ARRAY_KEYS.every((key) => Array.isArray(record[key]));
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
    const parsed: unknown = JSON.parse(raw);
    if (!isSnapshot(parsed)) throw new Error('Invalid snapshot shape');
    return clone(parsed);
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
