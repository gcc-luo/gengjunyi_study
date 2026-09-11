import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../../App';
import { AppStoreProvider } from '../../context/AppStore';
import { createSeedSnapshot } from '../../data/seed';
import { CourseStatus, VideoStatus, type Snapshot } from '../../types/domain';

function renderRoute(path: string, snapshot?: Snapshot) {
  window.history.pushState({}, '', path);
  return render(
    <AppStoreProvider initialSnapshot={snapshot ?? createSeedSnapshot()}>
      <App />
    </AppStoreProvider>,
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

  it('shows the publish validation reason when no READY video exists', () => {
    const snapshot = createSeedSnapshot();
    snapshot.courses = [];
    snapshot.videos = [];
    renderRoute('/parent/courses?new=1', snapshot);
    fireEvent.change(screen.getByLabelText('课程名称'), { target: { value: '无视频课程' } });
    fireEvent.change(screen.getByLabelText('课程学科'), { target: { value: 'math' } });
    fireEvent.click(screen.getByRole('button', { name: '保存课程' }));
    fireEvent.click(screen.getByRole('button', { name: '发布' }));

    expect(screen.getByText('课程至少需要一个可播放视频')).toBeInTheDocument();
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

  it('adds a child and deactivates it after confirmation', () => {
    renderRoute('/parent/children', createSeedSnapshot());
    fireEvent.click(screen.getByRole('button', { name: /新增孩子/ }));
    fireEvent.change(screen.getByLabelText('孩子昵称'), { target: { value: '小月' } });
    fireEvent.change(screen.getByLabelText('年级'), { target: { value: '一年级' } });
    fireEvent.click(screen.getByRole('button', { name: '保存孩子' }));
    expect(screen.getByText('小月')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '停用 小月' }));
    expect(screen.getByText('停用后儿童端将隐藏该孩子，但历史记录会保留。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认停用' }));
    expect(screen.getByText('孩子已停用')).toBeInTheDocument();
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

  it('resets data from settings and reports feedback', () => {
    renderRoute('/parent/settings', createSeedSnapshot());
    fireEvent.click(screen.getByRole('button', { name: '恢复演示数据' }));
    expect(screen.getByText('演示数据已恢复')).toBeInTheDocument();
    expect(screen.getByTestId('storage-size')).toHaveTextContent('KB');
  });

  it('validates upload formats, naturally orders tasks, and completes independently', () => {
    vi.useFakeTimers();
    renderRoute('/parent/uploads', createSeedSnapshot());
    fireEvent.change(screen.getByLabelText('所属课程'), { target: { value: 'course-chinese' } });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const invalid = new File(['text'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [invalid] } });
    expect(screen.getByText(/格式不支持，仅支持 MP4 \/ MOV/)).toBeInTheDocument();
    const tenth = new File(['video'], '第10课.mp4', { type: 'video/mp4' });
    const second = new File(['video'], '第2课.mp4', { type: 'video/mp4' });
    fireEvent.change(input, { target: { files: [tenth, second] } });
    const tasks = screen.getByText('第2课.mp4').closest('.task-list')!;
    expect(tasks.textContent?.indexOf('第2课.mp4') ?? -1).toBeLessThan(tasks.textContent?.indexOf('第10课.mp4') ?? -1);
    act(() => { vi.advanceTimersByTime(120 * 8); });
    expect(document.querySelectorAll('.task-status.task-completed')).toHaveLength(2);
    vi.useRealTimers();
  });

  it('keeps weekly completion fixed while range changes and shows detail progress/status', () => {
    const snapshot = createSeedSnapshot();
    const today = new Date();
    const twoDaysAgo = new Date(today.getTime() - 2 * 86400000).toISOString();
    snapshot.watchEvents = [{ id: 'completed-event', childId: 'child-gege', videoId: 'video-chinese-1', effectiveWatchSeconds: 120, occurredAt: twoDaysAgo }];
    snapshot.watchProgress = [{ childId: 'child-gege', videoId: 'video-chinese-1', lastPositionSeconds: 260, maxProgress: 0.86, completed: false, totalWatchSeconds: 120, updatedAt: twoDaysAgo }, { childId: 'child-gege', videoId: 'video-space-1', lastPositionSeconds: 300, maxProgress: 1, completed: true, totalWatchSeconds: 300, updatedAt: twoDaysAgo }];
    renderRoute('/parent/records?child=child-gege', snapshot);
    expect(screen.getByText('86%')).toBeInTheDocument();
    expect(screen.getByText('学习中')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('时间范围'), { target: { value: 'today' } });
    expect(screen.getByText('本周完成视频')).toBeInTheDocument();
    expect(screen.getByTestId('records-week-completed')).toHaveTextContent('1');
    expect(screen.getByTestId('records-streak')).toHaveTextContent('0');
  });

  it('uses the global search to open courses and match video names', () => {
    renderRoute('/parent/overview', createSeedSnapshot());
    const search = screen.getByLabelText('搜索课程、孩子或记录');
    fireEvent.change(search, { target: { value: '第10课' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.getByText('小小诗人：古诗启蒙')).toBeInTheDocument();
    expect(screen.getByText('第10课 春晓')).toBeInTheDocument();
  });

  it('keeps valid upload files when a batch also contains an invalid file', () => {
    vi.useFakeTimers();
    renderRoute('/parent/uploads', createSeedSnapshot());
    fireEvent.change(screen.getByLabelText('所属课程'), { target: { value: 'course-chinese' } });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const valid = new File(['video'], '第3课.mp4', { type: 'video/mp4' });
    const invalid = new File(['text'], '说明.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [invalid, valid] } });
    expect(screen.getByText('第3课.mp4')).toBeInTheDocument();
    expect(screen.getByText(/说明.txt.*格式不支持/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('family-learning-app:v1') ?? '{}').uploadTasks).toEqual(expect.arrayContaining([expect.objectContaining({ fileName: '第3课.mp4', status: 'QUEUED' })]));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(document.querySelectorAll('.task-status.task-cancelled')).toHaveLength(1);
    vi.useRealTimers();
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

  it('does not add a completed upload task again after remounting', () => {
    localStorage.clear();
    const snapshot = createSeedSnapshot();
    snapshot.uploadTasks = [{ id: 'upload-completed', courseId: 'course-chinese', fileName: '第99课.mp4', progress: 1, status: 'COMPLETED' }];
    renderRoute('/parent/uploads', snapshot);
    cleanup();

    window.history.pushState({}, '', '/parent/uploads');
    render(<AppStoreProvider><App /></AppStoreProvider>);
    const persisted = JSON.parse(localStorage.getItem('family-learning-app:v1') ?? '{}');
    expect(persisted.videos.filter((video: { courseId: string; fileName: string }) => video.courseId === 'course-chinese' && video.fileName === '第99课.mp4')).toHaveLength(1);
  });
});
