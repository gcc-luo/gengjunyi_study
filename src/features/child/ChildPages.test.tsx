import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../../App';
import { AppStoreProvider } from '../../context/AppStore';
import { createSeedSnapshot } from '../../data/seed';
import { CourseStatus, VideoStatus, type Snapshot } from '../../types/domain';
import { EYE_CARE_STORAGE_KEY } from './preferences';

function renderRoute(path: string, snapshot?: Snapshot) {
  window.history.pushState({}, '', path);
  return render(
    <AppStoreProvider initialSnapshot={snapshot ?? createSeedSnapshot()}>
      <App />
    </AppStoreProvider>,
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
    fireEvent.click(screen.getByRole('link', { name: /123 数学/ }));

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

  it('uses the shared free-choice preference to limit courses to learned content', () => {
    localStorage.setItem('family-learning:free-choice', 'false');
    renderRoute('/child/select', childSnapshot());
    fireEvent.click(screen.getByRole('button', { name: '选择小星' }));
    fireEvent.click(screen.getByRole('link', { name: '课程' }));

    expect(screen.getByText('数学小探险')).toBeInTheDocument();
    expect(screen.queryByText('语文故事会')).not.toBeInTheDocument();

    cleanup();
    const noLearning = childSnapshot();
    noLearning.watchProgress = [];
    renderRoute('/child/select', noLearning);
    fireEvent.click(screen.getByRole('button', { name: '选择小星' }));
    fireEvent.click(screen.getByRole('link', { name: '课程' }));
    expect(screen.getByText('还没有找到课程')).toBeInTheDocument();
    expect(screen.getByText('当前孩子还没有已学习的课程，请先开始一段学习。')).toBeInTheDocument();
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
  });

  it('shows the records empty state for a child without learning activity', () => {
    const snapshot = childSnapshot();
    snapshot.watchProgress = [];
    snapshot.watchEvents = [];
    renderRoute('/child/select', snapshot);
    fireEvent.click(screen.getByRole('button', { name: '选择小星' }));
    fireEvent.click(screen.getByRole('link', { name: '我的' }));
    fireEvent.click(screen.getByRole('link', { name: /学习记录/ }));

    fireEvent.click(screen.getByRole('tab', { name: '学习历史' }));
    expect(screen.getByText('今天从喜欢的课程开始吧')).toBeInTheDocument();
  });
});
