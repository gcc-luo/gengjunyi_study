import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, ApiError } from '../lib/api-client';
import { queryClient } from '../lib/query-client';
import { useAuthOptional } from './AuthProvider';
import { addWatchEvent, canPublishCourse, createProgressUpdate, type PublishResult } from '../lib/domain';
import { loadSnapshot, persistSnapshot, resetStorage } from '../lib/storage';
import { ChildStatus, CourseStatus, VideoStatus, type Child, type Course, type Favorite, type Snapshot, type UploadTask, type Video, type WatchEvent, type WatchProgress } from '../types/domain';
import { subjects as subjectCatalog } from '../data/subjects';
import type { SubjectId } from '../types/domain';

type CourseInput = Partial<Pick<Course, 'description' | 'ageRange' | 'cover' | 'videoIds'>> & Pick<Course, 'title' | 'subjectId'>;
type VideoInput = Pick<Video, 'title' | 'fileName' | 'durationSeconds'> & Partial<Pick<Video, 'status' | 'orderIndex'>>;
type ProgressEventType = 'PROGRESS' | 'PLAY' | 'PAUSE' | 'SEEK' | 'ENDED';
type ProgressInput = Pick<WatchProgress, 'childId' | 'videoId' | 'lastPositionSeconds'> & { progress: number; deltaWatchSeconds: number; isPlaying: boolean; eventType?: ProgressEventType; updatedAt?: string };
type ChildInput = Pick<Child, 'name' | 'avatar' | 'grade'>;
type ChildUpdate = Partial<ChildInput> & Partial<Pick<Child, 'status'>>;
type UploadTaskInput = Pick<UploadTask, 'courseId' | 'fileName'>;
type UploadVideoInput = Pick<Video, 'title' | 'durationSeconds'>;

export interface AppStoreValue {
  snapshot: Snapshot;
  currentChildId: string | null;
  currentChild: Child | undefined;
  setCurrentChild: (id: string | null) => MaybePromise<void>;
  selectChild: (id: string | null) => void;
  subjects: Snapshot['subjects'];
  children: Child[];
  courses: Course[];
  videos: Video[];
  childCourses: Course[];
  childVideos: Video[];
  progress: WatchProgress[];
  watchEvents: WatchEvent[];
  favorites: Favorite[];
  uploadTasks: UploadTask[];
  isLoading: boolean;
  isRemote: boolean;
  error: string | null;
  retry: () => Promise<void>;
  overview: OverviewData | null;
  createCourse: (input: CourseInput) => MaybePromise<Course>;
  updateCourse: (id: string, input: Partial<CourseInput>) => MaybePromise<Course | undefined>;
  publishCourse: (id: string) => MaybePromise<PublishResult>;
  offlineCourse: (id: string) => MaybePromise<Course | undefined>;
  addVideo: (courseId: string, input: VideoInput) => MaybePromise<Video>;
  updateVideo: (id: string, input: Partial<VideoInput>) => MaybePromise<Video | undefined>;
  removeVideo: (id: string) => MaybePromise<void>;
  restoreVideo: (id: string) => MaybePromise<Video | undefined>;
  createChild: (input: ChildInput) => MaybePromise<Child>;
  updateChild: (id: string, input: ChildUpdate) => MaybePromise<Child | undefined>;
  deactivateChild: (id: string) => MaybePromise<Child | undefined>;
  saveWatchProgress: (input: ProgressInput) => MaybePromise<WatchProgress | undefined>;
  toggleFavorite: (input: { courseId?: string; videoId?: string }) => MaybePromise<Favorite | undefined>;
  createUploadTask: (input: UploadTaskInput) => UploadTask;
  updateUploadTask: (id: string, input: Partial<UploadTask>) => UploadTask | undefined;
  completeUploadTask: (id: string, input: UploadVideoInput) => MaybePromise<Video | undefined>;
  resetSnapshot: (snapshot?: Snapshot) => MaybePromise<void>;
}

