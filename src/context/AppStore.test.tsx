import { renderHook, act } from '@testing-library/react';
import { AppStoreProvider, useAppStore } from './AppStore';
import { createSeedSnapshot } from '../data/seed';
import { CourseStatus, VideoStatus, type Course, type Video } from '../types/domain';
import { STORAGE_KEY } from '../lib/storage';

function wrapper({ children }: { children: React.ReactNode }) {
  const snapshot = createSeedSnapshot();
  snapshot.watchProgress = [];
  snapshot.watchEvents = [];
  return <AppStoreProvider initialSnapshot={snapshot}>{children}</AppStoreProvider>;
}

describe('AppStore', () => {
  it('creates a draft course by default', () => {
    const { result } = renderHook(() => useAppStore(), { wrapper });

    let course!: Course;
    act(() => {
      course = result.current.createCourse({ title: '新课程', subjectId: 'math' });
    });

    expect(course.status).toBe(CourseStatus.DRAFT);
    expect(result.current.courses).toContainEqual(course);
  });

  it('rejects publishing when no video is ready', () => {
    const { result } = renderHook(() => useAppStore(), { wrapper });
    let course!: Course;
    act(() => { course = result.current.createCourse({ title: '待发布', subjectId: 'math' }); });

    let publishResult;
    act(() => { publishResult = result.current.publishCourse(course.id); });

    expect(publishResult).toEqual({ ok: false, reason: '课程至少需要一个可播放视频' });
  });

  it('assigns natural order indexes when adding videos', () => {
    const { result } = renderHook(() => useAppStore(), { wrapper });
    let course!: Course;
    act(() => { course = result.current.createCourse({ title: '排序课程', subjectId: 'math' }); });
    let first!: Video;
    let second!: Video;
    act(() => {
      first = result.current.addVideo(course.id, { title: '第10课', fileName: '第10课.mp4', durationSeconds: 10, status: VideoStatus.READY });
      second = result.current.addVideo(course.id, { title: '第2课', fileName: '第2课.mp4', durationSeconds: 10, status: VideoStatus.READY });
    });

    expect(first.orderIndex).toBe(1);
    expect(second.orderIndex).toBe(2);
  });

  it('scopes progress and events to the selected child', () => {
    const { result } = renderHook(() => useAppStore(), { wrapper });
    act(() => result.current.saveWatchProgress({ childId: 'child-gege', videoId: 'video-chinese-2', lastPositionSeconds: 20, progress: 0.2, deltaWatchSeconds: 10, isPlaying: true }));
    act(() => result.current.selectChild('child-meimei'));
    act(() => result.current.saveWatchProgress({ childId: 'child-meimei', videoId: 'video-chinese-2', lastPositionSeconds: 40, progress: 0.4, deltaWatchSeconds: 10, isPlaying: true }));

    expect(result.current.progress).toEqual([expect.objectContaining({ childId: 'child-meimei', lastPositionSeconds: 40 })]);
    act(() => result.current.selectChild('child-gege'));
    expect(result.current.progress).toEqual([expect.objectContaining({ childId: 'child-gege', lastPositionSeconds: 20 })]);
  });

  it('updates progress by child and video without overwriting another combination', () => {
    const { result } = renderHook(() => useAppStore(), { wrapper });
    act(() => result.current.saveWatchProgress({ childId: 'child-gege', videoId: 'video-chinese-2', lastPositionSeconds: 20, progress: 0.2, deltaWatchSeconds: 10, isPlaying: true }));
    act(() => result.current.saveWatchProgress({ childId: 'child-gege', videoId: 'video-chinese-3', lastPositionSeconds: 30, progress: 0.3, deltaWatchSeconds: 10, isPlaying: true }));
    act(() => result.current.saveWatchProgress({ childId: 'child-gege', videoId: 'video-chinese-2', lastPositionSeconds: 50, progress: 0.5, deltaWatchSeconds: 10, isPlaying: true }));

    expect(result.current.progress).toEqual(expect.arrayContaining([
      expect.objectContaining({ childId: 'child-gege', videoId: 'video-chinese-2', lastPositionSeconds: 50 }),
      expect.objectContaining({ childId: 'child-gege', videoId: 'video-chinese-3', lastPositionSeconds: 30 }),
    ]));
  });

  it('keeps watch events when taking a course offline', () => {
    const { result } = renderHook(() => useAppStore(), { wrapper });
    const before = result.current.watchEvents;
    act(() => result.current.offlineCourse('course-chinese'));
    expect(result.current.courses.find((course) => course.id === 'course-chinese')?.status).toBe(CourseStatus.OFFLINE);
    expect(result.current.watchEvents).toEqual(before);
  });

  it('rejects progress writes for a child outside the current scope', () => {
    const { result } = renderHook(() => useAppStore(), { wrapper });
    act(() => result.current.selectChild('child-gege'));
    expect(() => result.current.saveWatchProgress({ childId: 'child-meimei', videoId: 'video-chinese-2', lastPositionSeconds: 40, progress: 0.4, deltaWatchSeconds: 10, isPlaying: true })).toThrow('当前孩子');
    expect(result.current.progress).toEqual([]);
    expect(result.current.watchEvents).toEqual([]);

    act(() => result.current.saveWatchProgress({ childId: 'child-gege', videoId: 'video-chinese-2', lastPositionSeconds: 20, progress: 0.2, deltaWatchSeconds: 10, isPlaying: true }));
    expect(result.current.progress).toEqual([expect.objectContaining({ childId: 'child-gege', videoId: 'video-chinese-2' })]);
    expect(result.current.watchEvents).toHaveLength(1);
  });

  it('persists course and progress commands to localStorage', () => {
    const { result } = renderHook(() => useAppStore(), { wrapper });
    let course!: Course;
    act(() => { course = result.current.createCourse({ title: '持久化课程', subjectId: 'math' }); });
    const afterCourse = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(afterCourse.courses).toEqual(expect.arrayContaining([expect.objectContaining({ id: course.id, title: '持久化课程' })]));

    act(() => result.current.saveWatchProgress({ childId: 'child-gege', videoId: 'video-chinese-2', lastPositionSeconds: 20, progress: 0.2, deltaWatchSeconds: 10, isPlaying: true }));
    const afterProgress = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(afterProgress.watchProgress).toEqual(expect.arrayContaining([expect.objectContaining({ childId: 'child-gege', videoId: 'video-chinese-2' })]));
  });
});
