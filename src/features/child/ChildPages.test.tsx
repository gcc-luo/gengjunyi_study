import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { AppStoreProvider } from '../../context/AppStore';
import { AuthProvider, type AuthSession } from '../../context/AuthProvider';
import { createSeedSnapshot } from '../../data/seed';
import { CourseStatus, VideoStatus, type Snapshot } from '../../types/domain';
import { EYE_CARE_STORAGE_KEY } from './preferences';
import { queryClient } from '../../lib/query-client';

const testSession: AuthSession = { authenticated: true, admin: { id: 'admin-1', email: 'parent@example.com' }, activeChildId: null, activeChild: null, csrfToken: 'test-csrf' };

function renderRoute(path: string, snapshot?: Snapshot) {
  window.history.pushState({}, '', path);
  return render(
    <AuthProvider initialSession={testSession}>
      <AppStoreProvider initialSnapshot={snapshot ?? createSeedSnapshot()}><App /></AppStoreProvider>
    </AuthProvider>,
  );
}

function childSnapshot(): Snapshot {
  const snapshot = createSeedSnapshot();
  snapshot.children = [{ id: 'child-one', name: '小星', avatar: '⭐', grade: '一年级', status: 'ACTIVE', createdAt: '2026-09-01T00:00:00.000Z' }];
  snapshot.courses = [{ id: 'math-course', title: '数学小探险', subjectId: 'math', description: '认识有趣的数字。', ageRange: '6-8岁', cover: { style: 'sunrise', colors: ['#FFBD3F', '#FFE6A8'] }, status: CourseStatus.PUBLISHED, videoIds: ['ready-video', 'loading-video'], createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z' }, { id: 'chinese-course', title: '语文故事会', subjectId: 'chinese', description: '读好玩的故事。', ageRange: '6-8岁', cover: { style: 'mountain', colors: ['#2D86F5', '#9ED8FF'] }, status: CourseStatus.PUBLISHED, videoIds: ['chinese-video'], createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z' }];
  snapshot.videos = [{ id: 'ready-video', courseId: 'math-course', title: '认识数字', fileName: 'numbers.mp4', durationSeconds: 120, status: VideoStatus.READY, orderIndex: 1, createdAt: '2026-09-01T00:00:00.000Z' }, { id: 'loading-video', courseId: 'math-course', title: '加法练习', fileName: 'addition.mp4', durationSeconds: 150, status: VideoStatus.UPLOADING, orderIndex: 2, createdAt: '2026-09-01T00:00:00.000Z' }, { id: 'chinese-video', courseId: 'chinese-course', title: '小故事', fileName: 'story.mp4', durationSeconds: 180, status: VideoStatus.READY, orderIndex: 1, createdAt: '2026-09-01T00:00:00.000Z' }];
  snapshot.watchProgress = [{ childId: 'child-one', videoId: 'ready-video', lastPositionSeconds: 120, maxProgress: 1, completed: true, totalWatchSeconds: 120, updatedAt: '2026-09-04T00:00:00.000Z' }];
  snapshot.watchEvents = [];
  return snapshot;
}

function recordsSnapshot(): Snapshot {
  const snapshot = childSnapshot();
  const now = new Date();
  const today = now.toISOString();
  const yesterday = new Date(now.getTime() - 86400000).toISOString();
  const older = new Date(now.getTime() - 9 * 86400000).toISOString();
  snapshot.videos = [
    { ...snapshot.videos[0], id: 'record-video-today', title: '今天的星空' },
    { ...snapshot.videos[0], id: 'record-video-yesterday', title: '昨天的月亮' },
    { ...snapshot.videos[0], id: 'record-video-older', title: '很久以前的太阳' },
    { ...snapshot.videos[0], id: 'record-video-progress-only', title: '只保存进度的内容' },
  ];
  snapshot.watchProgress = [
    { childId: 'child-one', videoId: 'record-video-today', lastPositionSeconds: 120, maxProgress: 1, completed: true, totalWatchSeconds: 120, updatedAt: today },
    { childId: 'child-one', videoId: 'record-video-yesterday', lastPositionSeconds: 120, maxProgress: 1, completed: true, totalWatchSeconds: 120, updatedAt: yesterday },
    { childId: 'child-one', videoId: 'record-video-older', lastPositionSeconds: 30, maxProgress: 0.25, completed: false, totalWatchSeconds: 30, updatedAt: older },
    { childId: 'child-one', videoId: 'record-video-progress-only', lastPositionSeconds: 90, maxProgress: 0.75, completed: false, totalWatchSeconds: 0, updatedAt: today },
    { childId: 'other-child', videoId: 'record-video-today', lastPositionSeconds: 120, maxProgress: 1, completed: true, totalWatchSeconds: 120, updatedAt: today },
  ];
  snapshot.watchEvents = [
    { id: 'record-event-today', childId: 'child-one', videoId: 'record-video-today', effectiveWatchSeconds: 150, occurredAt: today },
    { id: 'record-event-yesterday', childId: 'child-one', videoId: 'record-video-yesterday', effectiveWatchSeconds: 120, occurredAt: yesterday },
    { id: 'record-event-older', childId: 'child-one', videoId: 'record-video-older', effectiveWatchSeconds: 30, occurredAt: older },
    { id: 'record-event-other-child', childId: 'other-child', videoId: 'record-video-today', effectiveWatchSeconds: 900, occurredAt: today },
  ];
  return snapshot;
}

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.pushState({}, '', '/');
});

