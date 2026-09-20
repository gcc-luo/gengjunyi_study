import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useLayoutEffect } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppStoreProvider, useAppStore } from '../../context/AppStore';
import { createSeedSnapshot } from '../../data/seed';
import { STORAGE_KEY } from '../../lib/storage';
import { AuthProvider, type AuthSession } from '../../context/AuthProvider';
import { queryClient } from '../../lib/query-client';
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

function RouteSwitcher() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/child/watch/video-two')}>路由切到第二集</button>;
}

function DurationUpdater() {
  const { updateVideo } = useAppStore();
  return <button type="button" onClick={() => updateVideo('video-one', { durationSeconds: 6 })}>更新视频时长</button>;
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
  queryClient.clear();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  vi.restoreAllMocks();
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

    cleanup();
    renderWatch();
    const webkitScreen = screen.getByTestId('watch-screen');
    const webkitRequestFullscreen = vi.fn();
    Object.defineProperty(webkitScreen, 'webkitRequestFullscreen', { configurable: true, value: webkitRequestFullscreen });
    fireEvent.click(screen.getByRole('button', { name: '全屏' }));
    expect(webkitRequestFullscreen).toHaveBeenCalledOnce();
  });

  it('uses maintained orderIndex order in the course catalog and player', () => {
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
    expect(rows[0]).toHaveTextContent('第2课 加法练习');
    expect(rows[1]).toHaveTextContent('第1课 认识数字');

    cleanup();
    renderWatch(snapshot);
    fireEvent.click(screen.getByRole('button', { name: /上一集/ }));
    expect(screen.getByRole('heading', { name: '第2课 加法练习' })).toBeInTheDocument();
  });

  it('pauses and flushes when hidden, then can resume without background watch time', () => {
    vi.useFakeTimers();
    let latest = watchSnapshot();
    renderWatch(latest, (snapshot) => { latest = snapshot; });

    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    act(() => vi.advanceTimersByTime(4_000));
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    const hiddenProgress = latest.watchProgress[0];
    act(() => vi.advanceTimersByTime(10_000));

    expect(hiddenProgress).toMatchObject({ lastPositionSeconds: 4, totalWatchSeconds: 4 });
    expect(latest.watchProgress[0]).toEqual(hiddenProgress);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByTestId('watch-position')).toHaveTextContent('00:05');
    expect(latest.watchProgress[0]).toMatchObject({ lastPositionSeconds: 4, totalWatchSeconds: 4 });
  });

  it('removes lifecycle listeners when the player unmounts', () => {
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener');
    const removeWindowListener = vi.spyOn(window, 'removeEventListener');
    const view = renderWatch();

    act(() => view.unmount());

    expect(removeDocumentListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith('pagehide', expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith('beforeunload', expect.any(Function));
  });

  it('flushes once on pagehide and beforeunload without duplicating the event', () => {
    vi.useFakeTimers();
    let latest = watchSnapshot();
    renderWatch(latest, (snapshot) => { latest = snapshot; });

    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    act(() => vi.advanceTimersByTime(3_000));
    act(() => window.dispatchEvent(new Event('pagehide')));
    act(() => window.dispatchEvent(new Event('beforeunload')));

    expect(latest.watchProgress[0]).toMatchObject({ lastPositionSeconds: 3, totalWatchSeconds: 3 });
    expect(latest.watchEvents).toHaveLength(1);
  });

  it('flushes the old video before a direct route videoId change', () => {
    vi.useFakeTimers();
    let latest = watchSnapshot();
    latest.videos[1].durationSeconds = 2;
    render(
      <AppStoreProvider initialSnapshot={latest}>
        <SelectChild />
        <MemoryRouter initialEntries={['/child/watch/video-one']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <RouteSwitcher />
          <Routes><Route path="/child/watch/:videoId" element={<WatchPage />} /></Routes>
        </MemoryRouter>
        <SnapshotProbe onSnapshot={(snapshot) => { latest = snapshot; }} />
      </AppStoreProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    act(() => vi.advanceTimersByTime(3_000));
    fireEvent.click(screen.getByRole('button', { name: '路由切到第二集' }));

    expect(latest.watchProgress).toContainEqual(expect.objectContaining({ videoId: 'video-one', lastPositionSeconds: 3, totalWatchSeconds: 3 }));
    expect(screen.getByRole('heading', { name: '第2课 加法练习' })).toBeInTheDocument();
    expect(screen.getByTestId('watch-position')).toHaveTextContent('00:00');
  });

  it('uses an updated duration for the same video without resetting position', () => {
    vi.useFakeTimers();
    let latest = watchSnapshot();
    render(
      <AppStoreProvider initialSnapshot={latest}>
        <SelectChild />
        <DurationUpdater />
        <MemoryRouter initialEntries={['/child/watch/video-one']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes><Route path="/child/watch/:videoId" element={<WatchPage />} /></Routes>
        </MemoryRouter>
        <SnapshotProbe onSnapshot={(snapshot) => { latest = snapshot; }} />
      </AppStoreProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    act(() => vi.advanceTimersByTime(5_000));
    fireEvent.click(screen.getByRole('button', { name: '更新视频时长' }));
    act(() => vi.advanceTimersByTime(1_000));

    expect(screen.getByTestId('watch-position')).toHaveTextContent('00:06');
    expect(latest.watchProgress).toContainEqual(expect.objectContaining({ videoId: 'video-one', lastPositionSeconds: 6, completed: true, totalWatchSeconds: 6 }));
  });

  it('does not save twice when automatic completion flushes pending watch time', () => {
    vi.useFakeTimers();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const latest = watchSnapshot();
    latest.videos[0].durationSeconds = 10;
    renderWatch(latest);

    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    act(() => vi.advanceTimersByTime(9_000));

    expect(setItem).toHaveBeenCalledOnce();
  });

  it('shows a play icon while paused and a pause icon while playing', () => {
    renderWatch();
    expect(screen.getByTestId('watch-screen-play')).toHaveTextContent('▶');
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    expect(screen.getByTestId('watch-screen-play')).toHaveTextContent('Ⅱ');
  });

  it('keeps one main landmark and reports non-ready videos consistently', () => {
    const snapshot = watchSnapshot();
    snapshot.videos[0].status = 'UPLOADING';
    renderWatch(snapshot);

    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByText('暂不可播放')).toBeInTheDocument();

    cleanup();
    render(
      <AppStoreProvider initialSnapshot={snapshot}>
        <SelectChild />
        <MemoryRouter initialEntries={['/child/course/course-one']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes><Route path="/child/course/:courseId" element={<CoursePage />} /></Routes>
        </MemoryRouter>
      </AppStoreProvider>,
    );
    expect(screen.getByTestId('video-row-video-one')).toHaveTextContent('暂不可播放');
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

  it('loads a private playback URL and renders a real video element in remote mode', async () => {
    const remoteSession: AuthSession = {
      authenticated: true,
      admin: { id: 'parent-1', email: 'parent@example.test' },
      activeChildId: 'child-one',
      activeChild: { id: 'child-one', name: '小星' },
      csrfToken: 'csrf-test',
    };
    const overview = { totals: { children: 1, courses: 1, readyVideos: 1, watchedSeconds: 0, completedVideos: 0 }, today: { watchedSeconds: 0, events: 0 }, week: { watchedSeconds: 0, startsAt: '2026-09-14T00:00:00.000Z' }, dailyActivity: [], recentActivity: [], continueLearning: [] };
    const course = {
      id: 'course-one', title: '数学小探险', subjectId: 'math', description: '', ageRange: '6-8岁',
      cover: { style: 'sunrise', colors: ['#FFBD3F', '#FFE6A8'] }, status: 'PUBLISHED',
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z',
      videos: [{ id: 'video-one', courseId: 'course-one', title: '第1课 认识数字', fileName: 'one.mp4', durationMs: 20_000, status: 'READY', sortOrder: 0, createdAt: '2026-09-01T00:00:00.000Z' }],
    };
    let playbackUrlCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin);
      const body = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
      if (url.pathname === '/api/children') return body([{ id: 'child-one', name: '小星', avatar: '⭐', grade: '一年级', status: 'ACTIVE', createdAt: '2026-09-01T00:00:00.000Z' }]);
      if (url.pathname === '/api/courses') return body([course]);
      if (url.pathname === '/api/overview') return body(overview);
      if (url.pathname === '/api/records') return body({ total: 0, items: [] });
      if (url.pathname === '/api/children/child-one/favorites') return body([]);
      if (url.pathname === '/api/videos/video-one/playback') {
        playbackUrlCount += 1;
        return body({ url: `https://minio.example.test/private/video-${playbackUrlCount}.mp4`, expiresInSeconds: 7200 });
      }
      if (url.pathname === '/api/children/child-one/videos/video-one/progress' && init?.method === 'PUT') return body({ progress: { childId: 'child-one', videoId: 'video-one', positionMs: 10_000, maxProgressPercent: 50, completed: false, updatedAt: '2026-09-17T00:00:00.000Z' }, recordedWatchedSeconds: 0 });
      return body({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AuthProvider initialSession={remoteSession}>
        <AppStoreProvider>
          <MemoryRouter initialEntries={['/child/watch/video-one']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Routes><Route path="/child/watch/:videoId" element={<WatchPage />} /></Routes>
          </MemoryRouter>
        </AppStoreProvider>
      </AuthProvider>,
    );

    await waitFor(() => expect(document.querySelector('video[aria-label="视频播放器"]')).toBeTruthy());
    const player = document.querySelector('video[aria-label="视频播放器"]') as HTMLVideoElement;
    expect(player).toHaveAttribute('src', 'https://minio.example.test/private/video-1.mp4');
    expect(player).toHaveAttribute('controls');
    expect(screen.queryByText('演示播放')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/videos/video-one/playback'), expect.objectContaining({ method: 'POST' }));

    Object.defineProperty(player, 'currentTime', { configurable: true, writable: true, value: 10 });
    fireEvent.play(player);
    fireEvent.timeUpdate(player);
    fireEvent.pause(player);
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => String(input).includes('/api/children/child-one/videos/video-one/progress') && init?.method === 'PUT')).toBe(true));
    const progressCall = fetchMock.mock.calls.find(([input, init]) => String(input).includes('/api/children/child-one/videos/video-one/progress') && init?.method === 'PUT');
    expect(JSON.parse(String(progressCall?.[1]?.body))).toMatchObject({ positionMs: 10_000, eventType: 'PROGRESS' });

    fireEvent.error(player);
    await waitFor(() => expect(player).toHaveAttribute('src', 'https://minio.example.test/private/video-2.mp4'));
    fireEvent.loadedMetadata(player);
    expect(player.currentTime).toBe(10);
  });
});
