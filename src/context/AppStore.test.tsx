import { fireEvent, render, renderHook, act, screen } from '@testing-library/react';
import { useLayoutEffect, useRef } from 'react';
import { AppStoreProvider, useAppStore } from './AppStore';
import { createSeedSnapshot } from '../data/seed';
import { CourseStatus, VideoStatus, type Course, type Video } from '../types/domain';
import { loadSnapshot, STORAGE_KEY } from '../lib/storage';
import { ProgressBar } from '../components/ProgressBar';
import { Modal } from '../components/Modal';

function wrapper({ children }: { children: React.ReactNode }) {
  const snapshot = createSeedSnapshot();
  snapshot.watchProgress = [];
  snapshot.watchEvents = [];
  return <AppStoreProvider initialSnapshot={snapshot}><SelectChildForStoreTests>{children}</SelectChildForStoreTests></AppStoreProvider>;
}

function SelectChildForStoreTests({ children }: { children: React.ReactNode }) {
  const { selectChild } = useAppStore();
  const selected = useRef(false);
  useLayoutEffect(() => {
    if (!selected.current) {
      selected.current = true;
      selectChild('child-gege');
    }
  }, []);
  return <>{children}</>;
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

  it('caps saved progress position at the matching video duration', () => {
    const { result } = renderHook(() => useAppStore(), { wrapper });

    act(() => result.current.saveWatchProgress({ childId: 'child-gege', videoId: 'video-chinese-2', lastPositionSeconds: 999, progress: 1, deltaWatchSeconds: 0, isPlaying: false }));

    expect(result.current.progress).toEqual([expect.objectContaining({ videoId: 'video-chinese-2', lastPositionSeconds: 310 })]);
  });

  it('does not create progress or watch events for an unknown video', () => {
    const { result } = renderHook(() => useAppStore(), { wrapper });
    const beforeProgress = result.current.progress;
    const beforeEvents = result.current.watchEvents;

    act(() => result.current.saveWatchProgress({ childId: 'child-gege', videoId: 'missing-video', lastPositionSeconds: 12, progress: 0.5, deltaWatchSeconds: 10, isPlaying: true }));

    expect(result.current.progress).toEqual(beforeProgress);
    expect(result.current.watchEvents).toEqual(beforeEvents);
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

  it('returns an empty child scope and preserves storage when no child is selected', () => {
    const { result } = renderHook(() => useAppStore(), { wrapper });
    act(() => result.current.selectChild(null));
    const before = localStorage.getItem(STORAGE_KEY);

    expect(result.current.currentChild).toBeUndefined();
    expect(result.current.progress).toEqual([]);
    expect(result.current.watchEvents).toEqual([]);
    expect(result.current.favorites).toEqual([]);
    expect(() => result.current.saveWatchProgress({ childId: 'child-gege', videoId: 'video-chinese-2', lastPositionSeconds: 20, progress: 0.2, deltaWatchSeconds: 10, isPlaying: true })).toThrow('当前孩子');
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
  });

  it('persists a draft with an empty age range without restoring seed data', () => {
    const { result } = renderHook(() => useAppStore(), { wrapper });
    let course!: Course;
    act(() => { course = result.current.createCourse({ title: '无年龄草稿', subjectId: 'math' }); });

    const loaded = loadSnapshot();
    expect(loaded.courses).toEqual(expect.arrayContaining([expect.objectContaining({ id: course.id, title: '无年龄草稿', ageRange: '' })]));
  });

  it('clamps upload progress to finite values between zero and one', () => {
    const { result } = renderHook(() => useAppStore(), { wrapper });
    let taskId = '';
    act(() => { taskId = result.current.createUploadTask({ courseId: 'course-chinese', fileName: '安全进度.mp4' }).id; });

    act(() => result.current.updateUploadTask(taskId, { progress: 2 }));
    expect(result.current.uploadTasks.find((task) => task.id === taskId)?.progress).toBe(1);
    act(() => result.current.updateUploadTask(taskId, { progress: -0.5 }));
    expect(result.current.uploadTasks.find((task) => task.id === taskId)?.progress).toBe(0);
    act(() => result.current.updateUploadTask(taskId, { progress: Number.NaN }));
    expect(result.current.uploadTasks.find((task) => task.id === taskId)?.progress).toBe(0);
    act(() => result.current.updateUploadTask(taskId, { progress: Number.POSITIVE_INFINITY }));
    expect(result.current.uploadTasks.find((task) => task.id === taskId)?.progress).toBe(0);

    expect(loadSnapshot().uploadTasks.find((task) => task.id === taskId)?.progress).toBe(0);
  });

  it('resets to seed data by default', () => {
    const { result } = renderHook(() => useAppStore(), { wrapper });
    act(() => { result.current.createCourse({ title: '需要恢复的课程', subjectId: 'math' }); });
    act(() => { result.current.resetSnapshot(); });

    expect(result.current.courses.map((course) => course.id)).toEqual(createSeedSnapshot().courses.map((course) => course.id));
    expect(result.current.courses.some((course) => course.title === '需要恢复的课程')).toBe(false);
  });

  it('corrects the selected child after reset when the old child no longer exists', () => {
    const snapshot = createSeedSnapshot();
    snapshot.children = [{ id: 'temporary-child', name: '临时孩子', avatar: '🌟', grade: '一年级', status: 'ACTIVE', createdAt: new Date().toISOString() }];
    const { result } = renderHook(() => useAppStore(), { wrapper: ({ children }) => <AppStoreProvider initialSnapshot={snapshot}>{children}</AppStoreProvider> });
    act(() => result.current.selectChild('temporary-child'));
    act(() => result.current.resetSnapshot());
    expect(result.current.currentChildId).toBe('child-gege');
  });

  it('exposes accessible progress and closes modal with Escape', () => {
    render(<ProgressBar value={0.4} />);
    const progress = screen.getByRole('progressbar');
    expect(progress).toHaveAttribute('aria-valuenow', '40');
    expect(progress).toHaveAttribute('aria-valuemin', '0');
    expect(progress).toHaveAttribute('aria-valuemax', '100');

    const onClose = vi.fn();
    render(<Modal open title="测试弹层" onClose={onClose}><button type="button">内容</button></Modal>);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', 'modal-title');
    expect(screen.getByRole('button', { name: '关闭' })).toHaveAttribute('type', 'button');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses the latest snapshot across consecutive course commands', () => {
    const { result } = renderHook(() => useAppStore(), { wrapper });
    let course!: Course;
    act(() => {
      course = result.current.createCourse({ title: '连续操作', subjectId: 'math' });
      result.current.updateCourse(course.id, { title: '连续操作已更新' });
      result.current.addVideo(course.id, { title: '第一课', fileName: '1.mp4', durationSeconds: 60, status: VideoStatus.READY });
      expect(result.current.publishCourse(course.id)).toEqual({ ok: true });
    });
    expect(result.current.courses).toEqual(expect.arrayContaining([expect.objectContaining({ id: course.id, title: '连续操作已更新', status: CourseStatus.PUBLISHED })]));
  });

  it('uses the latest snapshot across consecutive favorite commands', () => {
    const { result } = renderHook(() => useAppStore(), { wrapper });
    let first;
    let second;
    act(() => {
      first = result.current.toggleFavorite({ courseId: 'course-space' });
      second = result.current.toggleFavorite({ courseId: 'course-space' });
    });
    expect(first).toEqual(expect.objectContaining({ courseId: 'course-space' }));
    expect(second).toBeUndefined();
    expect(result.current.favorites).not.toEqual(expect.arrayContaining([expect.objectContaining({ courseId: 'course-space' })]));
  });

  it('traps Tab focus inside the modal', () => {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.textContent = '打开';
    document.body.appendChild(trigger);
    trigger.focus();
    const onClose = vi.fn();
    render(<Modal open title="焦点测试" onClose={onClose}><button type="button">内容</button></Modal>);
    const dialog = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: '关闭' });
    const content = screen.getByRole('button', { name: '内容' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(content);
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalled();
    document.body.removeChild(trigger);
  });
});
