import { createSeedSnapshot } from '../data/seed';
import type {
  Child,
  Course,
  Favorite,
  Snapshot,
  Subject,
  UploadTask,
  Video,
  WatchEvent,
  WatchProgress,
} from '../types/domain';

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

const SUBJECT_IDS = new Set(['english', 'chinese', 'math', 'science']);
const CHILD_STATUSES = new Set(['ACTIVE', 'INACTIVE']);
const COURSE_STATUSES = new Set(['DRAFT', 'PUBLISHED', 'OFFLINE']);
const VIDEO_STATUSES = new Set(['UPLOADING', 'READY', 'FAILED']);
const UPLOAD_STATUSES = new Set(['QUEUED', 'UPLOADING', 'COMPLETED', 'CANCELLED', 'FAILED']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasNonEmptyString(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === 'string' && record[key].trim().length > 0;
}

function isIsoDateString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{3})?Z$/.exec(value);
  if (!match || Number.isNaN(Date.parse(value))) return false;
  const date = new Date(value);
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3]);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= Number.MAX_SAFE_INTEGER;
}

function isProgress(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0);
}

function isSubject(value: unknown): value is Subject {
  if (!isRecord(value)) return false;
  return SUBJECT_IDS.has(String(value.id))
    && hasNonEmptyString(value, 'name')
    && hasNonEmptyString(value, 'color')
    && hasNonEmptyString(value, 'icon');
}

function isChild(value: unknown): value is Child {
  if (!isRecord(value)) return false;
  return hasNonEmptyString(value, 'id')
    && hasNonEmptyString(value, 'name')
    && hasNonEmptyString(value, 'avatar')
    && hasNonEmptyString(value, 'grade')
    && typeof value.status === 'string' && CHILD_STATUSES.has(value.status)
    && isIsoDateString(value.createdAt);
}

function isCourse(value: unknown): value is Course {
  if (!isRecord(value)) return false;
  const cover = value.cover;
  return hasNonEmptyString(value, 'id')
    && hasNonEmptyString(value, 'title')
    && typeof value.subjectId === 'string' && SUBJECT_IDS.has(value.subjectId)
    && typeof value.description === 'string'
    && typeof value.ageRange === 'string'
    && isRecord(cover)
    && hasNonEmptyString(cover, 'style')
    && isStringArray(cover.colors)
    && typeof value.status === 'string' && COURSE_STATUSES.has(value.status)
    && isStringArray(value.videoIds)
    && isIsoDateString(value.createdAt)
    && isIsoDateString(value.updatedAt);
}

function isVideo(value: unknown): value is Video {
  if (!isRecord(value)) return false;
  return hasNonEmptyString(value, 'id')
    && hasNonEmptyString(value, 'courseId')
    && hasNonEmptyString(value, 'title')
    && hasNonEmptyString(value, 'fileName')
    && isFiniteNonNegative(value.durationSeconds)
    && typeof value.status === 'string' && VIDEO_STATUSES.has(value.status)
    && isFiniteNonNegative(value.orderIndex)
    && isIsoDateString(value.createdAt);
}

function isWatchProgress(value: unknown): value is WatchProgress {
  if (!isRecord(value)) return false;
  return hasNonEmptyString(value, 'childId')
    && hasNonEmptyString(value, 'videoId')
    && isFiniteNonNegative(value.lastPositionSeconds)
    && isProgress(value.maxProgress)
    && typeof value.completed === 'boolean'
    && isFiniteNonNegative(value.totalWatchSeconds)
    && isIsoDateString(value.updatedAt);
}

function isWatchEvent(value: unknown): value is WatchEvent {
  if (!isRecord(value)) return false;
  return hasNonEmptyString(value, 'id')
    && hasNonEmptyString(value, 'childId')
    && hasNonEmptyString(value, 'videoId')
    && isFiniteNonNegative(value.effectiveWatchSeconds)
    && isIsoDateString(value.occurredAt);
}

function isFavorite(value: unknown): value is Favorite {
  if (!isRecord(value)) return false;
  return hasNonEmptyString(value, 'id')
    && hasNonEmptyString(value, 'childId')
    && isIsoDateString(value.createdAt)
    && (hasNonEmptyString(value, 'courseId') || hasNonEmptyString(value, 'videoId'));
}

function isUploadTask(value: unknown): value is UploadTask {
  if (!isRecord(value)) return false;
  return hasNonEmptyString(value, 'id')
    && hasNonEmptyString(value, 'courseId')
    && hasNonEmptyString(value, 'fileName')
    && isProgress(value.progress)
    && typeof value.status === 'string' && UPLOAD_STATUSES.has(value.status)
    && (value.error === undefined || typeof value.error === 'string')
    && (value.videoId === undefined || hasNonEmptyString(value, 'videoId'));
}

function isSnapshot(value: unknown): value is Snapshot {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return SNAPSHOT_ARRAY_KEYS.every((key) => Array.isArray(record[key]))
    && (record.subjects as unknown[]).every(isSubject)
    && (record.children as unknown[]).every(isChild)
    && (record.courses as unknown[]).every(isCourse)
    && (record.videos as unknown[]).every(isVideo)
    && (record.watchProgress as unknown[]).every(isWatchProgress)
    && (record.watchEvents as unknown[]).every(isWatchEvent)
    && (record.favorites as unknown[]).every(isFavorite)
    && (record.uploadTasks as unknown[]).every(isUploadTask);
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
