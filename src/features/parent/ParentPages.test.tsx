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
    expect(screen.getAllByText('已完成')).toHaveLength(2);
    vi.useRealTimers();
  });
});
