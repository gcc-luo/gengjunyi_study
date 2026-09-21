import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../../App';
import { AppStoreProvider } from '../../context/AppStore';
import { AuthProvider, type AuthSession } from '../../context/AuthProvider';
import { createSeedSnapshot } from '../../data/seed';
import { CourseStatus, VideoStatus, type Snapshot } from '../../types/domain';
import { EYE_CARE_STORAGE_KEY } from '../child/preferences';

const testSession: AuthSession = { authenticated: true, admin: { id: 'admin-1', email: 'parent@example.com' }, activeChildId: null, activeChild: null, csrfToken: 'test-csrf' };

function renderRoute(path: string, snapshot?: Snapshot) {
  window.history.pushState({}, '', path);
  return render(
    <AuthProvider initialSession={testSession}>
      <AppStoreProvider initialSnapshot={snapshot ?? createSeedSnapshot()}><App /></AppStoreProvider>
    </AuthProvider>,
  );
}

function emptySnapshot(): Snapshot {
  const snapshot = createSeedSnapshot();
  snapshot.children = [];
  snapshot.courses = [];
  snapshot.videos = [];
  snapshot.watchProgress = [];
  snapshot.watchEvents = [];
  return snapshot;
}

afterEach(() => {
  window.history.pushState({}, '', '/');
  vi.unstubAllGlobals();
});

