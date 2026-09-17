export type ExistingUploadPart = { partNumber: number; size: number };
export type PartUrlResult = { alreadyUploaded: true; partNumber: number } | { alreadyUploaded: false; partNumber: number; url: string };

export async function uploadMultipartFile(
  file: Pick<File, 'size' | 'slice'>,
  options: {
    partCount: number;
    partSizeBytes: number;
    existingParts: ExistingUploadPart[];
    requestPartUrl: (partNumber: number) => Promise<PartUrlResult>;
    putPart: (url: string, body: Blob, onProgress: (loadedBytes: number) => void, signal?: AbortSignal) => Promise<void>;
    onProgress: (ratio: number) => void;
    concurrency?: number;
    signal?: AbortSignal;
  },
): Promise<void> {
  const { partCount, partSizeBytes, existingParts, requestPartUrl, putPart, onProgress, signal } = options;
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || !Number.isInteger(partCount) || partCount < 1 ||
    !Number.isSafeInteger(partSizeBytes) || partSizeBytes < 1) {
    throw new Error('上传文件或分片参数无效');
  }
  const concurrency = Math.max(1, Math.min(6, Math.floor(options.concurrency ?? 3)));
  const completed = new Set(existingParts.filter((part) => Number.isInteger(part.partNumber) && part.partNumber >= 1 && part.partNumber <= partCount).map((part) => part.partNumber));
  const activeProgress = new Map<number, number>();
  const expectedSize = (partNumber: number) => Math.max(0, Math.min(partSizeBytes, file.size - (partNumber - 1) * partSizeBytes));
  const report = () => {
    const completeBytes = [...completed].reduce((sum, number) => sum + expectedSize(number), 0);
    const activeBytes = [...activeProgress.values()].reduce((sum, value) => sum + value, 0);
    onProgress(Math.min(1, Math.max(0, (completeBytes + activeBytes) / file.size)));
  };
  report();
  let nextPartIndex = 1;
  let failure: unknown;

  const worker = async () => {
    while (!failure) {
      if (signal?.aborted) throw new DOMException('上传已取消', 'AbortError');
      while (nextPartIndex <= partCount && completed.has(nextPartIndex)) nextPartIndex += 1;
      if (nextPartIndex > partCount) return;
      const partNumber = nextPartIndex++;
      const start = (partNumber - 1) * partSizeBytes;
      const end = Math.min(file.size, start + partSizeBytes);
      try {
        const signed = await requestPartUrl(partNumber);
        if (signed.alreadyUploaded) {
          completed.add(partNumber);
          report();
          continue;
        }
        activeProgress.set(partNumber, 0);
        report();
        await putPart(signed.url, file.slice(start, end), (loadedBytes) => {
          activeProgress.set(partNumber, Math.max(0, Math.min(end - start, loadedBytes)));
          report();
        }, signal);
        activeProgress.delete(partNumber);
        completed.add(partNumber);
        report();
      } catch (error) {
        activeProgress.delete(partNumber);
        failure ??= error;
        report();
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, partCount) }, () => worker()));
  if (failure) throw failure;
  if (completed.size !== partCount) throw new Error('部分分片尚未完成');
  onProgress(1);
}

export function putSignedUploadPart(
  url: string,
  body: Blob,
  onProgress: (loadedBytes: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('上传已取消', 'AbortError'));
      return;
    }
    const request = new XMLHttpRequest();
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      callback();
    };
    const abort = () => request.abort();
    request.open('PUT', url);
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded); };
    request.onload = () => finish(() => request.status >= 200 && request.status < 300
      ? resolve()
      : reject(new Error(`MinIO 分片上传失败（HTTP ${request.status}）`)));
    request.onerror = () => finish(() => reject(new Error('MinIO 上传失败；请检查网络、HTTPS 与应用域名 CORS 配置后选择原文件续传')));
    request.onabort = () => finish(() => reject(new DOMException('上传已取消', 'AbortError')));
    signal?.addEventListener('abort', abort, { once: true });
    request.send(body);
  });
}
