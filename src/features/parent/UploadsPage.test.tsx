import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { AppStoreProvider } from '../../context/AppStore';
import { AuthProvider, type AuthSession } from '../../context/AuthProvider';
import { createSeedSnapshot } from '../../data/seed';
import { ApiError } from '../../lib/api-client';
import { uploadFailureMessage } from './UploadsPage';

vi.mock('../../lib/multipart-upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/multipart-upload')>();
  return {
    ...actual,
    putSignedUploadPart: vi.fn(async (_url: string, body: Blob, onProgress: (loadedBytes: number) => void) => { onProgress(body.size); }),
  };
});

const session: AuthSession = { authenticated: true, admin: { id: 'parent-1', email: 'parent@example.test' }, activeChildId: null, activeChild: null, csrfToken: 'csrf-test' };
const uploadKey = 'family-learning:upload-sessions:v1';
const uploadId = 'upload-session-1';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function installUploadApi(options: { parts?: Array<{ partNumber: number; size: number }> } = {}) {
  const requests: Array<{ path: string; method: string; body: unknown }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown;
    if (typeof init?.body === 'string') { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    requests.push({ path: url.pathname, method, body });
    if (url.pathname === '/api/courses/course-english/uploads' && method === 'POST') return json({ uploadId, partCount: 1, partSizeBytes: 16 * 1024 * 1024 }, 201);
    if (url.pathname === `/api/uploads/${uploadId}` && method === 'GET') return json({ uploadId, status: 'ACTIVE', partCount: 1, partSizeBytes: 16 * 1024 * 1024, parts: options.parts ?? [] });
    if (url.pathname === `/api/uploads/${uploadId}/parts/1/url`) return json({ alreadyUploaded: false, partNumber: 1, url: 'https://minio.test/signed-part' });
    if (url.pathname === `/api/uploads/${uploadId}/complete`) return json({ status: 'READY', video: { id: 'video-uploaded-1' } });
    if (url.pathname === `/api/uploads/${uploadId}/cancel`) return new Response(null, { status: 204 });
    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404);
  }));
  return requests;
}

function renderUploads() {
  window.history.pushState({}, '', '/parent/uploads');
  return render(<AuthProvider initialSession={session}><AppStoreProvider initialSnapshot={createSeedSnapshot()}><App /></AppStoreProvider></AuthProvider>);
}

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
  window.localStorage.removeItem(uploadKey);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('real MinIO upload page', () => {
  it('translates server media validation failures into actionable Chinese guidance', () => {
    expect(uploadFailureMessage(new ApiError(422, 'MEDIA_VALIDATION_FAILED', 'The video must use H.264 encoding'))).toContain('视频编码需要是 H.264');
    expect(uploadFailureMessage(new ApiError(422, 'MEDIA_VALIDATION_FAILED', 'The audio must use AAC encoding'))).toContain('音频编码需要是 AAC');
    expect(uploadFailureMessage(new ApiError(422, 'MEDIA_VALIDATION_FAILED', 'The uploaded media could not be read'))).toContain('无法读取视频内容');
  });

  it('creates a server upload, sends each part, and confirms the validated video', async () => {
    const requests = installUploadApi();
    renderUploads();
    expect(screen.getByRole('option', { name: '小小诗人：古诗启蒙' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('所属课程'), { target: { value: 'course-english' } });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const valid = new File(['mp4-data'], '第3课.mp4', { type: 'video/mp4' });
    const invalid = new File(['notes'], '说明.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [valid, invalid] } });

    const row = (await screen.findByText('第3课.mp4')).closest('.upload-task') as HTMLElement;
    await waitFor(() => expect(within(row).getByText('已完成')).toBeInTheDocument());
    expect(within(row).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(within(row).getByRole('button', { name: '删除视频' })).toBeInTheDocument();
    expect(screen.getByText(/说明\.txt.*仅支持常见视频格式/)).toBeInTheDocument();
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/api/courses/course-english/uploads', method: 'POST', body: { fileName: '第3课.mp4', sizeBytes: valid.size } }),
      expect.objectContaining({ path: `/api/uploads/${uploadId}/parts/1/url`, method: 'POST' }),
      expect.objectContaining({ path: `/api/uploads/${uploadId}/complete`, method: 'POST' }),
    ]));
    const stored = JSON.parse(window.localStorage.getItem(uploadKey) ?? '[]');
    expect(stored[0]).toMatchObject({ uploadId, status: 'COMPLETED', videoId: 'video-uploaded-1' });
    expect(JSON.stringify(stored)).not.toContain('signed-part');
  });

  it('allows common source formats to be selected for background transcoding', async () => {
    const requests = installUploadApi();
    renderUploads();
    fireEvent.change(screen.getByLabelText('所属课程'), { target: { value: 'course-english' } });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    expect(input.accept).toContain('.mov');
    expect(input.accept).toContain('.mkv');
    fireEvent.change(input, { target: { files: [new File(['mov-data'], '课堂录像.mov', { type: 'video/quicktime' })] } });

    await waitFor(() => expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: '/api/courses/course-english/uploads',
        method: 'POST',
        body: { fileName: '课堂录像.mov', sizeBytes: 8 },
      }),
    ])));
  });

  it('reselects the source file and resumes from MinIO-confirmed parts after refresh', async () => {
    const requests = installUploadApi({ parts: [{ partNumber: 1, size: 4 }] });
    window.localStorage.setItem(uploadKey, JSON.stringify([{
      id: uploadId, uploadId, courseId: 'course-chinese', fileName: '原文件.mp4', sizeBytes: 4,
      lastModified: 10, partCount: 1, partSizeBytes: 16 * 1024 * 1024, progress: 0.5,
      status: 'UPLOADING', canResume: true,
    }]));
    renderUploads();

    const row = (await screen.findByText('原文件.mp4')).closest('.upload-task') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: '选择文件续传' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['data'], '原文件.mp4', { type: 'video/mp4', lastModified: 10 })] } });

    await waitFor(() => expect(within(row).getByText('已完成')).toBeInTheDocument());
    expect(requests.some((request) => request.path.endsWith('/parts/1/url'))).toBe(false);
    expect(requests.some((request) => request.path.endsWith('/complete'))).toBe(true);
  });
});
