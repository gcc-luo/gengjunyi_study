import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useLayoutEffect } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppStoreProvider, useAppStore } from '../../context/AppStore';
import { createSeedSnapshot } from '../../data/seed';
import { STORAGE_KEY } from '../../lib/storage';
import { type Snapshot } from '../../types/domain';
import { WatchPage } from './WatchPage';
import { CoursePage } from './CoursePage';

function watchSnapshot(): Snapshot {
  const snapshot = createSeedSnapshot();
  snapshot.children = [
    { id: 'child-one', name: '小星', avatar: '⭐', grade: '一年级', status: 'ACTIVE', createdAt: '2026-09-01T00:00:00.000Z' },
    { id: 'child-two', name: '小月', avatar: '🌙', grade: '二年级', status: 'ACTIVE', createdAt: '2026-09-01T00:00:00.000Z' },
  ];
  snapshot.courses = [{
    id: 'course-one', title: '数学小探险', subjectId: 'math', description: '认识有趣的数字。', ageRange: '6-8岁',
    cover: { style: 'sunrise', colors: ['#FFBD3F', '#FFE6A8'] }, status: 'PUBLISHED', videoIds: ['video-one', 'video-two'],
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z',
  }];
  snapshot.videos = [
    { id: 'video-one', courseId: 'course-one', title: '第1课 认识数字', fileName: 'one.mp4', durationSeconds: 20, status: 'READY', orderIndex: 1, createdAt: '2026-09-01T00:00:00.000Z' },
    { id: 'video-two', courseId: 'course-one', title: '第2课 加法练习', fileName: 'two.mp4', durationSeconds: 20, status: 'READY', orderIndex: 2, createdAt: '2026-09-01T00:00:00.000Z' },
  ];
  snapshot.watchProgress = [];
  snapshot.watchEvents = [];
  return snapshot;
}

function SelectChild({ childId = 'child-one' }: { childId?: string }) {
  const { selectChild } = useAppStore();
  useLayoutEffect(() => { selectChild(childId); }, [childId, selectChild]);
  return null;
}

function SnapshotProbe({ onSnapshot }: { onSnapshot: (snapshot: Snapshot) => void }) {
  const { snapshot } = useAppStore();
  useEffect(() => onSnapshot(snapshot), [onSnapshot, snapshot]);
  return null;
}

function ChildSwitcher() {
  const { selectChild } = useAppStore();
  return <><button type="button" onClick={() => selectChild('child-one')}>切换小星</button><button type="button" onClick={() => selectChild('child-two')}>切换小月</button></>;
}

