import { describe, expect, it } from 'vitest';
import type { Course, Video, WatchEvent, WatchProgress } from '../types/domain';
import {
  COMPLETION_THRESHOLD,
  addWatchEvent,
  canPublishCourse,
  createProgressUpdate,
  getCourseProgress,
  getDailyWatchSeconds,
  getStreakDays,
  naturalCompare,
} from './domain';
import { STORAGE_KEY, loadSnapshot, resetStorage } from './storage';

const video = (id: string, status: Video['status'] = 'READY'): Video => ({
  id,
  courseId: 'course-1',
  title: id,
  fileName: `${id}.mp4`,
  durationSeconds: 120,
  status,
  orderIndex: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
});

const course = (videos: Video[]): Course => ({
  id: 'course-1',
  title: '中文启蒙课',
  subjectId: 'chinese',
  description: '',
  ageRange: '4-6岁',
  cover: { style: 'sun', colors: ['#2D86F5', '#EFF7FF'] },
  status: 'DRAFT',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  videoIds: videos.map(({ id }) => id),
});

describe('learning domain rules', () => {
  it('initializes and recovers versioned local storage without touching other keys', () => {
    localStorage.clear();
    localStorage.setItem('unrelated', 'keep');
    const initial = loadSnapshot();
    expect(initial.children.map((child) => child.name)).toEqual(['哥哥', '妹妹']);
    expect(localStorage.getItem(STORAGE_KEY)).toContain('course-chinese');

    localStorage.setItem(STORAGE_KEY, '{broken');
    expect(loadSnapshot().courses.length).toBeGreaterThan(0);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ courses: [] }));
    resetStorage();
    expect(localStorage.getItem(STORAGE_KEY)).toContain('course-chinese');
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });

  it('sorts lesson names naturally', () => {
    expect(naturalCompare('第10课', '第2课')).toBeGreaterThan(0);
  });

  it('only allows courses with READY videos to publish', () => {
    expect(canPublishCourse(course([video('第1课', 'UPLOADING')]), [video('第1课', 'UPLOADING')])).toEqual({
      ok: false,
      reason: '课程至少需要一个可播放视频',
    });
    expect(canPublishCourse(course([video('第1课')]), [video('第1课')])).toEqual({ ok: true });
  });

  it('keeps max progress while allowing the current position to move back', () => {
    const previous: WatchProgress = {
      childId: 'child-1', videoId: 'video-1', lastPositionSeconds: 95, maxProgress: 0.95,
      completed: true, totalWatchSeconds: 30, updatedAt: '2026-09-01T00:00:00.000Z',
    };
    const updated = createProgressUpdate(previous, { childId: 'child-1', videoId: 'video-1', lastPositionSeconds: 30, progress: 0.3, deltaWatchSeconds: 10 });
    expect(updated.lastPositionSeconds).toBe(30);
    expect(updated.maxProgress).toBe(0.95);
    expect(updated.completed).toBe(true);
    expect(COMPLETION_THRESHOLD).toBe(0.9);
  });

  it('marks 90 percent as completed', () => {
    expect(createProgressUpdate(undefined, {
      childId: 'child-1', videoId: 'video-1', lastPositionSeconds: 108, progress: 0.9, deltaWatchSeconds: 0,
    }).completed).toBe(true);
  });

  it('calculates course progress from completed playable videos', () => {
    const videos = [video('v1'), video('v2'), video('v3', 'FAILED')];
    const progress: WatchProgress[] = [
      { childId: 'child-1', videoId: 'v1', lastPositionSeconds: 100, maxProgress: 1, completed: true, totalWatchSeconds: 100, updatedAt: '' },
      { childId: 'child-1', videoId: 'v2', lastPositionSeconds: 20, maxProgress: 0.2, completed: false, totalWatchSeconds: 20, updatedAt: '' },
    ];
    expect(getCourseProgress(course(videos), videos, progress, 'child-1')).toBe(0.5);
  });

  it('isolates progress by childId', () => {
    const progress: WatchProgress[] = [
      { childId: 'child-1', videoId: 'v1', lastPositionSeconds: 100, maxProgress: 1, completed: true, totalWatchSeconds: 100, updatedAt: '' },
      { childId: 'child-2', videoId: 'v1', lastPositionSeconds: 10, maxProgress: 0.1, completed: false, totalWatchSeconds: 10, updatedAt: '' },
    ];
    expect(getCourseProgress(course([video('v1')]), [video('v1')], progress, 'child-2')).toBe(0);
  });

  it('does not create watch time while paused', () => {
    expect(addWatchEvent([], { childId: 'child-1', videoId: 'v1', isPlaying: false, deltaWatchSeconds: 10, positionSeconds: 20, occurredAt: '2026-09-11T01:00:00.000Z' })).toHaveLength(0);
    expect(addWatchEvent([], { childId: 'child-1', videoId: 'v1', isPlaying: true, deltaWatchSeconds: 10, positionSeconds: 20, occurredAt: '2026-09-11T01:00:00.000Z' })).toHaveLength(1);
  });

  it('counts days with at least 60 effective seconds in a streak', () => {
    const events: WatchEvent[] = [
      { id: 'e1', childId: 'child-1', videoId: 'v1', effectiveWatchSeconds: 60, occurredAt: '2026-09-11T10:00:00.000Z' },
      { id: 'e2', childId: 'child-1', videoId: 'v1', effectiveWatchSeconds: 30, occurredAt: '2026-09-10T10:00:00.000Z' },
      { id: 'e3', childId: 'child-1', videoId: 'v1', effectiveWatchSeconds: 30, occurredAt: '2026-09-10T11:00:00.000Z' },
    ];
    expect(getDailyWatchSeconds(events, 'child-1', '2026-09-10')).toBe(60);
    expect(getStreakDays(events, 'child-1', new Date('2026-09-11T12:00:00.000Z'))).toBe(2);
  });
});
