import type { CourseStatus, VideoStatus } from '../types/domain';

export function StatusBadge({ status }: { status: CourseStatus | VideoStatus }) {
  const labels: Record<string, string> = { DRAFT: '草稿', PUBLISHED: '已发布', OFFLINE: '已下架', UPLOADING: '上传中', READY: '可播放', FAILED: '失败' };
  return <span className={`status-badge status-${status.toLowerCase()}`}>{labels[status] ?? status}</span>;
}
