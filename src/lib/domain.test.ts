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

  it('recovers seed for every invalid snapshot root or required array', () => {
    const requiredArrays = ['subjects', 'children', 'courses', 'videos', 'watchProgress', 'watchEvents', 'favorites', 'uploadTasks'];
    const invalidSnapshots: unknown[] = [null, [], ...requiredArrays.map((key) => ({ [key]: null }))];
    localStorage.clear();
    localStorage.setItem('unrelated', 'keep');

    for (const invalid of invalidSnapshots) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(invalid));
      expect(loadSnapshot().courses.map((item) => item.id)).toContain('course-chinese');
    }
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });

  it('recovers seed when stored entity arrays contain malformed records', () => {
    const valid = loadSnapshot();
    const invalidSnapshots: unknown[] = [
      { ...valid, subjects: [null] },
      { ...valid, subjects: [{ id: 'subject-only' }] },
      { ...valid, children: [null] },
      { ...valid, children: [{ id: 'child-only' }] },
      { ...valid, children: [{ ...valid.children[0], status: 'UNKNOWN' }] },
      { ...valid, courses: [null] },
      { ...valid, courses: [{ ...valid.courses[0], status: 'UNKNOWN' }] },
      { ...valid, videos: [null] },
      { ...valid, videos: [{ ...valid.videos[0], status: 'UNKNOWN' }] },
      { ...valid, watchProgress: [{}] },
      { ...valid, watchEvents: [{}] },
      { ...valid, favorites: [null] },
      { ...valid, favorites: [{}] },
      { ...valid, uploadTasks: [null] },
      { ...valid, uploadTasks: [{ ...valid.uploadTasks[0], status: 'UNKNOWN' }] },
    ];
    localStorage.setItem('unrelated', 'keep');

    for (const invalid of invalidSnapshots) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(invalid));
      expect(loadSnapshot().courses.map((item) => item.id)).toContain('course-chinese');
    }
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });

  it('recovers seed when stored date fields are not valid ISO dates', () => {
    const valid = loadSnapshot();
    const invalidSnapshots: unknown[] = [
      { ...valid, children: [{ ...valid.children[0], createdAt: '2026-09-11' }] },
      { ...valid, courses: [{ ...valid.courses[0], createdAt: 'not-a-date' }] },
      { ...valid, courses: [{ ...valid.courses[0], updatedAt: '2026-09-11 10:00:00' }] },
      { ...valid, videos: [{ ...valid.videos[0], createdAt: '2026-99-99T10:00:00.000Z' }] },
      { ...valid, courses: [{ ...valid.courses[0], createdAt: '2026-02-29T00:00:00Z' }] },
      { ...valid, videos: [{ ...valid.videos[0], createdAt: '2026-04-31T00:00:00.000Z' }] },
      { ...valid, watchProgress: [{ ...valid.watchProgress[0], updatedAt: '2026-09-11T-not-time' }] },
      { ...valid, watchEvents: [{ ...valid.watchEvents[0], occurredAt: '2026-09-11T-not-time' }] },
      { ...valid, favorites: [{ ...valid.favorites[0], createdAt: '2026-09-11T' }] },
    ];
    localStorage.setItem('unrelated', 'keep');

    for (const invalid of invalidSnapshots) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(invalid));
      expect(loadSnapshot()).toEqual(valid);
    }
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });

  it('recovers seed for stored numbers above the safe integer limit', () => {
    const valid = loadSnapshot();
    const invalidSnapshots: unknown[] = [
      { ...valid, videos: [{ ...valid.videos[0], durationSeconds: Number.MAX_SAFE_INTEGER + 1 }] },
      { ...valid, watchProgress: [{ ...valid.watchProgress[0], totalWatchSeconds: Number.MAX_SAFE_INTEGER + 1 }] },
    ];
    localStorage.setItem('unrelated', 'keep');

    for (const invalid of invalidSnapshots) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(invalid));
      expect(loadSnapshot()).toEqual(valid);
    }
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });

  it('accepts legitimate fractional video durations', () => {
    const valid = loadSnapshot();
    const withFractionalDuration = { ...valid, videos: [{ ...valid.videos[0], durationSeconds: 1.5 }, ...valid.videos.slice(1)] };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(withFractionalDuration));
    expect(loadSnapshot().videos[0].durationSeconds).toBe(1.5);
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
    const updated = createProgressUpdate(previous, { childId: 'child-1', videoId: 'video-1', lastPositionSeconds: 30, progress: 0.3, deltaWatchSeconds: 10, isPlaying: true });
    expect(updated.lastPositionSeconds).toBe(30);
    expect(updated.maxProgress).toBe(0.95);
    expect(updated.completed).toBe(true);
    expect(COMPLETION_THRESHOLD).toBe(0.9);
  });

  it('does not accumulate progress watch time when paused', () => {
    const previous: WatchProgress = {
      childId: 'child-1', videoId: 'video-1', lastPositionSeconds: 20, maxProgress: 0.2,
      completed: false, totalWatchSeconds: 30, updatedAt: '2026-09-01T00:00:00.000Z',
    };
    const updated = createProgressUpdate(previous, {
      childId: 'child-1', videoId: 'video-1', lastPositionSeconds: 30, progress: 0.3,
      deltaWatchSeconds: 10, isPlaying: false,
    });
    expect(updated.totalWatchSeconds).toBe(30);
  });

  it('clamps invalid progress and watch values without producing non-finite results', () => {
    const previous: WatchProgress = {
      childId: 'child-1', videoId: 'video-1', lastPositionSeconds: Number.POSITIVE_INFINITY, maxProgress: Number.NaN,
      completed: false, totalWatchSeconds: Number.POSITIVE_INFINITY, updatedAt: '2026-09-01T00:00:00.000Z',
    };
    const updated = createProgressUpdate(previous, {
      childId: 'child-1', videoId: 'video-1', lastPositionSeconds: -10, progress: Number.NaN,
      deltaWatchSeconds: Number.POSITIVE_INFINITY, isPlaying: true,
    });
    expect(updated.lastPositionSeconds).toBe(0);
    expect(updated.maxProgress).toBe(0);
    expect(updated.totalWatchSeconds).toBe(0);
    expect(Number.isFinite(updated.lastPositionSeconds)).toBe(true);
    expect(Number.isFinite(updated.maxProgress)).toBe(true);
    expect(Number.isFinite(updated.totalWatchSeconds)).toBe(true);

    const clamped = createProgressUpdate(undefined, {
      childId: 'child-1', videoId: 'video-1', lastPositionSeconds: Number.MAX_VALUE, progress: 2,
      deltaWatchSeconds: -10, isPlaying: true,
    });
    expect(clamped.lastPositionSeconds).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(clamped.maxProgress).toBe(1);
    expect(clamped.totalWatchSeconds).toBe(0);
  });

  it('caps progress accumulation at MAX_SAFE_INTEGER', () => {
    const updated = createProgressUpdate({
      childId: 'child-1', videoId: 'video-1', lastPositionSeconds: 0, maxProgress: 0,
      completed: false, totalWatchSeconds: Number.MAX_SAFE_INTEGER - 5, updatedAt: '2026-09-01T00:00:00.000Z',
    }, {
      childId: 'child-1', videoId: 'video-1', lastPositionSeconds: Number.MAX_SAFE_INTEGER,
      progress: 0, deltaWatchSeconds: 10, isPlaying: true,
    });
    expect(updated.totalWatchSeconds).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('requires a boolean isPlaying value at runtime', () => {
    const input = { childId: 'child-1', videoId: 'video-1', lastPositionSeconds: 0, progress: 0, deltaWatchSeconds: 0 };
    expect(() => createProgressUpdate(undefined, input as never)).toThrow(TypeError);
    expect(() => createProgressUpdate(undefined, { ...input, isPlaying: 'yes' } as never)).toThrow(TypeError);
  });

  it('marks 90 percent as completed', () => {
    expect(createProgressUpdate(undefined, {
      childId: 'child-1', videoId: 'video-1', lastPositionSeconds: 108, progress: 0.9, deltaWatchSeconds: 0, isPlaying: true,
    }).completed).toBe(true);
  });

  it('caps saved position at the corresponding video duration', () => {
    expect(createProgressUpdate(undefined, {
      childId: 'child-1', videoId: 'video-1', lastPositionSeconds: 999, durationSeconds: 120,
      progress: 1, deltaWatchSeconds: 0, isPlaying: false,
    }).lastPositionSeconds).toBe(120);
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

  it('requires a boolean isPlaying value for watch events', () => {
    const input = { childId: 'child-1', videoId: 'v1', deltaWatchSeconds: 10, positionSeconds: 20 };
    expect(() => addWatchEvent([], input as never)).toThrow(TypeError);
    expect(() => addWatchEvent([], { ...input, isPlaying: 'yes' } as never)).toThrow(TypeError);

    const events: WatchEvent[] = [{ id: 'existing', childId: 'child-1', videoId: 'v1', effectiveWatchSeconds: 10, occurredAt: '2026-09-11T01:00:00.000Z' }];
    expect(addWatchEvent(events, { ...input, isPlaying: false })).toBe(events);
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

  it('uses the ISO UTC date when aggregating events near midnight', () => {
    const events: WatchEvent[] = [
      { id: 'utc-boundary', childId: 'child-1', videoId: 'v1', effectiveWatchSeconds: 60, occurredAt: '2026-09-10T23:30:00.000Z' },
    ];
    expect(getDailyWatchSeconds(events, 'child-1', '2026-09-10')).toBe(60);
    expect(getDailyWatchSeconds(events, 'child-1', '2026-09-11')).toBe(0);
  });
});
