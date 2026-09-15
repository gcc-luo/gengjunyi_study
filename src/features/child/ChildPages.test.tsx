import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

function childSnapshot(): Snapshot {
  const snapshot = createSeedSnapshot();
  snapshot.children = [{ id: 'child-one', name: '小星', avatar: '⭐', grade: '一年级', status: 'ACTIVE', createdAt: '2026-09-01T00:00:00.000Z' }];
  snapshot.courses = [{ id: 'math-course', title: '数学小探险', subjectId: 'math', description: '认识有趣的数字。', ageRange: '6-8岁', cover: { style: 'sunrise', colors: ['#FFBD3F', '#FFE6A8'] }, status: CourseStatus.PUBLISHED, videoIds: ['ready-video', 'loading-video'], createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z' }, { id: 'chinese-course', title: '语文故事会', subjectId: 'chinese', description: '读好玩的故事。', ageRange: '6-8岁', cover: { style: 'mountain', colors: ['#2D86F5', '#9ED8FF'] }, status: CourseStatus.PUBLISHED, videoIds: ['chinese-video'], createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z' }];
  snapshot.videos = [{ id: 'ready-video', courseId: 'math-course', title: '认识数字', fileName: 'numbers.mp4', durationSeconds: 120, status: VideoStatus.READY, orderIndex: 1, createdAt: '2026-09-01T00:00:00.000Z' }, { id: 'loading-video', courseId: 'math-course', title: '加法练习', fileName: 'addition.mp4', durationSeconds: 150, status: VideoStatus.UPLOADING, orderIndex: 2, createdAt: '2026-09-01T00:00:00.000Z' }, { id: 'chinese-video', courseId: 'chinese-course', title: '小故事', fileName: 'story.mp4', durationSeconds: 180, status: VideoStatus.READY, orderIndex: 1, createdAt: '2026-09-01T00:00:00.000Z' }];
  snapshot.watchProgress = [{ childId: 'child-one', videoId: 'ready-video', lastPositionSeconds: 120, maxProgress: 1, completed: true, totalWatchSeconds: 120, updatedAt: '2026-09-04T00:00:00.000Z' }];
  snapshot.watchEvents = [];
  return snapshot;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.pushState({}, '', '/');
});

describe('child learning pages', () => {
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

  it('shows an empty state and parent entry when there are no active children', () => {
    const snapshot = createSeedSnapshot();
    snapshot.children = [];

    renderRoute('/child/select', snapshot);

    expect(screen.getByText('还没有可选择的孩子')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '家长入口' })).toHaveAttribute('href', '/parent/overview');
  });

  it('shows the current child course progress only on home', () => {
    renderRoute('/child/home', childSnapshot());

    expect(screen.getByRole('heading', { name: '你好，小星' })).toBeInTheDocument();
    expect(screen.getByText('数学小探险')).toBeInTheDocument();
    expect(screen.getByText('语文故事会')).toBeInTheDocument();
    expect(screen.getByTestId('course-progress-math-course')).toHaveTextContent('100%');
    expect(screen.queryByText('哥哥')).not.toBeInTheDocument();
  });

  it('filters courses by subject query and links READY videos to the player', () => {
    renderRoute('/child/courses?subject=math', childSnapshot());

    expect(screen.getByText('数学小探险')).toBeInTheDocument();
    expect(screen.queryByText('语文故事会')).not.toBeInTheDocument();

    cleanup();
    renderRoute('/child/course/math-course', childSnapshot());
    expect(screen.getByText('课程目录')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /认识数字/ })).toHaveAttribute('href', '/child/watch/ready-video');
    expect(within(screen.getByTestId('video-row-loading-video')).getByText('暂不可播放')).toBeInTheDocument();
  });

  it('persists eye-care preference and toggles the child shell class', () => {
    renderRoute('/child/me', childSnapshot());

    const toggle = screen.getByRole('checkbox', { name: '护眼模式' });
    expect(screen.getByTestId('child-shell')).not.toHaveClass('eye-care');
    fireEvent.click(toggle);

    expect(localStorage.getItem('family-learning-app:eye-care')).toBe('true');
    expect(screen.getByTestId('child-shell')).toHaveClass('eye-care');
  });

  it('keeps the parent route on the parent shell', () => {
    renderRoute('/parent/overview', createSeedSnapshot());

    expect(screen.getByRole('heading', { name: '概览' })).toBeInTheDocument();
    expect(screen.queryByText('你好，哥哥')).not.toBeInTheDocument();
    expect(screen.getByTestId('metric-courses')).toBeInTheDocument();
  });
});
