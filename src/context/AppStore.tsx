import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { addWatchEvent, canPublishCourse, createProgressUpdate, type PublishResult } from '../lib/domain';
import { loadSnapshot, persistSnapshot, resetStorage } from '../lib/storage';
import { ChildStatus, CourseStatus, VideoStatus, type Child, type Course, type Favorite, type Snapshot, type UploadTask, type Video, type WatchEvent, type WatchProgress } from '../types/domain';

type CourseInput = Partial<Pick<Course, 'description' | 'ageRange' | 'cover' | 'videoIds'>> & Pick<Course, 'title' | 'subjectId'>;
type VideoInput = Pick<Video, 'title' | 'fileName' | 'durationSeconds'> & Partial<Pick<Video, 'status' | 'orderIndex'>>;
type ProgressInput = Pick<WatchProgress, 'childId' | 'videoId' | 'lastPositionSeconds'> & { progress: number; deltaWatchSeconds: number; isPlaying: boolean; updatedAt?: string };
type ChildInput = Pick<Child, 'name' | 'avatar' | 'grade'>;
type ChildUpdate = Partial<ChildInput> & Partial<Pick<Child, 'status'>>;
type UploadTaskInput = Pick<UploadTask, 'courseId' | 'fileName'>;
type UploadVideoInput = Pick<Video, 'title' | 'durationSeconds'>;

export interface AppStoreValue {
  snapshot: Snapshot;
  currentChildId: string | null;
  currentChild: Child | undefined;
  setCurrentChild: (id: string | null) => void;
  selectChild: (id: string | null) => void;
  subjects: Snapshot['subjects'];
  children: Child[];
  courses: Course[];
  videos: Video[];
  progress: WatchProgress[];
  watchEvents: WatchEvent[];
  favorites: Favorite[];
  uploadTasks: UploadTask[];
  createCourse: (input: CourseInput) => Course;
  updateCourse: (id: string, input: Partial<CourseInput>) => Course | undefined;
  publishCourse: (id: string) => PublishResult;
  offlineCourse: (id: string) => Course | undefined;
  addVideo: (courseId: string, input: VideoInput) => Video;
  updateVideo: (id: string, input: Partial<VideoInput>) => Video | undefined;
  removeVideo: (id: string) => void;
  createChild: (input: ChildInput) => Child;
  updateChild: (id: string, input: ChildUpdate) => Child | undefined;
  deactivateChild: (id: string) => Child | undefined;
  saveWatchProgress: (input: ProgressInput) => WatchProgress;
  toggleFavorite: (input: { courseId?: string; videoId?: string }) => Favorite | undefined;
  createUploadTask: (input: UploadTaskInput) => UploadTask;
  updateUploadTask: (id: string, input: Partial<UploadTask>) => UploadTask | undefined;
  completeUploadTask: (id: string, input: UploadVideoInput) => Video | undefined;
  resetSnapshot: (snapshot?: Snapshot) => void;
}