describe('parent management pages', () => {
  it('calculates overview metrics from the store and uses empty states', () => {
    const snapshot = emptySnapshot();
    const today = new Date().toISOString();
    snapshot.children = [
      { id: 'active-child', name: '小星', avatar: '⭐', grade: '一年级', status: 'ACTIVE', createdAt: today },
      { id: 'inactive-child', name: '已停用', avatar: '🌙', grade: '二年级', status: 'INACTIVE', createdAt: today },
    ];
    snapshot.courses = [{ id: 'course-one', title: '一门课程', subjectId: 'math', description: '', ageRange: '6-8岁', cover: { style: 'sunrise', colors: ['#2D86F5'] }, status: CourseStatus.DRAFT, videoIds: ['video-one'], createdAt: today, updatedAt: today }];
    snapshot.videos = [{ id: 'video-one', courseId: 'course-one', title: '第一课', fileName: '第一课.mp4', durationSeconds: 600, status: VideoStatus.READY, orderIndex: 1, createdAt: today }];
    snapshot.watchEvents = [{ id: 'today', childId: 'active-child', videoId: 'video-one', effectiveWatchSeconds: 600, occurredAt: today }];

    renderRoute('/parent/overview', snapshot);

    expect(screen.getByTestId('metric-courses')).toHaveTextContent('1');
    expect(screen.getByTestId('metric-videos')).toHaveTextContent('1');
    expect(screen.getByTestId('metric-children')).toHaveTextContent('1');
    expect(screen.getByTestId('metric-today')).toHaveTextContent('10');

    cleanup();
    const empty = emptySnapshot();
    renderRoute('/parent/overview', empty);
    expect(screen.getByText('还没有课程，创建第一门课程')).toBeInTheDocument();
    expect(screen.getAllByText('还没有学习记录')).toHaveLength(2);
  });

  it('excludes inactive children from overview minutes and recent activity', () => {
    const snapshot = emptySnapshot();
    const today = new Date().toISOString();
    snapshot.children = [{ id: 'inactive-only', name: '已停用', avatar: '🌙', grade: '二年级', status: 'INACTIVE', createdAt: today }];
    snapshot.courses = [{ id: 'course-one', title: '课程', subjectId: 'math', description: '', ageRange: '6-8岁', cover: { style: 'sunrise', colors: ['#2D86F5'] }, status: CourseStatus.DRAFT, videoIds: ['video-one'], createdAt: today, updatedAt: today }];
    snapshot.videos = [{ id: 'video-one', courseId: 'course-one', title: '停用孩子的视频', fileName: '停用.mp4', durationSeconds: 600, status: VideoStatus.READY, orderIndex: 1, createdAt: today }];
    snapshot.watchEvents = [{ id: 'inactive-event', childId: 'inactive-only', videoId: 'video-one', effectiveWatchSeconds: 600, occurredAt: today }];

    renderRoute('/parent/overview', snapshot);

    expect(screen.getByTestId('metric-today')).toHaveTextContent('0');
    expect(screen.queryByText('停用孩子的视频')).not.toBeInTheDocument();
  });

  it('creates a draft course from the controlled editor', () => {
    renderRoute('/parent/courses?new=1', createSeedSnapshot());

    fireEvent.change(screen.getByLabelText('课程名称'), { target: { value: '新的数学课' } });
    fireEvent.change(screen.getByLabelText('课程学科'), { target: { value: 'math' } });
    fireEvent.click(screen.getByRole('button', { name: '保存课程' }));

    expect(screen.getByText('新的数学课')).toBeInTheDocument();
    expect(within(screen.getByText('新的数学课').closest('tr')!).getByText('草稿')).toBeInTheDocument();
  });

  it('shows the publish validation reason when no READY video exists', async () => {
    const snapshot = createSeedSnapshot();
    snapshot.courses = [];
    snapshot.videos = [];
    renderRoute('/parent/courses?new=1', snapshot);
    fireEvent.change(screen.getByLabelText('课程名称'), { target: { value: '无视频课程' } });
    fireEvent.change(screen.getByLabelText('课程学科'), { target: { value: 'math' } });
    fireEvent.click(screen.getByRole('button', { name: '保存课程' }));
    fireEvent.click(screen.getByRole('button', { name: '发布' }));

    expect(await screen.findByText('课程至少需要一个可播放视频')).toBeInTheDocument();
  });

  it('naturally sorts videos and moves a video up in course detail', () => {
    const snapshot = createSeedSnapshot();
    snapshot.courses = [{ ...snapshot.courses[0], id: 'sort-course', title: '排序课', videoIds: ['ten', 'two'] }];
    snapshot.videos = [
      { ...snapshot.videos[0], id: 'ten', courseId: 'sort-course', title: '第10课', fileName: '第10课.mp4', orderIndex: 10 },
      { ...snapshot.videos[1], id: 'two', courseId: 'sort-course', title: '第2课', fileName: '第2课.mp4', orderIndex: 2 },
    ];
    renderRoute('/parent/courses', snapshot);
    fireEvent.click(screen.getByRole('button', { name: '查看详情 排序课' }));

    const list = screen.getByTestId('video-list');
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('第2课');
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('第10课');
    const lastMoveDown = within(list).getAllByRole('button', { name: '下移' })[1];
    expect(lastMoveDown).toBeDisabled();
    fireEvent.click(within(list).getByRole('button', { name: '上移 第10课' }));
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('第10课');
  });

  it('adds a child and deactivates it after confirmation', async () => {
    renderRoute('/parent/children', createSeedSnapshot());
    fireEvent.click(screen.getByRole('button', { name: /新增孩子/ }));
    fireEvent.change(screen.getByLabelText('孩子昵称'), { target: { value: '小月' } });
    fireEvent.change(screen.getByLabelText('年级'), { target: { value: '一年级' } });
    fireEvent.click(screen.getByRole('button', { name: '保存孩子' }));
    expect(screen.getByText('小月')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '停用 小月' }));
    expect(screen.getByText('停用后儿童端将隐藏该孩子，但历史记录会保留。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认停用' }));
    expect(await screen.findByText('孩子已停用')).toBeInTheDocument();
  });

  it('clears the child saved feedback timer when the page unmounts', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    try {
      const view = renderRoute('/parent/children', createSeedSnapshot());
      fireEvent.click(screen.getByRole('button', { name: /新增孩子/ }));
      fireEvent.change(screen.getByLabelText('孩子昵称'), { target: { value: '小月' } });
      fireEvent.change(screen.getByLabelText('年级'), { target: { value: '一年级' } });
      fireEvent.click(screen.getByRole('button', { name: '保存孩子' }));
      await act(async () => { await Promise.resolve(); });
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      view.unmount();
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    } finally {
      clearTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('filters learning records and updates both summary and detail', () => {
    const snapshot = createSeedSnapshot();
    snapshot.watchEvents = [
      { id: 'math-event', childId: 'child-gege', videoId: 'video-space-1', effectiveWatchSeconds: 120, occurredAt: new Date().toISOString() },
      { id: 'old-event', childId: 'child-gege', videoId: 'video-chinese-1', effectiveWatchSeconds: 60, occurredAt: new Date(Date.now() - 86400000).toISOString() },
    ];
    renderRoute('/parent/records', snapshot);
    expect(screen.getByTestId('records-today')).toHaveTextContent('2');
    fireEvent.change(screen.getByLabelText('学科筛选'), { target: { value: 'chinese' } });
    expect(screen.getByTestId('records-today')).toHaveTextContent('0');
    expect(screen.getByText('第1课 静夜思')).toBeInTheDocument();
    expect(screen.queryByText('认识太阳')).not.toBeInTheDocument();
  });

  it('reports that storage is managed by the server instead of browser demo data', () => {
    renderRoute('/parent/settings', createSeedSnapshot());
    expect(screen.queryByRole('button', { name: '恢复演示数据' })).not.toBeInTheDocument();
    expect(screen.getByTestId('storage-size')).toHaveTextContent('服务器管理');
  });

  it('opens the file picker from the upload drop zone with Enter and Space', () => {
    renderRoute('/parent/uploads', createSeedSnapshot());
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    const dropZone = screen.getByRole('button', { name: '选择视频文件' });

    fireEvent.keyDown(dropZone, { key: 'Enter' });
    fireEvent.keyDown(dropZone, { key: ' ' });

    expect(clickSpy).toHaveBeenCalledTimes(2);
    clickSpy.mockRestore();
  });

  it('keeps weekly completion fixed while range changes and shows detail progress/status', () => {
    const snapshot = createSeedSnapshot();
    const today = new Date();
    const twoDaysAgo = new Date(today.getTime() - 2 * 86400000).toISOString();
    snapshot.watchEvents = [{ id: 'completed-event', childId: 'child-gege', videoId: 'video-chinese-1', effectiveWatchSeconds: 120, occurredAt: twoDaysAgo }];
    snapshot.watchProgress = [{ childId: 'child-gege', videoId: 'video-chinese-1', lastPositionSeconds: 260, maxProgress: 0.86, completed: false, totalWatchSeconds: 120, updatedAt: twoDaysAgo }, { childId: 'child-gege', videoId: 'video-space-1', lastPositionSeconds: 300, maxProgress: 1, completed: true, totalWatchSeconds: 300, updatedAt: today.toISOString() }];
    renderRoute('/parent/records?child=child-gege', snapshot);
    expect(screen.getByText('86%')).toBeInTheDocument();
    expect(screen.getByText('学习中')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('时间范围'), { target: { value: 'today' } });
    expect(screen.getByText('本周完成视频')).toBeInTheDocument();
    expect(screen.getByTestId('records-week-completed')).toHaveTextContent('1');
    expect(screen.getByTestId('records-streak')).toHaveTextContent('0');
  });

  it('counts a completed video once even when multiple watch events reference it', async () => {
    const now = new Date().toISOString();
    const course = {
      id: 'course-one', title: '数学课', subjectId: 'math', description: '', ageRange: '6-8岁',
      cover: { style: 'sunrise', colors: ['#2D86F5'] }, status: 'PUBLISHED', createdAt: now, updatedAt: now,
      videos: [{ id: 'video-one', courseId: 'course-one', title: '第一课', fileName: 'one.mp4', durationMs: 60_000, status: 'READY', sortOrder: 0, createdAt: now }],
    };
    const records = {
      total: 2, limit: 500, offset: 0,
      items: ['event-1', 'event-2'].map((id) => ({
        id, childId: 'child-one', videoId: 'video-one', effectiveWatchSeconds: 10, occurredAt: now,
        progress: { maxProgressPercent: 100, positionMs: 60_000, completed: true, updatedAt: now },
      })),
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin);
      const body = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.pathname === '/api/children') return body([{ id: 'child-one', name: '小星', avatar: '⭐', grade: '一年级', status: 'ACTIVE', createdAt: now }]);
      if (url.pathname === '/api/courses') return body([course]);
      if (url.pathname === '/api/overview') return body({ totals: { children: 1, courses: 1, readyVideos: 1, watchedSeconds: 20, completedVideos: 1 }, today: { watchedSeconds: 20, events: 2 }, week: { watchedSeconds: 20, startsAt: now }, dailyActivity: [], recentActivity: [], continueLearning: [] });
      if (url.pathname === '/api/records') return body(records);
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), { status: 404, headers: { 'content-type': 'application/json' } });
    }));
    window.history.pushState({}, '', '/parent/records');
    render(<AuthProvider initialSession={testSession}><AppStoreProvider><App /></AppStoreProvider></AuthProvider>);

    await waitFor(() => expect(screen.getByTestId('records-week-completed')).toHaveTextContent('1'));
  });

  it('uses the global search to open courses and match video names', () => {
    renderRoute('/parent/overview', createSeedSnapshot());
    const search = screen.getByLabelText('搜索课程或视频');
    fireEvent.change(search, { target: { value: '第10课' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.getByText('小小诗人：古诗启蒙')).toBeInTheDocument();
    expect(screen.getByText('第10课 春晓')).toBeInTheDocument();
  });

  it('defaults free course choice on and maintains a video title from detail', () => {
    renderRoute('/parent/settings', createSeedSnapshot());
    expect(screen.getByLabelText('允许自由选课')).toBeChecked();
    cleanup();
    renderRoute('/parent/courses/course-chinese', createSeedSnapshot());
    fireEvent.click(screen.getByRole('button', { name: '编辑视频 第1课 静夜思' }));
    fireEvent.change(screen.getByLabelText('视频标题'), { target: { value: '静夜思（更新版）' } });
    fireEvent.click(screen.getByRole('button', { name: '保存视频' }));
    expect(screen.getByText('静夜思（更新版）')).toBeInTheDocument();
  });

  it('keeps focus in the video title input while editing', () => {
    renderRoute('/parent/courses/course-chinese', createSeedSnapshot());
    fireEvent.click(screen.getByRole('button', { name: '编辑视频 第1课 静夜思' }));
    const input = screen.getByLabelText('视频标题');
    input.focus();

    fireEvent.change(input, { target: { value: '静夜思（输入中）' } });

    expect(document.activeElement).toBe(input);
  });

  it('shares the eye-care preference with the child shell', () => {
    renderRoute('/parent/settings', createSeedSnapshot());
    fireEvent.click(screen.getByLabelText('护眼模式'));
    expect(localStorage.getItem(EYE_CARE_STORAGE_KEY)).toBe('true');

    cleanup();
    renderRoute('/child/select', createSeedSnapshot());
    expect(screen.getByTestId('child-shell')).toHaveClass('eye-care');
  });

});
