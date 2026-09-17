import { afterEach, describe, expect, it, vi } from 'vitest';
import { putSignedUploadPart, uploadMultipartFile } from './multipart-upload';

class FakeXhr {
  static latest: FakeXhr;
  static nextStatus = 200;
  static completeNextOnSend = true;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status: number;
  readonly open = vi.fn();
  readonly setRequestHeader = vi.fn();
  readonly abort = vi.fn(() => this.onabort?.());
  sentBody?: Document | XMLHttpRequestBodyInit | null;
  completeOnSend: boolean;

  constructor() { FakeXhr.latest = this; this.status = FakeXhr.nextStatus; this.completeOnSend = FakeXhr.completeNextOnSend; FakeXhr.nextStatus = 200; FakeXhr.completeNextOnSend = true; }
  send(body?: Document | XMLHttpRequestBodyInit | null) {
    this.sentBody = body;
    if (this.completeOnSend) {
      const size = body instanceof Blob ? body.size : 0;
      this.upload.onprogress?.({ lengthComputable: true, loaded: size } as ProgressEvent);
      this.onload?.();
    }
  }
}

afterEach(() => { vi.unstubAllGlobals(); FakeXhr.nextStatus = 200; FakeXhr.completeNextOnSend = true; });

describe('multipart upload client', () => {
  it('resumes confirmed parts and uploads the remaining slices with bounded concurrency', async () => {
    const file = new File(['abcdefghij'], 'lesson.mp4', { type: 'video/mp4' });
    const requestPartUrl = vi.fn(async (partNumber: number) => ({ alreadyUploaded: false as const, partNumber, url: `https://minio.test/part/${partNumber}` }));
    const uploaded: Array<{ url: string; bytes: number }> = [];
    let active = 0;
    let maximumActive = 0;
    const putPart = vi.fn(async (url: string, body: Blob, progress: (loaded: number) => void) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      progress(body.size);
      await Promise.resolve();
      uploaded.push({ url, bytes: body.size });
      active -= 1;
    });
    const progress: number[] = [];

    await uploadMultipartFile(file, {
      partCount: 4,
      partSizeBytes: 3,
      existingParts: [{ partNumber: 1, size: 3 }],
      requestPartUrl,
      putPart,
      onProgress: (value) => progress.push(value),
      concurrency: 2,
    });

    expect(requestPartUrl.mock.calls.map(([part]) => part)).toEqual([2, 3, 4]);
    expect(uploaded).toHaveLength(3);
    expect(uploaded.map((item) => item.bytes).sort((a, b) => a - b)).toEqual([1, 3, 3]);
    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(progress.at(-1)).toBe(1);
  });

  it('stops scheduling further parts after an upload failure', async () => {
    const file = new File(['abcdefghij'], 'lesson.mp4', { type: 'video/mp4' });
    const requestPartUrl = vi.fn(async (partNumber: number) => ({ alreadyUploaded: false as const, partNumber, url: `https://minio.test/part/${partNumber}` }));
    const putPart = vi.fn(async () => { throw new Error('connection lost'); });

    await expect(uploadMultipartFile(file, {
      partCount: 4,
      partSizeBytes: 3,
      existingParts: [],
      requestPartUrl,
      putPart,
      onProgress: () => undefined,
      concurrency: 1,
    })).rejects.toThrow('connection lost');
    expect(requestPartUrl).toHaveBeenCalledTimes(1);
  });

  it('streams byte progress and rejects failed signed PUT responses', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const payload = new Blob(['part-data']);
    const progress = vi.fn();
    await putSignedUploadPart('https://minio.test/signed', payload, progress);
    expect(FakeXhr.latest.open).toHaveBeenCalledWith('PUT', 'https://minio.test/signed');
    expect(FakeXhr.latest.setRequestHeader).toHaveBeenCalledWith('Content-Type', 'application/octet-stream');
    expect(FakeXhr.latest.sentBody).toBe(payload);
    expect(progress).toHaveBeenCalledWith(payload.size);

    FakeXhr.nextStatus = 403;
    await expect(putSignedUploadPart('https://minio.test/expired', payload, () => undefined)).rejects.toThrow('HTTP 403');
  });

  it('aborts an in-flight part request when its task is cancelled', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const controller = new AbortController();
    FakeXhr.completeNextOnSend = false;
    const request = putSignedUploadPart('https://minio.test/signed', new Blob(['part']), () => undefined, controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeXhr.latest.abort).toHaveBeenCalledOnce();
  });
});