function renderWatch(snapshot = watchSnapshot(), onSnapshot: (snapshot: Snapshot) => void = () => {}) {
  return render(
    <AppStoreProvider initialSnapshot={snapshot}>
      <SelectChild />
      <ChildSwitcher />
      <MemoryRouter initialEntries={['/child/watch/video-one']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes><Route path="/child/watch/:videoId" element={<WatchPage />} /></Routes>
      </MemoryRouter>
      <SnapshotProbe onSnapshot={onSnapshot} />
    </AppStoreProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('WatchPage playback loop', () => {
  it('writes a ten-second heartbeat and completes automatically at ninety percent', () => {
    vi.useFakeTimers();
    let latest = watchSnapshot();
    renderWatch(latest, (snapshot) => { latest = snapshot; });

    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    act(() => vi.advanceTimersByTime(10_000));

    expect(latest.watchEvents).toHaveLength(1);
    expect(latest.watchEvents[0].effectiveWatchSeconds).toBe(10);
    expect(latest.watchProgress[0]).toMatchObject({ lastPositionSeconds: 10, totalWatchSeconds: 10, completed: false });

    act(() => vi.advanceTimersByTime(8_000));

    expect(latest.watchProgress[0]).toMatchObject({ lastPositionSeconds: 18, maxProgress: 0.9, completed: true, totalWatchSeconds: 18 });
  });

  it('flushes pending watch time before completing after a playing seek', () => {
    vi.useFakeTimers();
    let latest = watchSnapshot();
    renderWatch(latest, (snapshot) => { latest = snapshot; });

    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    act(() => vi.advanceTimersByTime(5_000));
    fireEvent.change(screen.getByRole('slider', { name: '播放进度' }), { target: { value: '18' } });

    expect(latest.watchEvents).toContainEqual(expect.objectContaining({ videoId: 'video-one', effectiveWatchSeconds: 5 }));
    expect(latest.watchProgress).toContainEqual(expect.objectContaining({ videoId: 'video-one', lastPositionSeconds: 18, completed: true, totalWatchSeconds: 5 }));
  });

  it('requests fullscreen from the player screen and degrades when unsupported', () => {
    renderWatch();
    const playerScreen = screen.getByTestId('watch-screen');
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(playerScreen, 'requestFullscreen', { configurable: true, value: requestFullscreen });

    fireEvent.click(screen.getByRole('button', { name: '全屏' }));
    expect(requestFullscreen).toHaveBeenCalledOnce();

    cleanup();
    renderWatch();
    fireEvent.click(screen.getByRole('button', { name: '全屏' }));
    expect(screen.getByRole('status')).toHaveTextContent('当前环境不支持全屏播放');
  });

  it('uses the same natural title order in the course catalog as the player', () => {
    const snapshot = watchSnapshot();
    snapshot.courses[0].videoIds = ['video-two', 'video-one'];
    snapshot.videos[0].orderIndex = 20;
    snapshot.videos[1].orderIndex = 1;
    render(
      <AppStoreProvider initialSnapshot={snapshot}>
        <SelectChild />
        <MemoryRouter initialEntries={['/child/course/course-one']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes><Route path="/child/course/:courseId" element={<CoursePage />} /></Routes>
        </MemoryRouter>
      </AppStoreProvider>,
    );

    const rows = screen.getAllByTestId(/video-row-/);
    expect(rows[0]).toHaveTextContent('第1课 认识数字');
    expect(rows[1]).toHaveTextContent('第2课 加法练习');
  });

  it('flushes the played seconds on pause and does not accumulate while paused', () => {
    vi.useFakeTimers();
    let latest = watchSnapshot();
    renderWatch(latest, (snapshot) => { latest = snapshot; });

    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    act(() => vi.advanceTimersByTime(5_000));
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    const pausedProgress = latest.watchProgress[0];

    act(() => vi.advanceTimersByTime(10_000));

    expect(pausedProgress).toMatchObject({ lastPositionSeconds: 5, totalWatchSeconds: 5 });
    expect(latest.watchProgress[0]).toEqual(pausedProgress);
    expect(latest.watchEvents).toHaveLength(1);
  });

  it('flushes the current position when the player unmounts', () => {
    vi.useFakeTimers();
    let latest = watchSnapshot();
    const view = renderWatch(latest, (snapshot) => { latest = snapshot; });

    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    act(() => vi.advanceTimersByTime(3_000));
    act(() => view.unmount());

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Snapshot;
    expect(persisted.watchProgress[0]).toMatchObject({ lastPositionSeconds: 3, totalWatchSeconds: 3 });
  });

  it('flushes before switching to the next lesson', () => {
    vi.useFakeTimers();
    let latest = watchSnapshot();
    latest.videos[0].orderIndex = 20;
    latest.videos[1].orderIndex = 1;
    renderWatch(latest, (snapshot) => { latest = snapshot; });

    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    act(() => vi.advanceTimersByTime(3_000));
    fireEvent.click(screen.getByRole('button', { name: /下一集/ }));

    expect(screen.getByRole('heading', { name: '第2课 加法练习' })).toBeInTheDocument();
    expect(latest.watchProgress).toContainEqual(expect.objectContaining({ childId: 'child-one', videoId: 'video-one', lastPositionSeconds: 3, totalWatchSeconds: 3 }));
  });

  it('keeps progress isolated when the selected child changes', () => {
    vi.useFakeTimers();
    let latest = watchSnapshot();
    renderWatch(latest, (snapshot) => { latest = snapshot; });

    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    act(() => vi.advanceTimersByTime(2_000));
    fireEvent.click(screen.getByRole('button', { name: '切换小月' }));

    expect(latest.watchProgress).toHaveLength(0);
    expect(latest.watchProgress.some((item) => item.childId === 'child-two')).toBe(false);
    expect(screen.getByTestId('watch-position')).toHaveTextContent('00:00');
  });

  it('does not write progress when no child is selected', () => {
    vi.useFakeTimers();
    let latest = watchSnapshot();
    render(
      <AppStoreProvider initialSnapshot={latest}>
        <MemoryRouter initialEntries={['/child/watch/video-one']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes><Route path="/child/watch/:videoId" element={<WatchPage />} /></Routes>
        </MemoryRouter>
        <SnapshotProbe onSnapshot={(snapshot) => { latest = snapshot; }} />
      </AppStoreProvider>,
    );

    expect(latest.watchProgress).toHaveLength(0);
    expect(latest.watchEvents).toHaveLength(0);
    expect(screen.getByText('先选择一个孩子')).toBeInTheDocument();
  });
});
