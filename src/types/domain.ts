export type CourseStatus = 'DRAFT' | 'PUBLISHED' | 'OFFLINE';
export const CourseStatus = { DRAFT: 'DRAFT', PUBLISHED: 'PUBLISHED', OFFLINE: 'OFFLINE' } as const;

export type VideoStatus = 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED' | 'ARCHIVED';
export const VideoStatus = { UPLOADING: 'UPLOADING', PROCESSING: 'PROCESSING', READY: 'READY', FAILED: 'FAILED', ARCHIVED: 'ARCHIVED' } as const;

export type ChildStatus = 'ACTIVE' | 'INACTIVE';
export const ChildStatus = { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' } as const;

export type SubjectId = 'english' | 'chinese' | 'math' | 'science';

export interface Child {
  id: string;
  name: string;
  avatar: string;
  grade: string;
  status: ChildStatus;
  createdAt: string;
}

export interface Subject {
  id: SubjectId;
  name: string;
  color: string;
  icon: string;
}

export interface CourseCover {
  style: string;
  colors: string[];
}

export interface Course {
  id: string;
  title: string;
  subjectId: SubjectId;
  description: string;
  ageRange: string;
  cover: CourseCover;
  status: CourseStatus;
  videoIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Video {
  id: string;
  courseId: string;
  title: string;
  fileName: string;
  durationSeconds: number;
  status: VideoStatus;
  filesDeleted?: boolean;
  orderIndex: number;
  createdAt: string;
}

export interface WatchProgress {
  childId: string;
  videoId: string;
  lastPositionSeconds: number;
  maxProgress: number;
  completed: boolean;
  totalWatchSeconds: number;
  updatedAt: string;
}

export interface WatchEvent {
  id: string;
  childId: string;
  videoId: string;
  effectiveWatchSeconds: number;
  occurredAt: string;
}

export interface Favorite {
  id: string;
  childId: string;
  courseId?: string;
  videoId?: string;
  createdAt: string;
}

export interface UploadTask {
  id: string;
  courseId: string;
  fileName: string;
  progress: number;
  status: 'QUEUED' | 'UPLOADING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  error?: string;
  videoId?: string;
}

export interface Snapshot {
  subjects: Subject[];
  children: Child[];
  courses: Course[];
  videos: Video[];
  watchProgress: WatchProgress[];
  watchEvents: WatchEvent[];
  favorites: Favorite[];
  uploadTasks: UploadTask[];
}
