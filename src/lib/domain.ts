import type { Course, Video, WatchEvent, WatchProgress } from '../types/domain';

export const COMPLETION_THRESHOLD = 0.9;
export const DAILY_STREAK_SECONDS = 60;

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
  input: Pick<WatchProgress, 'childId' | 'videoId' | 'lastPositionSeconds'> & { progress: number; deltaWatchSeconds: number; updatedAt?: string },
): WatchProgress {
  const maxProgress = Math.max(previous?.maxProgress ?? 0, input.progress);
  return {
    childId: input.childId,
    videoId: input.videoId,
    lastPositionSeconds: input.lastPositionSeconds,
    maxProgress,
    completed: maxProgress >= COMPLETION_THRESHOLD,
    totalWatchSeconds: (previous?.totalWatchSeconds ?? 0) + Math.max(0, input.deltaWatchSeconds),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
}

export function addWatchEvent(events: WatchEvent[], input: { childId: string; videoId: string; isPlaying: boolean; deltaWatchSeconds: number; positionSeconds: number; occurredAt?: string }): WatchEvent[] {
  if (!input.isPlaying || input.deltaWatchSeconds <= 0) return events;
  const event: WatchEvent = {
    id: `${input.childId}:${input.videoId}:${input.occurredAt ?? Date.now()}`,
    childId: input.childId,
    videoId: input.videoId,
    effectiveWatchSeconds: input.deltaWatchSeconds,
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

export function getDailyWatchSeconds(events: WatchEvent[], childId: string, date: string): number {
  return events.filter((event) => event.childId === childId && event.occurredAt.slice(0, 10) === date).reduce((sum, event) => sum + event.effectiveWatchSeconds, 0);
}

export function getStreakDays(events: WatchEvent[], childId: string, now = new Date()): number {
  let days = 0;
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  while (getDailyWatchSeconds(events, childId, cursor.toISOString().slice(0, 10)) >= DAILY_STREAK_SECONDS) {
    days += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return days;
}
