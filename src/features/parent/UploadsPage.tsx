import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ProgressBar } from '../../components/ProgressBar';
import { useAppStore } from '../../context/AppStore';
import { apiRequest, ApiError } from '../../lib/api-client';
import { naturalCompare } from '../../lib/domain';
import { uploadMultipartFile, putSignedUploadPart, type ExistingUploadPart, type PartUrlResult } from '../../lib/multipart-upload';

const UPLOAD_SESSIONS_STORAGE_KEY = 'family-learning:upload-sessions:v1';
const accepted = (file: File) => file.name.toLowerCase().endsWith('.mp4');
type UploadTask = {
  id: string;
  uploadId: string;
  courseId: string;
  fileName: string;
  sizeBytes: number;
  lastModified: number;
  partCount: number;
  partSizeBytes: number;
  progress: number;
  status: 'QUEUED' | 'UPLOADING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  canResume: boolean;
  error?: string;
  videoId?: string;
};
type UploadStatus = { uploadId: string; status: string; partCount: number; partSizeBytes: number; parts: ExistingUploadPart[] };
type SignedPart = PartUrlResult;
type QueuedUpload = { task: UploadTask; file: File; resolve: () => void };

function loadTasks(): UploadTask[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(UPLOAD_SESSIONS_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is UploadTask => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.uploadId === 'string' && typeof item.courseId === 'string' && typeof item.fileName === 'string' && typeof item.sizeBytes === 'number'))
      .map((task) => task.status === 'COMPLETED' || task.status === 'CANCELLED'
        ? task
        : { ...task, status: 'FAILED', canResume: true, error: '上传已暂停，请重新选择原文件以续传' });
  } catch { return []; }
}