describe('child learning pages', () => {
  it('keeps exactly one main landmark across child pages', () => {
    renderRoute('/child/select', childSnapshot());
    expect(screen.getAllByRole('main')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '选择小星' }));
    expect(screen.getAllByRole('main')).toHaveLength(1);
    fireEvent.click(screen.getByRole('link', { name: '课程' }));
    expect(screen.getAllByRole('main')).toHaveLength(1);
    fireEvent.click(screen.getByRole('link', { name: /数学小探险/ }));
    expect(screen.getAllByRole('main')).toHaveLength(1);
    fireEvent.click(screen.getByRole('link', { name: /认识数字/ }));
    expect(screen.getAllByRole('main')).toHaveLength(1);
    fireEvent.click(screen.getByRole('link', { name: '我的' }));
    expect(screen.getAllByRole('main')).toHaveLength(1);
    fireEvent.click(screen.getByRole('link', { name: /学习记录/ }));
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('waits for the server to select the child before entering the remote child space', async () => {
    const remoteSession: AuthSession = { authenticated: true, admin: { id: 'admin-1', email: 'parent@example.com' }, activeChildId: null, activeChild: null, csrfToken: 'csrf-test' };
    const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    let finishSelection!: (value: Response) => void;
    const selectionResponse = new Promise<Response>((resolve) => { finishSelection = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === '/api/children') return response([{ id: 'child-one', name: '小星', avatar: '⭐', grade: '一年级', status: 'ACTIVE', createdAt: '2026-09-01T00:00:00.000Z' }]);
      if (url.pathname === '/api/courses') return response([]);
      if (url.pathname === '/api/child/courses') return response([]);
      if (url.pathname === '/api/settings') return response({ freeChoice: true });
      if (url.pathname === '/api/overview') return response({ totals: { children: 1, courses: 0, readyVideos: 0, watchedSeconds: 0, completedVideos: 0 }, today: { watchedSeconds: 0, events: 0 }, week: { watchedSeconds: 0, startsAt: '2026-09-14T00:00:00.000Z' }, dailyActivity: [], recentActivity: [], continueLearning: [] });
      if (url.pathname === '/api/records') return response({ total: 0, items: [] });
      if (url.pathname === '/api/auth/active-child' && init?.method === 'PUT') return selectionResponse;
      if (url.pathname === '/api/children/child-one/favorites') return response([]);
      return response({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }));
    window.history.pushState({}, '', '/child/select');

    render(<AuthProvider initialSession={remoteSession}><AppStoreProvider><App /></AppStoreProvider></AuthProvider>);
    const childCard = await screen.findByRole('button', { name: '选择小星' });
    fireEvent.click(childCard);

    await waitFor(() => expect(childCard).toBeDisabled());
    expect(window.location.pathname).toBe('/child/select');
    await act(async () => { finishSelection(response({ activeChildId: 'child-one', activeChild: { id: 'child-one', name: '小星' } })); });
    await waitFor(() => expect(window.location.pathname).toBe('/child/home'));
    expect(await screen.findByRole('heading', { name: '你好，小星' })).toBeInTheDocument();
  });

  it('shows only active children and enters home after selecting one', () => {
    const snapshot = createSeedSnapshot();
    snapshot.children.push({ id: 'inactive-child', name: '暂时休息', avatar: '🌙', grade: '二年级', status: 'INACTIVE', createdAt: '2026-09-01T00:00:00.000Z' });

    renderRoute('/child/select', snapshot);

    expect(screen.getByText('哥哥')).toBeInTheDocument();
    expect(screen.getByText('妹妹')).toBeInTheDocument();
    expect(screen.queryByText('暂时休息')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '选择哥哥' }));

    expect(window.location.pathname).toBe('/child/home');
    expect(screen.getByRole('heading', { name: '你好，哥哥' })).toBeInTheDocument();
  });

  it('uses the single-child composition when only one child is active', () => {
    renderRoute('/child/select', childSnapshot());

    expect(screen.getByRole('button', { name: '选择小星' }).parentElement).toHaveClass('single');
    expect(document.querySelector('.select-sky')).toHaveClass('single');

    cleanup();
    renderRoute('/child/select', createSeedSnapshot());

    expect(screen.getByRole('button', { name: '选择哥哥' }).parentElement).not.toHaveClass('single');
    expect(document.querySelector('.select-sky')).not.toHaveClass('single');
  });

  it('blocks direct child routes until a child is selected, then allows normal navigation', () => {
    const snapshot = childSnapshot();

    renderRoute('/child/home', snapshot);
    expect(screen.getByRole('heading', { name: '谁来学习？' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/child/select');
    expect(screen.queryByRole('heading', { name: '你好，小星' })).not.toBeInTheDocument();

    cleanup();
    renderRoute('/child/courses', snapshot);
    expect(screen.getByRole('heading', { name: '谁来学习？' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/child/select');
    expect(screen.queryByText('数学小探险')).not.toBeInTheDocument();

    cleanup();
    renderRoute('/child/select', snapshot);
    fireEvent.click(screen.getByRole('button', { name: '选择小星' }));
    fireEvent.click(screen.getByRole('link', { name: '课程' }));

    expect(window.location.pathname).toBe('/child/courses');
    expect(screen.getByRole('heading', { name: '全部课程' })).toBeInTheDocument();
    expect(screen.getByText('数学小探险')).toBeInTheDocument();
  });

  it('shows an empty state and parent entry when there are no active children', () => {
    const snapshot = createSeedSnapshot();
    snapshot.children = [];

    renderRoute('/child/select', snapshot);

    expect(screen.getByText('还没有可选择的孩子')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '家长入口' })).toHaveAttribute('href', '/parent/overview');

    cleanup();
    renderRoute('/child/home', snapshot);
    expect(screen.getByRole('heading', { name: '谁来学习？' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/child/select');
    expect(screen.queryByRole('heading', { name: '儿童首页' })).not.toBeInTheDocument();

    cleanup();
    renderRoute('/child/courses', snapshot);
    expect(screen.getByRole('heading', { name: '谁来学习？' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/child/select');
  });

  it('uses a themed background asset for each subject card', () => {
    renderRoute('/child/select', childSnapshot());
    fireEvent.click(screen.getByRole('button', { name: '选择小星' }));

    const cards = [
      screen.getByRole('link', { name: '英语' }),
      screen.getByRole('link', { name: '语文' }),
      screen.getByRole('link', { name: '数学' }),
      screen.getByRole('link', { name: '科普' }),
    ];
    expect(cards[0].getAttribute('style')).toContain('english-card-poster.webp');
    expect(cards[1].getAttribute('style')).toContain('chinese-card-poster.webp');
    expect(cards[2].getAttribute('style')).toContain('math-card-poster.webp');
    expect(cards[3].getAttribute('style')).toContain('science-card-poster.webp');
  });

  it('shows the current child course progress only on home', () => {
    renderRoute('/child/select', childSnapshot());
    fireEvent.click(screen.getByRole('button', { name: '选择小星' }));

    expect(screen.getByRole('heading', { name: '你好，小星' })).toBeInTheDocument();
    expect(screen.getByText('数学小探险')).toBeInTheDocument();
    expect(screen.getByText('语文故事会')).toBeInTheDocument();
    expect(screen.getByTestId('course-progress-math-course')).toHaveTextContent('100%');
    expect(screen.queryByText('哥哥')).not.toBeInTheDocument();
  });

  it('filters courses by subject query and links READY videos to the player', () => {
    renderRoute('/child/select', childSnapshot());
    fireEvent.click(screen.getByRole('button', { name: '选择小星' }));
    fireEvent.click(screen.getByRole('link', { name: '数学' }));

    expect(screen.getByText('数学小探险')).toBeInTheDocument();
    expect(screen.queryByText('语文故事会')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: /数学小探险/ }));
    expect(screen.getByText('课程目录')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '课程目录' })).toHaveAttribute('aria-controls', 'course-catalog-panel');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'course-catalog-panel');
    expect(screen.getByRole('link', { name: /认识数字/ })).toHaveAttribute('href', '/child/watch/ready-video');
    expect(within(screen.getByTestId('video-row-loading-video')).getByText('暂不可播放')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '课程介绍' }));
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'course-intro-panel');
  });

  it('persists eye-care preference and toggles the child shell class', () => {
    renderRoute('/child/select', childSnapshot());
    fireEvent.click(screen.getByRole('button', { name: '选择小星' }));
    fireEvent.click(screen.getByRole('link', { name: '我的' }));

    const toggle = screen.getByRole('checkbox', { name: '护眼模式' });
    expect(screen.getByTestId('child-shell')).not.toHaveClass('eye-care');
    fireEvent.click(toggle);

    expect(localStorage.getItem(EYE_CARE_STORAGE_KEY)).toBe('true');
    expect(screen.getByTestId('child-shell')).toHaveClass('eye-care');

    act(() => {
      localStorage.setItem(EYE_CARE_STORAGE_KEY, 'false');
      window.dispatchEvent(new StorageEvent('storage', { key: EYE_CARE_STORAGE_KEY, newValue: 'false' }));
    });
    expect(screen.getByTestId('child-shell')).not.toHaveClass('eye-care');
  });

  it('keeps the local course catalog visible when remote assignments are unavailable', () => {
    localStorage.setItem('family-learning:free-choice', 'false');
    renderRoute('/child/select', childSnapshot());
    fireEvent.click(screen.getByRole('button', { name: '选择小星' }));
    fireEvent.click(screen.getByRole('link', { name: '课程' }));

    expect(screen.getByText('数学小探险')).toBeInTheDocument();
    expect(screen.getByText('语文故事会')).toBeInTheDocument();

    cleanup();
    const noLearning = childSnapshot();
    noLearning.watchProgress = [];
    renderRoute('/child/select', noLearning);
    fireEvent.click(screen.getByRole('button', { name: '选择小星' }));
    fireEvent.click(screen.getByRole('link', { name: '课程' }));
    expect(screen.getByText('数学小探险')).toBeInTheDocument();
    expect(screen.getByText('语文故事会')).toBeInTheDocument();
    expect(screen.queryByText('还没有找到课程')).not.toBeInTheDocument();
  });

  it('shows the app version in the child profile', () => {
    renderRoute('/child/select', childSnapshot());
    fireEvent.click(screen.getByRole('button', { name: '选择小星' }));
    fireEvent.click(screen.getByRole('link', { name: '我的' }));

    expect(screen.getByText('版本 0.1.0')).toBeInTheDocument();
  });

  it('keeps the parent route on the parent shell', () => {
    renderRoute('/parent/overview', createSeedSnapshot());

    expect(screen.getByRole('heading', { name: '概览' })).toBeInTheDocument();
    expect(screen.queryByText('你好，哥哥')).not.toBeInTheDocument();
    expect(screen.getByTestId('metric-courses')).toBeInTheDocument();
  });

  it('aggregates records for the selected child and switches between stats and history', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T12:00:00+08:00'));
    renderRoute('/child/select', recordsSnapshot());
    fireEvent.click(screen.getByRole('button', { name: '选择小星' }));
    fireEvent.click(screen.getByRole('link', { name: '我的' }));
    fireEvent.click(screen.getByRole('link', { name: /学习记录/ }));

    expect(screen.getByRole('heading', { name: '学习记录' })).toBeInTheDocument();
    expect(screen.getByTestId('child-records-today')).toHaveTextContent('3 分钟');
    expect(screen.getByTestId('child-records-week')).toHaveTextContent('2');
    expect(screen.getByTestId('child-records-streak')).toHaveTextContent('2 天');
    expect(screen.getByRole('tab', { name: '学习统计' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('records-trend')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '学习历史' }));
    expect(screen.getByRole('tab', { name: '学习历史' })).toHaveAttribute('aria-selected', 'true');
    const history = screen.getByTestId('records-history');
    expect(history).toHaveTextContent('今天的星空');
    expect(history).toHaveTextContent('昨天的月亮');
    expect(history).toHaveTextContent('很久以前的太阳');
    expect(history).toHaveTextContent('只保存进度的内容');
    expect((history.textContent ?? '').indexOf('今天的星空')).toBeLessThan((history.textContent ?? '').indexOf('昨天的月亮'));
    const todayRecord = within(history).getByRole('link', { name: /回看 今天的星空/ });
    expect(todayRecord).toHaveAttribute('href', '/child/watch/record-video-today');
    expect(todayRecord).toHaveTextContent('已完成');
    const progressOnlyRecord = within(history).getByRole('link', { name: /回看 只保存进度的内容/ });
    expect(progressOnlyRecord).toHaveTextContent('学习中 · 75%');
    expect(progressOnlyRecord).toHaveTextContent('暂无有效时长');
  });

  it('shows the records empty state for a child without learning activity', () => {
    const snapshot = childSnapshot();
    snapshot.watchProgress = [];
    snapshot.watchEvents = [{ id: 'zero-event', childId: 'child-one', videoId: 'ready-video', effectiveWatchSeconds: 0, occurredAt: new Date().toISOString() }];
    renderRoute('/child/select', snapshot);
    fireEvent.click(screen.getByRole('button', { name: '选择小星' }));
    fireEvent.click(screen.getByRole('link', { name: '我的' }));
    fireEvent.click(screen.getByRole('link', { name: /学习记录/ }));

    expect(screen.getByText('今天从喜欢的课程开始吧')).toBeInTheDocument();
    expect(screen.queryByTestId('child-records-today')).not.toBeInTheDocument();
    expect(screen.queryByTestId('records-trend')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '学习历史' }));
    expect(screen.getByText('今天从喜欢的课程开始吧')).toBeInTheDocument();
  });
});
