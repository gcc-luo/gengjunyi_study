import type { Course, Video, WatchEvent, WatchProgress } from '../types/domain';

export const COMPLETION_THRESHOLD = 0.9;
export const DAILY_STREAK_SECONDS = 60;
export const MAX_REASONABLE_SECONDS = Number.MAX_SAFE_INTEGER;

function clampFinite(value: number, minimum: number, maximum: number, fallback = minimum): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'zh-Hans', { numeric: true, sensitivity: 'base' });
}

export type PublishResult = { ok: true } | { ok: false; reason: string };

export function canPublishCourse(course: Course, videos: Video[]): PublishResult {
  if (!course.title.trim()) return { ok: false, reason: '课程名称不能为空' };
  if (!course.subjectId) return { ok: false, reason: '请选择课程学科' };
  if (!videos.some((video) => video.courseId === course.id && video.status === 'READY')) {
    return { ok: false, reason: '课程至少需要一个可播放视频' };
  }
  return { ok: true };
}

export function createProgressUpdate(
  previous: WatchProgress | undefined,
  input: Pick<WatchProgress, 'childId' | 'videoId' | 'lastPositionSeconds'> & { progress: number; deltaWatchSeconds: number; isPlaying: boolean; durationSeconds?: number; updatedAt?: string },
): WatchProgress {
  if (typeof input.isPlaying !== 'boolean') {
    throw new TypeError('isPlaying must be a boolean');
  }
  const progress = clampFinite(input.progress, 0, 1);
  const previousMaxProgress = clampFinite(previous?.maxProgress ?? 0, 0, 1);
  const maxProgress = Math.max(previousMaxProgress, progress);
  const previousTotalWatchSeconds = clampFinite(previous?.totalWatchSeconds ?? 0, 0, MAX_REASONABLE_SECONDS);
  const deltaWatchSeconds = clampFinite(input.deltaWatchSeconds, 0, MAX_REASONABLE_SECONDS);
  const durationSeconds = clampFinite(input.durationSeconds ?? MAX_REASONABLE_SECONDS, 0, MAX_REASONABLE_SECONDS);
  return {
    childId: input.childId,
    videoId: input.videoId,
    lastPositionSeconds: clampFinite(input.lastPositionSeconds, 0, durationSeconds),
    maxProgress,
    completed: maxProgress >= COMPLETION_THRESHOLD,
    totalWatchSeconds: Math.min(MAX_REASONABLE_SECONDS, previousTotalWatchSeconds + (input.isPlaying ? deltaWatchSeconds : 0)),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
}

export function addWatchEvent(events: WatchEvent[], input: { childId: string; videoId: string; isPlaying: boolean; deltaWatchSeconds: number; positionSeconds: number; occurredAt?: string }): WatchEvent[] {
  if (typeof input?.isPlaying !== 'boolean') {
    throw new TypeError('isPlaying must be a boolean');
  }
  const effectiveWatchSeconds = clampFinite(input.deltaWatchSeconds, 0, MAX_REASONABLE_SECONDS);
  if (!input.isPlaying || effectiveWatchSeconds <= 0) return events;
  const event: WatchEvent = {
    id: `${input.childId}:${input.videoId}:${input.occurredAt ?? Date.now()}`,
    childId: input.childId,
    videoId: input.videoId,
    effectiveWatchSeconds,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  };
  return [...events, event];
}

export function getCourseProgress(course: Course, videos: Video[], progress: WatchProgress[], childId: string): number {
  const playable = videos.filter((video) => video.courseId === course.id && video.status === 'READY');
  if (playable.length === 0) return 0;
  const completed = playable.filter((video) => progress.some((item) => item.childId === childId && item.videoId === video.id && item.completed)).length;
  return completed / playable.length;
}

/** Event dates use the ISO UTC `YYYY-MM-DD` portion, not the browser's local date. */
export function getLocalDateKey(value: Date | string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function startOfLocalWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const mondayOffset = start.getDay() === 0 ? 6 : start.getDay() - 1;
  start.setDate(start.getDate() - mondayOffset);
  return start;
}

export function isWithinLocalWeek(value: Date | string, now = new Date()): boolean {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= startOfLocalWeek(now).getTime() && timestamp <= now.getTime();
}

export function getDailyWatchSeconds(events: WatchEvent[], childId: string, date: Date | string): number {
  const targetDate = getLocalDateKey(date);
  return events
    .filter((event) => event.childId === childId && getLocalDateKey(event.occurredAt) === targetDate)
    .reduce((sum, event) => Math.min(MAX_REASONABLE_SECONDS, sum + clampFinite(event.effectiveWatchSeconds, 0, MAX_REASONABLE_SECONDS)), 0);
}

/** Streak days are evaluated using the browser's local calendar dates. */
export function getStreakDays(events: WatchEvent[], childId: string, now = new Date()): number {
  let days = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  while (getDailyWatchSeconds(events, childId, cursor) >= DAILY_STREAK_SECONDS) {
    days += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return days;
}