const taskStatus: Record<UploadTask['status'], string> = { QUEUED: '排队中', UPLOADING: '上传中', COMPLETED: '已完成', CANCELLED: '已取消', FAILED: '需要处理' };
const sizeText = (bytes: number) => bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(2)} GB` : `${(bytes / 1_000_000).toFixed(1)} MB`;

export function UploadsPage() {
  const { courses, isRemote, retry: refreshServerData } = useAppStore();
  const queryClient = useQueryClient();
  const storageQuota = useQuery({
    queryKey: ['parent', 'storage'],
    enabled: isRemote,
    queryFn: () => apiRequest<{ availableBytes: string; totalBytes: string }>('/api/storage'),
  });
  const location = useLocation();
  const presetCourse = new URLSearchParams(location.search).get('course') ?? '';
  const [courseId, setCourseId] = useState(presetCourse);
  const [error, setError] = useState('');
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>(loadTasks);
  const inputRef = useRef<HTMLInputElement>(null);
  const taskRef = useRef(uploadTasks);
  const retryTaskIdRef = useRef<string>();
  const controllersRef = useRef(new Map<string, AbortController>());
  const queuedUploadsRef = useRef<QueuedUpload[]>([]);
  const activeUploadCountRef = useRef(0);
  const processQueueRef = useRef<() => void>(() => undefined);
  const lastPersistRef = useRef(0);
  taskRef.current = uploadTasks;

  const saveTasks = (tasks: UploadTask[], force = false) => {
    taskRef.current = tasks;
    setUploadTasks(tasks);
    const now = Date.now();
    if (!force && now - lastPersistRef.current < 300) return;
    try { window.localStorage.setItem(UPLOAD_SESSIONS_STORAGE_KEY, JSON.stringify(tasks)); lastPersistRef.current = now; }
    catch { setError('浏览器无法保存上传续传信息；请保持页面打开直到上传完成。'); }
  };
  const patchTask = (id: string, patch: Partial<UploadTask>, force = false) => {
    saveTasks(taskRef.current.map((task) => task.id === id ? { ...task, ...patch } : task), force);
  };

  useEffect(() => {
    let active = true;
    const restoreProgress = async () => {
      const pending = taskRef.current.filter((task) => task.status === 'FAILED' && task.canResume);
      await Promise.all(pending.map(async (task) => {
        try {
          const status = await apiRequest<UploadStatus>(`/api/uploads/${encodeURIComponent(task.uploadId)}`);
          if (!active) return;
          if (status.status === 'COMPLETED') {
            const course = await apiRequest<{ videos: Array<{ id: string; fileName: string; status: string }> }>(`/api/courses/${encodeURIComponent(task.courseId)}`);
            const video = course.videos.find((item) => item.fileName === task.fileName && item.status === 'READY');
            patchTask(task.id, video
              ? { status: 'COMPLETED', progress: 1, canResume: false, videoId: video.id, error: undefined }
              : { status: 'FAILED', canResume: false, error: 'MinIO 已收到文件，但视频校验没有通过；请检查课程中的失败条目。' }, true);
            await refreshServerData();
            return;
          }
          if (status.status !== 'ACTIVE') {
            patchTask(task.id, { canResume: false, error: '服务端上传会话已结束；请重新上传文件' }, true);
            return;
          }
          const uploadedBytes = status.parts.reduce((sum, part) => sum + part.size, 0);
          patchTask(task.id, { partCount: status.partCount, partSizeBytes: status.partSizeBytes, progress: Math.min(1, uploadedBytes / task.sizeBytes) }, true);
        } catch (cause) {
          if (!active) return;
          const message = cause instanceof Error ? cause.message : '无法恢复上传状态';
          patchTask(task.id, { canResume: false, error: `${message}；可重新选择文件发起上传` }, true);
        }
      }));
    };
    void restoreProgress();
    return () => {
      active = false;
      controllersRef.current.forEach((controller) => controller.abort());
      controllersRef.current.clear();
      queuedUploadsRef.current.splice(0).forEach((job) => job.resolve());
    };
  }, []);

  const createTask = async (file: File, selectedCourseId: string): Promise<UploadTask> => {
    const created = await apiRequest<{ uploadId: string; partCount: number; partSizeBytes: number }>(`/api/courses/${encodeURIComponent(selectedCourseId)}/uploads`, {
      method: 'POST', body: JSON.stringify({ fileName: file.name, sizeBytes: file.size }),
    });
    const task: UploadTask = {
      id: created.uploadId, uploadId: created.uploadId, courseId: selectedCourseId, fileName: file.name,
      sizeBytes: file.size, lastModified: file.lastModified, partCount: created.partCount,
      partSizeBytes: created.partSizeBytes, progress: 0, status: 'QUEUED', canResume: true,
    };
    saveTasks([...taskRef.current, task], true);
    await queryClient.invalidateQueries({ queryKey: ['parent', 'storage'] });
    return task;
  };

  const uploadTask = async (task: UploadTask, file: File) => {
    const controller = new AbortController();
    controllersRef.current.set(task.id, controller);
    patchTask(task.id, { status: 'UPLOADING', error: undefined }, true);
    try {
      const status = await apiRequest<UploadStatus>(`/api/uploads/${encodeURIComponent(task.uploadId)}`, { signal: controller.signal });
      if (status.status !== 'ACTIVE') throw new Error('服务端上传会话已结束，请重新上传该文件');
      await uploadMultipartFile(file, {
        partCount: status.partCount,
        partSizeBytes: status.partSizeBytes,
        existingParts: status.parts,
        signal: controller.signal,
        concurrency: 2,
        requestPartUrl: (partNumber) => apiRequest<SignedPart>(`/api/uploads/${encodeURIComponent(task.uploadId)}/parts/${partNumber}/url`, { method: 'POST' }),
        putPart: putSignedUploadPart,
        onProgress: (progress) => patchTask(task.id, { progress, status: 'UPLOADING' }),
      });
      const result = await apiRequest<{ status: string; video: { id: string } }>(`/api/uploads/${encodeURIComponent(task.uploadId)}/complete`, { method: 'POST' });
      if (result.status !== 'READY') throw new Error('上传接收成功，但视频校验未通过');
      patchTask(task.id, { progress: 1, status: 'COMPLETED', canResume: false, videoId: result.video.id, error: undefined }, true);
      await refreshServerData();
    } catch (cause) {
      if (controller.signal.aborted) return;
      const message = cause instanceof Error ? cause.message : '上传失败，请检查网络后重试';
      const terminal = cause instanceof ApiError && [409, 410, 413, 422].includes(cause.status);
      patchTask(task.id, { status: 'FAILED', canResume: !terminal, error: message }, true);
    } finally {
      if (controllersRef.current.get(task.id) === controller) controllersRef.current.delete(task.id);
    }
  };

  processQueueRef.current = () => {
    while (activeUploadCountRef.current < 2 && queuedUploadsRef.current.length) {
      const job = queuedUploadsRef.current.shift()!;
      if (taskRef.current.find((task) => task.id === job.task.id)?.status === 'CANCELLED') { job.resolve(); continue; }
      activeUploadCountRef.current += 1;
      void uploadTask(job.task, job.file).finally(() => {
        activeUploadCountRef.current -= 1;
        job.resolve();
        processQueueRef.current();
      });
    }
  };
  const startUpload = (task: UploadTask, file: File) => new Promise<void>((resolve) => {
    queuedUploadsRef.current.push({ task, file, resolve });
    processQueueRef.current();
  });

  const enqueue = async (incoming: FileList | File[], targetCourseId = courseId) => {
    if (!targetCourseId) { setError('请先选择所属课程'); return; }
    const files = Array.from(incoming);
    const invalid = files.filter((file) => !accepted(file) || file.size <= 0);
    const valid = files.filter((file) => accepted(file) && file.size > 0).sort((a, b) => naturalCompare(a.name, b.name));
    setError(invalid.length ? `${invalid.map((file) => `“${file.name}”`).join('、')}格式或文件大小无效，仅支持非空 MP4。` : '');
    for (const file of valid) {
      try { const task = await createTask(file, targetCourseId); void startUpload(task, file); }
      catch (cause) { setError(`${file.name}：${cause instanceof Error ? cause.message : '无法创建上传任务'}`); }
    }
  };

  const chooseRetryFile = (task: UploadTask) => { retryTaskIdRef.current = task.id; inputRef.current?.click(); };
  const onFilesSelected = (files: FileList | null) => {
    if (!files?.length) return;
    const existingId = retryTaskIdRef.current;
    retryTaskIdRef.current = undefined;
    if (!existingId) { void enqueue(files); return; }
    const original = taskRef.current.find((task) => task.id === existingId);
    const file = Array.from(files).find((item) => item.name === original?.fileName && item.size === original.sizeBytes);
    if (!original || !file) { setError('所选文件与原上传文件名称或大小不匹配。'); return; }
    if (original.canResume) void startUpload(original, file);
    else void enqueue([file], original.courseId);
  };

  const cancel = async (task: UploadTask) => {
    const queuedIndex = queuedUploadsRef.current.findIndex((job) => job.task.id === task.id);
    if (queuedIndex >= 0) queuedUploadsRef.current.splice(queuedIndex, 1)[0].resolve();
    controllersRef.current.get(task.id)?.abort();
    try {
      await apiRequest(`/api/uploads/${encodeURIComponent(task.uploadId)}/cancel`, { method: 'POST' });
      patchTask(task.id, { status: 'CANCELLED', canResume: false, error: undefined }, true);
    } catch (cause) {
      patchTask(task.id, { status: 'FAILED', error: cause instanceof Error ? cause.message : '取消失败，请重试' }, true);
    }
  };

  const openFilePicker = () => { retryTaskIdRef.current = undefined; inputRef.current?.click(); };
  const handleDropZoneKeyDown = (event: KeyboardEvent<HTMLElement>) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openFilePicker(); } };
  const eligibleCourses = courses.filter((course) => course.status !== 'PUBLISHED');

  return <div className="parent-page">
    <div className="page-heading"><div><p className="eyebrow">媒体内容</p><h1>视频上传</h1><p className="page-subtitle">视频分片直传 MinIO，支持断点续传；刷新后重新选择原文件即可继续。</p></div><Link to="/parent/courses" className="button">返回课程管理</Link></div>
    <div className="upload-layout">
      <section className="upload-drop panel" role="button" tabIndex={0} aria-label="选择视频文件" onKeyDown={handleDropZoneKeyDown} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void enqueue(event.dataTransfer.files); }} onClick={openFilePicker}>
        <div className="upload-orbit">↑</div><h2>拖拽 MP4 视频到这里</h2><p>或点击选择文件，支持一次选择多个视频</p><small>仅支持 H.264 / AAC MP4；单文件不超过可用存储容量</small>
        <input ref={inputRef} type="file" accept=".mp4,video/mp4" multiple hidden onClick={(event) => event.stopPropagation()} onChange={(event) => { onFilesSelected(event.target.files); event.target.value = ''; }} />
      </section>
      <section className="panel upload-settings"><div className="panel-heading"><div><h2>上传设置</h2><p>只能向草稿或已下架课程添加视频。</p></div></div><label>所属课程<select aria-label="所属课程" value={courseId} onChange={(event) => setCourseId(event.target.value)}><option value="">请选择课程</option>{eligibleCourses.map((course) => <option value={course.id} key={course.id}>{course.title}</option>)}</select></label><p className="muted-copy">MinIO 容量：{storageQuota.data ? `${sizeText(Number(storageQuota.data.availableBytes))} 可用 / ${sizeText(Number(storageQuota.data.totalBytes))}` : storageQuota.isLoading ? '读取中…' : '由服务器限制为 100 GB'}</p>{storageQuota.error && <p className="form-error" role="alert">无法读取当前剩余容量；服务端仍会在创建上传时检查容量。</p>}{error && <p className="form-error" role="alert">{error}</p>}</section>
    </div>
    {uploadTasks.length > 0 && <section className="panel upload-queue"><div className="panel-heading"><div><h2>上传队列</h2><p>{uploadTasks.filter((task) => task.status === 'COMPLETED').length} / {uploadTasks.length} 个文件已完成</p></div></div><div className="task-list">{[...uploadTasks].sort((a, b) => naturalCompare(a.fileName, b.fileName)).map((task) => <div className="upload-task" key={task.id}><div className="task-file"><span className="file-mark">▣</span><div><strong>{task.fileName}</strong><small>{sizeText(task.sizeBytes)} · {taskStatus[task.status]}{task.error ? ` · ${task.error}` : ''}</small></div></div><ProgressBar value={task.progress} label={`${task.fileName} 上传进度`} /><span className={`status-badge task-status task-${task.status.toLowerCase()}`}>{taskStatus[task.status]}</span><div className="task-actions">{task.status === 'FAILED' && <button type="button" onClick={() => chooseRetryFile(task)}>{task.canResume ? '选择文件续传' : '重新上传'}</button>}{(task.status === 'QUEUED' || task.status === 'UPLOADING' || task.status === 'FAILED' && task.canResume) && <button type="button" onClick={() => void cancel(task)}>取消</button>}</div></div>)}</div></section>}
  </div>;
}
