import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStoreProvider, useAppStore } from './AppStore';
import { AuthProvider, type AuthSession } from './AuthProvider';
import { queryClient } from '../lib/query-client';

const session: AuthSession = { authenticated: true, admin: { id: 'parent-1', email: 'parent@example.test' }, activeChildId: null, activeChild: null, csrfToken: 'csrf-test' };
const overview = { totals: { children: 0, courses: 0, readyVideos: 0, watchedSeconds: 0, completedVideos: 0 }, today: { watchedSeconds: 0, events: 0 }, week: { watchedSeconds: 0, startsAt: '2026-09-14T00:00:00.000Z' }, dailyActivity: [], recentActivity: [], continueLearning: [] };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider initialSession={session}><AppStoreProvider>{children}</AppStoreProvider></AuthProvider>;
}

describe('remote AppStore', () => {
  beforeEach(() => {
    queryClient.clear();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === '/api/children') return json([]);
      if (url.pathname === '/api/courses' && init?.method === 'POST') return json({ id: 'course-1', title: '真实课程', subjectId: 'math', description: '', ageRange: '', cover: { style: 'sunrise', colors: ['#2D86F5', '#9ED8FF'] }, status: 'DRAFT', createdAt: '2026-09-17T00:00:00.000Z', updatedAt: '2026-09-17T00:00:00.000Z', videos: [] }, 201);
      if (url.pathname === '/api/courses') return json([]);
      if (url.pathname === '/api/overview') return json(overview);
      if (url.pathname === '/api/records') return json({ total: 0, limit: 100, offset: 0, items: [] });
      return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    }));
  });

  afterEach(() => {
    queryClient.clear();
    vi.unstubAllGlobals();
  });

  it('loads server-owned parent data and persists create commands through the API', async () => {
    const { result } = renderHook(() => useAppStore(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isRemote).toBe(true);
    expect(result.current.children).toEqual([]);

    let course!: Awaited<ReturnType<typeof result.current.createCourse>>;
    await act(async () => {
      course = await result.current.createCourse({ title: '真实课程', subjectId: 'math' });
    });

    expect(course).toMatchObject({ id: 'course-1', title: '真实课程' });
    const createCall = vi.mocked(fetch).mock.calls.find(([input, init]) => String(input).includes('/api/courses') && init?.method === 'POST');
    expect(createCall).toBeDefined();
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({ title: '真实课程', subjectId: 'math' });
  });

  it('does not send API reads for an unauthenticated session', async () => {
    queryClient.clear();
    const anonymous: AuthSession = { authenticated: false, activeChildId: null, csrfToken: 'csrf-anonymous' };
    const anonymousWrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider initialSession={anonymous}><AppStoreProvider>{children}</AppStoreProvider></AuthProvider>;
    const { result } = renderHook(() => useAppStore(), { wrapper: anonymousWrapper });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.children).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('restores child progress from child-scoped APIs after a hard refresh', async () => {
    queryClient.clear();
    const childSession: AuthSession = {
      authenticated: true,
      admin: { id: 'parent-1', email: 'parent@example.test' },
      activeChildId: 'child-1',
      activeChild: { id: 'child-1', name: '小星' },
      csrfToken: 'csrf-test',
      parentUnlocked: false,
    };
    const course = {
      id: 'course-1', title: '数学课', subjectId: 'math', description: '', ageRange: '6-8岁',
      cover: { style: 'sunrise', colors: ['#2D86F5'] }, status: 'PUBLISHED',
      createdAt: '2026-09-17T00:00:00.000Z', updatedAt: '2026-09-17T00:00:00.000Z',
      videos: [{
        id: 'video-1', title: '第一课', fileName: 'one.mp4', durationMs: 100_000, status: 'READY', sortOrder: 0,
        createdAt: '2026-09-17T00:00:00.000Z',
        progress: { positionMs: 37_000, maxProgressPercent: 37, completed: false, updatedAt: '2026-09-20T08:00:00.000Z' },
      }],
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === '/api/child/profile') return json({ id: 'child-1', name: '小星', avatar: '⭐', grade: '一年级', status: 'ACTIVE', createdAt: '2026-09-01T00:00:00.000Z' });
      if (url.pathname === '/api/child/courses') return json([course]);
      if (url.pathname === '/api/children/child-1/records') return json({
        childId: 'child-1', totalWatchedSeconds: 37, completedVideos: 0,
        videos: [{ videoId: 'video-1', positionMs: 37_000, maxProgressPercent: 37, completed: false, updatedAt: '2026-09-20T08:00:00.000Z' }],
        recentActivity: [{ id: 'event-1', videoId: 'video-1', watchedSeconds: 10, occurredAt: '2026-09-20T08:00:00.000Z' }],
      });
      if (url.pathname === '/api/children/child-1/favorites') return json([]);
      return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    }));
    const childWrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider initialSession={childSession}><AppStoreProvider>{children}</AppStoreProvider></AuthProvider>;

    const { result } = renderHook(() => useAppStore(), { wrapper: childWrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.progress).toContainEqual(expect.objectContaining({ videoId: 'video-1', lastPositionSeconds: 37, maxProgress: 0.37 }));
    expect(result.current.snapshot.videos).toContainEqual(expect.objectContaining({ id: 'video-1', courseId: 'course-1' }));
    expect(result.current.watchEvents).toContainEqual(expect.objectContaining({ id: 'event-1', effectiveWatchSeconds: 10 }));
  });
});