const AppStoreContext = createContext<AppStoreValue | undefined>(undefined);
let idCounter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now()}-${idCounter++}`;
const now = () => new Date().toISOString();

export function AppStoreProvider({ children, initialSnapshot }: { children: ReactNode; initialSnapshot?: Snapshot }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => initialSnapshot ? structuredClone(initialSnapshot) : loadSnapshot());
  const snapshotRef = useRef(snapshot);
  const [currentChildId, setCurrentChildId] = useState<string | null>(() => snapshot.children.find((child) => child.status === ChildStatus.ACTIVE)?.id ?? null);

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
    const updateCourse = (id: string, input: Partial<CourseInput>) => { const course = snapshotRef.current.courses.find((item) => item.id === id); if (!course) return undefined; const next = { ...course, ...input, updatedAt: now() }; update((draft) => { const index = draft.courses.findIndex((item) => item.id === id); draft.courses[index] = next; }); return next; };
    const publishCourse = (id: string): PublishResult => { const current = snapshotRef.current; const course = current.courses.find((item) => item.id === id); if (!course) return { ok: false, reason: '课程不存在' }; const result = canPublishCourse(course, current.videos); if (!result.ok) return result; update((draft) => { const target = draft.courses.find((item) => item.id === id); if (target) { target.status = CourseStatus.PUBLISHED; target.updatedAt = now(); } }); return { ok: true }; };
    const offlineCourse = (id: string) => { const course = snapshotRef.current.courses.find((item) => item.id === id); if (!course) return undefined; const next = { ...course, status: CourseStatus.OFFLINE, updatedAt: now() }; update((draft) => { const target = draft.courses.find((item) => item.id === id); if (target) Object.assign(target, next); }); return next; };
    const addVideo = (courseId: string, input: VideoInput) => { const orderIndex = Math.max(0, ...snapshotRef.current.videos.filter((video) => video.courseId === courseId).map((video) => video.orderIndex)) + 1; const video: Video = { id: newId('video'), courseId, title: input.title, fileName: input.fileName, durationSeconds: input.durationSeconds, status: input.status ?? VideoStatus.READY, orderIndex, createdAt: now() }; update((draft) => { draft.videos.push(video); const course = draft.courses.find((item) => item.id === courseId); if (course) course.videoIds.push(video.id); }); return video; };
    const updateVideo = (id: string, input: Partial<VideoInput>) => { const video = snapshotRef.current.videos.find((item) => item.id === id); if (!video) return undefined; const next = { ...video, ...input }; update((draft) => { const index = draft.videos.findIndex((item) => item.id === id); draft.videos[index] = next; }); return next; };
    const removeVideo = (id: string) => update((draft) => { draft.videos = draft.videos.filter((video) => video.id !== id); draft.courses.forEach((course) => { course.videoIds = course.videoIds.filter((videoId) => videoId !== id); }); });
    const createChild = (input: ChildInput) => { const child: Child = { ...input, id: newId('child'), status: ChildStatus.ACTIVE, createdAt: now() }; update((draft) => draft.children.push(child)); return child; };
    const updateChild = (id: string, input: ChildUpdate) => { const child = snapshotRef.current.children.find((item) => item.id === id); if (!child) return undefined; const next = { ...child, ...input }; update((draft) => { const index = draft.children.findIndex((item) => item.id === id); draft.children[index] = next; }); return next; };
    const deactivateChild = (id: string) => { const child = snapshotRef.current.children.find((item) => item.id === id); if (!child) return undefined; const next = { ...child, status: ChildStatus.INACTIVE }; update((draft) => { const target = draft.children.find((item) => item.id === id); if (target) target.status = ChildStatus.INACTIVE; }); if (currentChildId === id) setCurrentChildId(null); return next; };
    const saveWatchProgress = (input: ProgressInput) => {
      if (!currentChildId) throw new Error('当前孩子未选择，不能保存学习进度');
      if (input.childId !== currentChildId) throw new Error('当前孩子与进度写入孩子不一致');
      const previous = snapshotRef.current.watchProgress.find((item) => item.childId === input.childId && item.videoId === input.videoId);
      const nextProgress = createProgressUpdate(previous, input);
      update((draft) => {
        const index = draft.watchProgress.findIndex((item) => item.childId === input.childId && item.videoId === input.videoId);
        if (index === -1) draft.watchProgress.push(nextProgress); else draft.watchProgress[index] = nextProgress;
        draft.watchEvents = addWatchEvent(draft.watchEvents, { childId: input.childId, videoId: input.videoId, isPlaying: input.isPlaying, deltaWatchSeconds: input.deltaWatchSeconds, positionSeconds: input.lastPositionSeconds, occurredAt: input.updatedAt });
      });
      return nextProgress;
    };
    const toggleFavorite = (input: { courseId?: string; videoId?: string }) => { if (!currentChildId || (!input.courseId && !input.videoId)) return undefined; const existing = snapshotRef.current.favorites.find((item) => item.childId === currentChildId && item.courseId === input.courseId && item.videoId === input.videoId); if (existing) { update((draft) => { draft.favorites = draft.favorites.filter((item) => item.id !== existing.id); }); return undefined; } const favorite: Favorite = { id: newId('favorite'), childId: currentChildId, ...input, createdAt: now() }; update((draft) => draft.favorites.push(favorite)); return favorite; };
    const createUploadTask = (input: UploadTaskInput) => { const task: UploadTask = { id: newId('upload'), courseId: input.courseId, fileName: input.fileName, progress: 0, status: 'QUEUED' }; update((draft) => draft.uploadTasks.push(task)); return task; };
    const updateUploadTask = (id: string, input: Partial<UploadTask>) => { const task = snapshotRef.current.uploadTasks.find((item) => item.id === id); if (!task) return undefined; const next = { ...task, ...input }; update((draft) => { const index = draft.uploadTasks.findIndex((item) => item.id === id); draft.uploadTasks[index] = next; }); return next; };
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
    return { snapshot, currentChildId, currentChild: snapshot.children.find((child) => child.id === currentChildId), setCurrentChild, selectChild: setCurrentChild, subjects: snapshot.subjects, children: snapshot.children, courses: snapshot.courses, videos: snapshot.videos, progress: scopedProgress, watchEvents: scopedEvents, favorites: currentChildId ? snapshot.favorites.filter((item) => item.childId === currentChildId) : [], uploadTasks: snapshot.uploadTasks, createCourse, updateCourse, publishCourse, offlineCourse, addVideo, updateVideo, removeVideo, createChild, updateChild, deactivateChild, saveWatchProgress, toggleFavorite, createUploadTask, updateUploadTask, completeUploadTask, resetSnapshot: resetSnapshotCommand };
  }, [snapshot, currentChildId]);

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore(): AppStoreValue {
  const value = useContext(AppStoreContext);
  if (!value) throw new Error('useAppStore must be used within AppStoreProvider');
  return value;
}