type MaybePromise<T> = T | Promise<T>;
export type OverviewData = {
  totals: { children: number; courses: number; readyVideos: number; watchedSeconds: number; completedVideos: number };
  today: { watchedSeconds: number; events: number };
  week: { watchedSeconds: number; startsAt: string };
  dailyActivity: Array<{ date: string; watchedSeconds: number }>;
  recentActivity: Array<{ id: string; childId: string; videoId: string; watchedSeconds: number; occurredAt: string }>;
  continueLearning: Array<{ childId: string; videoId: string; positionMs: number; maxProgressPercent: number; updatedAt: string }>;
};

const AppStoreContext = createContext<AppStoreValue | undefined>(undefined);
let idCounter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now()}-${idCounter++}`;
const now = () => new Date().toISOString();
const normalizeUploadProgress = (value: unknown, fallback: number) => {
  const safeFallback = typeof fallback === 'number' && Number.isFinite(fallback) ? Math.max(0, Math.min(1, fallback)) : 0;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : safeFallback;
};

function LocalAppStoreProvider({ children, initialSnapshot }: { children: ReactNode; initialSnapshot: Snapshot }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => structuredClone(initialSnapshot));
  const snapshotRef = useRef(snapshot);
  const [currentChildId, setCurrentChildId] = useState<string | null>(null);

  const commit = (next: Snapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
    persistSnapshot(next);
  };
  const update = (mutator: (draft: Snapshot) => void) => {
    const next = structuredClone(snapshotRef.current);
    mutator(next);
    commit(next);
  };

  const value = useMemo<AppStoreValue>(() => {
    const scopedProgress = currentChildId ? snapshot.watchProgress.filter((item) => item.childId === currentChildId) : [];
    const scopedEvents = currentChildId ? snapshot.watchEvents.filter((item) => item.childId === currentChildId) : [];
    const setCurrentChild = (id: string | null) => setCurrentChildId(id && snapshotRef.current.children.some((child) => child.id === id && child.status === ChildStatus.ACTIVE) ? id : null);
    const createCourse = (input: CourseInput) => {
      const course: Course = { id: newId('course'), title: input.title, subjectId: input.subjectId, description: input.description ?? '', ageRange: input.ageRange ?? '', cover: input.cover ?? { style: 'sunrise', colors: ['#2D86F5', '#9ED8FF'] }, status: CourseStatus.DRAFT, videoIds: [], createdAt: now(), updatedAt: now() };
      update((draft) => draft.courses.push(course));
      return course;
    };
    const updateCourse = (id: string, input: Partial<CourseInput>) => { const course = snapshotRef.current.courses.find((item) => item.id === id); if (!course) return undefined; const next = { ...course, ...input, updatedAt: now() }; update((draft) => { const index = draft.courses.findIndex((item) => item.id === id); draft.courses[index] = next; if (input.videoIds) { input.videoIds.forEach((videoId, order) => { const video = draft.videos.find((item) => item.id === videoId && item.courseId === id); if (video) video.orderIndex = order + 1; }); } }); return next; };
    const publishCourse = (id: string): PublishResult => { const current = snapshotRef.current; const course = current.courses.find((item) => item.id === id); if (!course) return { ok: false, reason: '课程不存在' }; const result = canPublishCourse(course, current.videos); if (!result.ok) return result; update((draft) => { const target = draft.courses.find((item) => item.id === id); if (target) { target.status = CourseStatus.PUBLISHED; target.updatedAt = now(); } }); return { ok: true }; };
    const offlineCourse = (id: string) => { const course = snapshotRef.current.courses.find((item) => item.id === id); if (!course) return undefined; const next = { ...course, status: CourseStatus.OFFLINE, updatedAt: now() }; update((draft) => { const target = draft.courses.find((item) => item.id === id); if (target) Object.assign(target, next); }); return next; };
    const addVideo = (courseId: string, input: VideoInput) => { const orderIndex = Math.max(0, ...snapshotRef.current.videos.filter((video) => video.courseId === courseId).map((video) => video.orderIndex)) + 1; const video: Video = { id: newId('video'), courseId, title: input.title, fileName: input.fileName, durationSeconds: input.durationSeconds, status: input.status ?? VideoStatus.READY, orderIndex, createdAt: now() }; update((draft) => { draft.videos.push(video); const course = draft.courses.find((item) => item.id === courseId); if (course) course.videoIds.push(video.id); }); return video; };
    const updateVideo = (id: string, input: Partial<VideoInput>) => { const video = snapshotRef.current.videos.find((item) => item.id === id); if (!video) return undefined; const next = { ...video, ...input }; update((draft) => { const index = draft.videos.findIndex((item) => item.id === id); draft.videos[index] = next; }); return next; };
    const removeVideo = (id: string) => update((draft) => { const video = draft.videos.find((item) => item.id === id); if (video) video.status = VideoStatus.ARCHIVED; });
    const restoreVideo = (id: string) => { const video = snapshotRef.current.videos.find((item) => item.id === id); if (!video) return undefined; const restored = { ...video, status: VideoStatus.READY }; update((draft) => { const target = draft.videos.find((item) => item.id === id); if (target) target.status = VideoStatus.READY; }); return restored; };
    const createChild = (input: ChildInput) => { const child: Child = { ...input, id: newId('child'), status: ChildStatus.ACTIVE, createdAt: now() }; update((draft) => draft.children.push(child)); return child; };
    const updateChild = (id: string, input: ChildUpdate) => { const child = snapshotRef.current.children.find((item) => item.id === id); if (!child) return undefined; const next = { ...child, ...input }; update((draft) => { const index = draft.children.findIndex((item) => item.id === id); draft.children[index] = next; }); return next; };
    const deactivateChild = (id: string) => { const child = snapshotRef.current.children.find((item) => item.id === id); if (!child) return undefined; const next = { ...child, status: ChildStatus.INACTIVE }; update((draft) => { const target = draft.children.find((item) => item.id === id); if (target) target.status = ChildStatus.INACTIVE; }); if (currentChildId === id) setCurrentChildId(null); return next; };
    const saveWatchProgress = (input: ProgressInput) => {
      if (!currentChildId) throw new Error('当前孩子未选择，不能保存学习进度');
      if (input.childId !== currentChildId) throw new Error('当前孩子与进度写入孩子不一致');
      const video = snapshotRef.current.videos.find((item) => item.id === input.videoId);
      if (!video) return undefined;
      const previous = snapshotRef.current.watchProgress.find((item) => item.childId === input.childId && item.videoId === input.videoId);
      const hasPendingPlayedSeconds = input.deltaWatchSeconds > 0;
      const nextProgress = createProgressUpdate(previous, { ...input, isPlaying: input.isPlaying || hasPendingPlayedSeconds, durationSeconds: video.durationSeconds });
      update((draft) => {
        const index = draft.watchProgress.findIndex((item) => item.childId === input.childId && item.videoId === input.videoId);
        if (index === -1) draft.watchProgress.push(nextProgress); else draft.watchProgress[index] = nextProgress;
        draft.watchEvents = addWatchEvent(draft.watchEvents, { childId: input.childId, videoId: input.videoId, isPlaying: input.isPlaying || hasPendingPlayedSeconds, deltaWatchSeconds: input.deltaWatchSeconds, positionSeconds: input.lastPositionSeconds, occurredAt: input.updatedAt });
      });
      return nextProgress;
    };
    const toggleFavorite = (input: { courseId?: string; videoId?: string }) => { if (!currentChildId || (!input.courseId && !input.videoId)) return undefined; const existing = snapshotRef.current.favorites.find((item) => item.childId === currentChildId && item.courseId === input.courseId && item.videoId === input.videoId); if (existing) { update((draft) => { draft.favorites = draft.favorites.filter((item) => item.id !== existing.id); }); return undefined; } const favorite: Favorite = { id: newId('favorite'), childId: currentChildId, ...input, createdAt: now() }; update((draft) => draft.favorites.push(favorite)); return favorite; };
    const createUploadTask = (input: UploadTaskInput) => { const task: UploadTask = { id: newId('upload'), courseId: input.courseId, fileName: input.fileName, progress: 0, status: 'QUEUED' }; update((draft) => draft.uploadTasks.push(task)); return task; };
    const updateUploadTask = (id: string, input: Partial<UploadTask>) => { const task = snapshotRef.current.uploadTasks.find((item) => item.id === id); if (!task) return undefined; const next: UploadTask = { ...task, ...input, progress: normalizeUploadProgress(input.progress, task.progress) }; update((draft) => { const index = draft.uploadTasks.findIndex((item) => item.id === id); draft.uploadTasks[index] = next; }); return next; };
    const completeUploadTask = (id: string, input: UploadVideoInput) => {
      const current = snapshotRef.current;
      const task = current.uploadTasks.find((item) => item.id === id);
      if (!task) return undefined;
      const linkedVideo = task.videoId ? current.videos.find((video) => video.id === task.videoId) : undefined;
      if (linkedVideo) return linkedVideo;
      const legacyVideo = current.videos.find((video) => video.courseId === task.courseId && video.fileName === task.fileName && video.title === input.title);
      if (legacyVideo) {
        update((draft) => {
          const target = draft.uploadTasks.find((item) => item.id === id);
          if (target) { target.videoId = legacyVideo.id; target.status = 'COMPLETED'; target.progress = 1; target.error = undefined; }
        });
        return legacyVideo;
      }
      const orderIndex = Math.max(0, ...current.videos.filter((video) => video.courseId === task.courseId).map((video) => video.orderIndex)) + 1;
      const video: Video = { id: newId('video'), courseId: task.courseId, title: input.title, fileName: task.fileName, durationSeconds: input.durationSeconds, status: VideoStatus.READY, orderIndex, createdAt: now() };
      update((draft) => {
        draft.videos.push(video);
        const course = draft.courses.find((item) => item.id === task.courseId);
        if (course && !course.videoIds.includes(video.id)) course.videoIds.push(video.id);
        const target = draft.uploadTasks.find((item) => item.id === id);
        if (target) { target.videoId = video.id; target.status = 'COMPLETED'; target.progress = 1; target.error = undefined; }
      });
      return video;
    };
    const resetSnapshotCommand = (next?: Snapshot) => { const replacement = next ?? resetStorage(); commit(replacement); setCurrentChildId(replacement.children.find((child) => child.status === ChildStatus.ACTIVE)?.id ?? null); };
    return { snapshot, currentChildId, currentChild: snapshot.children.find((child) => child.id === currentChildId), setCurrentChild, selectChild: setCurrentChild, subjects: snapshot.subjects, children: snapshot.children, courses: snapshot.courses, videos: snapshot.videos, childCourses: snapshot.courses, childVideos: snapshot.videos, progress: scopedProgress, watchEvents: scopedEvents, favorites: currentChildId ? snapshot.favorites.filter((item) => item.childId === currentChildId) : [], uploadTasks: snapshot.uploadTasks, isLoading: false, isRemote: false, error: null, retry: async () => undefined, overview: null, createCourse, updateCourse, publishCourse, offlineCourse, addVideo, updateVideo, removeVideo, restoreVideo, createChild, updateChild, deactivateChild, saveWatchProgress, toggleFavorite, createUploadTask, updateUploadTask, completeUploadTask, resetSnapshot: resetSnapshotCommand };
  }, [snapshot, currentChildId]);

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

type ChildApi = { id: string; name: string; avatar: string; grade: string; status: 'ACTIVE' | 'DISABLED'; createdAt: string };
type CourseApi = {
  id: string; title: string; subjectId: string; description: string | null; ageRange: string;
  cover: { style: string; colors: string[] }; status: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED';
  createdAt: string; updatedAt: string;
  videos: Array<{ id: string; courseId?: string; title: string; fileName: string; durationMs: number | null; status: string; sortOrder: number; createdAt: string }>;
};
type RecordApi = {
  total: number; items: Array<{
    id: string; childId: string; videoId: string; effectiveWatchSeconds: number; occurredAt: string;
    progress: { maxProgressPercent: number; positionMs: number; completed: boolean } | null;
  }>;
};

function mapChild(child: ChildApi): Child {
  return { ...child, status: child.status === 'ACTIVE' ? ChildStatus.ACTIVE : ChildStatus.INACTIVE };
}

function mapCourse(course: CourseApi): Course {
  return {
    id: course.id,
    title: course.title,
    subjectId: (course.subjectId || 'math') as SubjectId,
    description: course.description ?? '',
    ageRange: course.ageRange ?? '',
    cover: course.cover ?? { style: 'sunrise', colors: ['#2D86F5', '#9ED8FF'] },
    status: course.status === 'UNPUBLISHED' ? CourseStatus.OFFLINE : course.status,
    videoIds: course.videos.map((video) => video.id),
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
  };
}

function mapVideo(video: CourseApi['videos'][number]): Video {
  return mapVideoWithCourse(video, video.courseId);
}

function mapVideoWithCourse(video: CourseApi['videos'][number], courseId: string | undefined): Video {
  const status = video.status === 'UPLOADING' || video.status === 'PROCESSING' || video.status === 'READY'
    ? video.status
    : video.status === 'ARCHIVED' ? 'ARCHIVED' : 'FAILED';
  return {
    id: video.id,
    courseId: courseId ?? '',
    title: video.title,
    fileName: video.fileName,
    durationSeconds: video.durationMs ? video.durationMs / 1000 : 0,
    status,
    orderIndex: video.sortOrder + 1,
    createdAt: video.createdAt,
  };
}

function mapChildCourse(course: CourseApi): Course {
  return mapCourse(course);
}

function emptySnapshot(): Snapshot {
  return { subjects: subjectCatalog, children: [], courses: [], videos: [], watchProgress: [], watchEvents: [], favorites: [], uploadTasks: [] };
}

function RemoteAppStoreProvider({ children: content }: { children: ReactNode }) {
  const client = useQueryClient();
  const auth = useAuthOptional();
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const apiEnabled = !auth || auth.status === 'authenticated';
  const activeChildId = auth?.session?.authenticated ? auth.session.activeChildId : null;
  const childrenQuery = useQuery({
    queryKey: ['parent', 'children'],
    queryFn: () => apiRequest<ChildApi[]>('/api/children'),
    enabled: apiEnabled,
  });
  const coursesQuery = useQuery({
    queryKey: ['parent', 'courses'],
    queryFn: () => apiRequest<CourseApi[]>('/api/courses'),
    enabled: apiEnabled,
  });
  const childCoursesQuery = useQuery({
    queryKey: ['child', activeChildId, 'courses'],
    queryFn: () => apiRequest<CourseApi[]>('/api/child/courses'),
    enabled: Boolean(activeChildId) && apiEnabled,
  });
  const overviewQuery = useQuery({
    queryKey: ['parent', 'overview'],
    queryFn: () => apiRequest<OverviewData>('/api/overview'),
    enabled: apiEnabled,
  });
  const recentRecordsQuery = useQuery({
    queryKey: ['parent', 'records', 'summary'],
    queryFn: () => apiRequest<RecordApi>('/api/records?limit=100'),
    enabled: apiEnabled,
  });
  const favoritesQuery = useQuery({
    queryKey: ['child', activeChildId, 'favorites'],
    queryFn: () => apiRequest<Array<{ id: string; childId: string; videoId: string; createdAt: string; video?: { course?: { id: string } | null } }>>(`/api/children/${encodeURIComponent(activeChildId!)}/favorites`),
    enabled: Boolean(activeChildId) && apiEnabled,
  });
  const children = (childrenQuery.data ?? []).map(mapChild);
  const courses = (coursesQuery.data ?? []).map(mapCourse);
  const videos = (coursesQuery.data ?? []).flatMap((course) => course.videos.map(mapVideo));
  const childCourses = (childCoursesQuery.data ?? []).map(mapChildCourse);
  const childVideos = (childCoursesQuery.data ?? []).flatMap((course) => course.videos.map((video) => mapVideoWithCourse(video, course.id)));
  const watchEvents: WatchEvent[] = (recentRecordsQuery.data?.items ?? []).map((event) => ({
    id: event.id,
    childId: event.childId,
    videoId: event.videoId,
    effectiveWatchSeconds: event.effectiveWatchSeconds,
    occurredAt: event.occurredAt,
  }));
  const progressByKey = new Map<string, WatchProgress>();
  const watchSecondsByKey = new Map<string, number>();
  for (const event of recentRecordsQuery.data?.items ?? []) {
    const key = `${event.childId}:${event.videoId}`;
    watchSecondsByKey.set(key, (watchSecondsByKey.get(key) ?? 0) + event.effectiveWatchSeconds);
  }
  for (const event of recentRecordsQuery.data?.items ?? []) {
    if (event.progress && !progressByKey.has(`${event.childId}:${event.videoId}`)) {
      progressByKey.set(`${event.childId}:${event.videoId}`, {
        childId: event.childId,
        videoId: event.videoId,
        lastPositionSeconds: event.progress.positionMs / 1000,
        maxProgress: event.progress.maxProgressPercent / 100,
        completed: event.progress.completed,
        totalWatchSeconds: watchSecondsByKey.get(`${event.childId}:${event.videoId}`) ?? 0,
        updatedAt: event.occurredAt,
      });
    }
  }
  for (const item of overviewQuery.data?.continueLearning ?? []) {
    if (!progressByKey.has(`${item.childId}:${item.videoId}`)) {
      progressByKey.set(`${item.childId}:${item.videoId}`, {
        childId: item.childId,
        videoId: item.videoId,
        lastPositionSeconds: item.positionMs / 1000,
        maxProgress: item.maxProgressPercent / 100,
        completed: false,
        totalWatchSeconds: watchSecondsByKey.get(`${item.childId}:${item.videoId}`) ?? 0,
        updatedAt: item.updatedAt,
      });
    }
  }
  const snapshot: Snapshot = {
    ...emptySnapshot(),
    children,
    courses,
    videos,
    watchEvents,
    watchProgress: [...progressByKey.values()],
    favorites: (favoritesQuery.data ?? []).map((favorite) => ({
      id: favorite.id, childId: favorite.childId, videoId: favorite.videoId,
      courseId: favorite.video?.course?.id, createdAt: favorite.createdAt,
    })),
    uploadTasks,
  };
  const loadingQueries = [childrenQuery, coursesQuery, overviewQuery, recentRecordsQuery, ...(activeChildId ? [childCoursesQuery] : [])];
  const errorValue = loadingQueries.find((item) => item.error)?.error ?? favoritesQuery.error;
  const invalidate = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['parent'] }),
      client.invalidateQueries({ queryKey: ['child'] }),
    ]);
  };
  const invalidateProgress = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['parent', 'overview'] }),
      client.invalidateQueries({ queryKey: ['parent', 'records'] }),
    ]);
  };
  const currentChild = children.find((child) => child.id === activeChildId);
  const setCurrentChild = async (id: string | null) => {
    if (id) await auth?.setActiveChild(id);
  };

  const createCourse = async (input: CourseInput) => {
    const course = await apiRequest<CourseApi>('/api/courses', {
      method: 'POST',
      body: JSON.stringify({ title: input.title, subjectId: input.subjectId, description: input.description ?? '', ageRange: input.ageRange ?? '', coverStyle: input.cover?.style ?? 'sunrise' }),
    });
    await invalidate();
    return mapCourse(course);
  };
  const updateCourse = async (id: string, input: Partial<CourseInput>) => {
    const body: Record<string, unknown> = {};
    if (input.title !== undefined) body.title = input.title;
    if (input.subjectId !== undefined) body.subjectId = input.subjectId;
    if (input.description !== undefined) body.description = input.description;
    if (input.ageRange !== undefined) body.ageRange = input.ageRange;
    if (input.cover !== undefined) body.coverStyle = input.cover.style;
    if (input.videoIds !== undefined) body.videoIds = input.videoIds;
    const course = await apiRequest<CourseApi>(`/api/courses/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
    await invalidate();
    return mapCourse(course);
  };
  const publishCourse = async (id: string): Promise<PublishResult> => {
    try {
      await apiRequest(`/api/courses/${encodeURIComponent(id)}/publish`, { method: 'POST' });
      await invalidate();
      return { ok: true };
    } catch (cause) {
      if (cause instanceof ApiError) return { ok: false, reason: cause.message };
      throw cause;
    }
  };
  const offlineCourse = async (id: string) => {
    const course = await apiRequest<CourseApi>(`/api/courses/${encodeURIComponent(id)}/unpublish`, { method: 'POST' });
    await invalidate();
    return mapCourse(course);
  };
  const updateVideo = async (id: string, input: Partial<VideoInput>) => {
    if (!input.title) return undefined;
    const video = await apiRequest<{ id: string; courseId: string; title: string; fileName: string; durationMs: number | null; status: string; sortOrder: number; createdAt: string }>(`/api/videos/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ title: input.title }) });
    await invalidate();
    return mapVideo(video);
  };
  const restoreVideo = async (id: string) => {
    const video = await apiRequest<CourseApi['videos'][number]>(`/api/videos/${encodeURIComponent(id)}/restore`, { method: 'POST' });
    await invalidate();
    return mapVideo(video);
  };
  const createChild = async (input: ChildInput) => {
    const child = await apiRequest<ChildApi>('/api/children', { method: 'POST', body: JSON.stringify(input) });
    await invalidate();
    return mapChild(child);
  };
  const updateChild = async (id: string, input: ChildUpdate) => {
    if (input.status === ChildStatus.INACTIVE) return await deactivateChild(id);
    if (input.status === ChildStatus.ACTIVE) {
      await apiRequest(`/api/children/${encodeURIComponent(id)}/activate`, { method: 'POST' });
      const child = await apiRequest<ChildApi>(`/api/children/${encodeURIComponent(id)}/activate`, { method: 'POST' });
      await invalidate();
      return mapChild(child);
    }
    const child = await apiRequest<ChildApi>(`/api/children/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
    await invalidate();
    return mapChild(child);
  };
  const deactivateChild = async (id: string) => {
    const child = await apiRequest<ChildApi>(`/api/children/${encodeURIComponent(id)}/deactivate`, { method: 'POST' });
    await invalidate();
    return mapChild(child);
  };
  const saveWatchProgress = async (input: ProgressInput) => {
    if (!activeChildId || input.childId !== activeChildId) throw new Error('当前孩子与进度写入孩子不一致');
    const response = await apiRequest<{ progress: { childId: string; videoId: string; positionMs: number; maxProgressPercent: number; completed: boolean; updatedAt: string } }>(
      `/api/children/${encodeURIComponent(activeChildId)}/videos/${encodeURIComponent(input.videoId)}/progress`,
      { method: 'PUT', body: JSON.stringify({ positionMs: Math.round(input.lastPositionSeconds * 1000), isPlaying: input.isPlaying, watchedSeconds: input.deltaWatchSeconds, eventType: input.eventType ?? (input.isPlaying ? 'PROGRESS' : 'PAUSE') }) },
    );
    await invalidateProgress();
    return {
      childId: response.progress.childId,
      videoId: response.progress.videoId,
      lastPositionSeconds: response.progress.positionMs / 1000,
      maxProgress: response.progress.maxProgressPercent / 100,
      completed: response.progress.completed,
      totalWatchSeconds: 0,
      updatedAt: response.progress.updatedAt,
    };
  };
  const toggleFavorite = async (input: { courseId?: string; videoId?: string }) => {
    if (!activeChildId || !input.videoId) return undefined;
    const existing = snapshot.favorites.find((item) => item.videoId === input.videoId && item.childId === activeChildId);
    if (existing) await apiRequest(`/api/children/${encodeURIComponent(activeChildId)}/favorites`, { method: 'DELETE', body: JSON.stringify({ videoId: input.videoId }) });
    else await apiRequest(`/api/children/${encodeURIComponent(activeChildId)}/favorites`, { method: 'PUT', body: JSON.stringify({ videoId: input.videoId }) });
    await invalidate();
    return existing;
  };
  const createUploadTask = (input: UploadTaskInput) => {
    const task: UploadTask = { id: newId('upload'), ...input, progress: 0, status: 'QUEUED' };
    setUploadTasks((current) => [...current, task]);
    return task;
  };
  const updateUploadTask = (id: string, input: Partial<UploadTask>) => {
    let updated: UploadTask | undefined;
    setUploadTasks((current) => current.map((task) => {
      if (task.id !== id) return task;
      updated = { ...task, ...input, progress: normalizeUploadProgress(input.progress, task.progress) };
      return updated;
    }));
    return updated;
  };
  const retry = async () => { await Promise.all(loadingQueries.map((item) => item.refetch())); };
  const value = useMemo<AppStoreValue>(() => ({
    snapshot,
    currentChildId: activeChildId,
    currentChild,
    setCurrentChild,
    selectChild: setCurrentChild,
    subjects: snapshot.subjects,
    children,
    courses,
    videos,
    childCourses,
    childVideos,
    progress: activeChildId ? snapshot.watchProgress.filter((item) => item.childId === activeChildId) : [],
    watchEvents: activeChildId ? snapshot.watchEvents.filter((item) => item.childId === activeChildId) : snapshot.watchEvents,
    favorites: activeChildId ? snapshot.favorites.filter((item) => item.childId === activeChildId) : [],
    uploadTasks,
    isLoading: loadingQueries.some((item) => item.isLoading),
    isRemote: true,
    error: errorValue instanceof Error ? errorValue.message : null,
    retry,
    overview: overviewQuery.data ?? null,
    createCourse,
    updateCourse,
    publishCourse,
    offlineCourse,
    addVideo: async () => { throw new Error('请通过视频上传页面添加真实视频'); },
    updateVideo,
    removeVideo: async (id) => { await apiRequest(`/api/videos/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ confirmHistoryDeletion: true }) }); await invalidate(); },
    restoreVideo,
    createChild,
    updateChild,
    deactivateChild,
    saveWatchProgress,
    toggleFavorite,
    createUploadTask,
    updateUploadTask,
    completeUploadTask: async () => undefined,
    resetSnapshot: async () => { throw new Error('服务端真实家庭数据不能通过本地重置'); },
  }), [snapshot, activeChildId, currentChild, setCurrentChild, children, courses, videos, childCourses, childVideos, uploadTasks, loadingQueries, errorValue, retry, overviewQuery.data, createCourse, updateCourse, publishCourse, offlineCourse, updateVideo, restoreVideo, createChild, updateChild, deactivateChild, saveWatchProgress, toggleFavorite]);
  return <AppStoreContext.Provider value={value}>{content}</AppStoreContext.Provider>;
}

export function AppStoreProvider({ children, initialSnapshot }: { children: ReactNode; initialSnapshot?: Snapshot }) {
  return <QueryClientProvider client={queryClient}>
    {initialSnapshot
      ? <LocalAppStoreProvider initialSnapshot={initialSnapshot}>{children}</LocalAppStoreProvider>
      : <RemoteAppStoreProvider>{children}</RemoteAppStoreProvider>}
  </QueryClientProvider>;
}

export function useAppStore(): AppStoreValue {
  const value = useContext(AppStoreContext);
  if (!value) throw new Error('useAppStore must be used within AppStoreProvider');
  return value;
}
