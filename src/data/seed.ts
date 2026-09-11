import {
  ChildStatus,
  CourseStatus,
  type Snapshot,
  VideoStatus,
} from '../types/domain';

export const seedSnapshot: Snapshot = {
  subjects: [
    { id: 'english', name: '英语', color: '#FF6C66', icon: 'Aa' },
    { id: 'chinese', name: '语文', color: '#2D86F5', icon: '文' },
    { id: 'math', name: '数学', color: '#FFBD3F', icon: '123' },
    { id: 'science', name: '科普', color: '#7F6CF4', icon: '☆' },
  ],
  children: [
    { id: 'child-gege', name: '哥哥', avatar: '🚀', grade: '小学二年级', status: ChildStatus.ACTIVE, createdAt: '2026-08-20T09:00:00.000Z' },
    { id: 'child-meimei', name: '妹妹', avatar: '🌈', grade: '幼儿园中班', status: ChildStatus.ACTIVE, createdAt: '2026-08-21T09:00:00.000Z' },
  ],
  courses: [
    { id: 'course-chinese', title: '小小诗人：古诗启蒙', subjectId: 'chinese', description: '用故事和韵律认识经典古诗。', ageRange: '6-8岁', cover: { style: 'mountain', colors: ['#2D86F5', '#9ED8FF'] }, status: CourseStatus.PUBLISHED, videoIds: ['video-chinese-1', 'video-chinese-2', 'video-chinese-3'], createdAt: '2026-08-25T09:00:00.000Z', updatedAt: '2026-09-10T09:00:00.000Z' },
    { id: 'course-space', title: '奇妙太空探索', subjectId: 'science', description: '一起认识太阳系里的奇妙邻居。', ageRange: '5-9岁', cover: { style: 'planet', colors: ['#7F6CF4', '#C4BFFF'] }, status: CourseStatus.PUBLISHED, videoIds: ['video-space-1', 'video-space-2'], createdAt: '2026-08-28T09:00:00.000Z', updatedAt: '2026-09-09T09:00:00.000Z' },
    { id: 'course-english', title: '快乐英语小课堂', subjectId: 'english', description: '在儿歌中积累日常英语表达。', ageRange: '4-7岁', cover: { style: 'rainbow', colors: ['#FF6C66', '#FFD5D2'] }, status: CourseStatus.DRAFT, videoIds: ['video-english-1'], createdAt: '2026-09-01T09:00:00.000Z', updatedAt: '2026-09-08T09:00:00.000Z' },
  ],
  videos: [
    { id: 'video-chinese-1', courseId: 'course-chinese', title: '第1课 静夜思', fileName: '第1课-静夜思.mp4', durationSeconds: 285, status: VideoStatus.READY, orderIndex: 1, createdAt: '2026-08-25T10:00:00.000Z' },
    { id: 'video-chinese-2', courseId: 'course-chinese', title: '第2课 咏鹅', fileName: '第2课-咏鹅.mp4', durationSeconds: 310, status: VideoStatus.READY, orderIndex: 2, createdAt: '2026-08-25T10:00:00.000Z' },
    { id: 'video-chinese-3', courseId: 'course-chinese', title: '第10课 春晓', fileName: '第10课-春晓.mp4', durationSeconds: 295, status: VideoStatus.READY, orderIndex: 10, createdAt: '2026-08-25T10:00:00.000Z' },
    { id: 'video-space-1', courseId: 'course-space', title: '认识太阳', fileName: '01-认识太阳.mp4', durationSeconds: 360, status: VideoStatus.READY, orderIndex: 1, createdAt: '2026-08-28T10:00:00.000Z' },
    { id: 'video-space-2', courseId: 'course-space', title: '月亮的秘密', fileName: '02-月亮的秘密.mp4', durationSeconds: 330, status: VideoStatus.READY, orderIndex: 2, createdAt: '2026-08-28T10:00:00.000Z' },
    { id: 'video-english-1', courseId: 'course-english', title: 'Hello, Friends!', fileName: 'hello-friends.mp4', durationSeconds: 240, status: VideoStatus.UPLOADING, orderIndex: 1, createdAt: '2026-09-08T10:00:00.000Z' },
  ],
  watchProgress: [
    { childId: 'child-gege', videoId: 'video-chinese-1', lastPositionSeconds: 180, maxProgress: 0.63, completed: false, totalWatchSeconds: 180, updatedAt: '2026-09-11T09:10:00.000Z' },
    { childId: 'child-gege', videoId: 'video-space-1', lastPositionSeconds: 360, maxProgress: 1, completed: true, totalWatchSeconds: 360, updatedAt: '2026-09-09T10:10:00.000Z' },
  ],
  watchEvents: [
    { id: 'event-1', childId: 'child-gege', videoId: 'video-chinese-1', effectiveWatchSeconds: 180, occurredAt: '2026-09-11T09:10:00.000Z' },
    { id: 'event-2', childId: 'child-gege', videoId: 'video-space-1', effectiveWatchSeconds: 360, occurredAt: '2026-09-09T10:10:00.000Z' },
  ],
  favorites: [{ id: 'favorite-1', childId: 'child-gege', courseId: 'course-chinese', createdAt: '2026-09-10T12:00:00.000Z' }],
  uploadTasks: [],
};

export function createSeedSnapshot(): Snapshot {
  return JSON.parse(JSON.stringify(seedSnapshot)) as Snapshot;
}
