import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { MediaStorage } from "../storage/minio.js";
import { validateMediaUrl } from "./media-validation.js";

export type ProcessingStage = "QUEUED" | "TRANSCODING" | "VERIFYING" | "CLEANUP" | "COMPLETE" | "FAILED";

export function overallProcessingProgress(stage: string | null, progress: number): number {
  const bounded = Math.max(0, Math.min(100, progress));
  if (stage === "QUEUED") return 72;
  if (stage === "TRANSCODING") return 72 + Math.round(bounded * 0.26);
  if (stage === "VERIFYING" || stage === "CLEANUP") return 97;
  if (stage === "COMPLETE") return 100;
  return 70;
}

export function buildFfmpegArguments(input: {
  inputUrl: string;
  outputPath: string;
  hasAudio: boolean;
}): string[] {
  const args = ["-hide_banner", "-loglevel", "error", "-i", input.inputUrl];
  if (!input.hasAudio) {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  }
  args.push("-map", "0:v:0");
  args.push(...(input.hasAudio ? ["-map", "0:a:0"] : ["-map", "1:a:0", "-shortest"]));
  args.push(
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "-progress", "pipe:1",
    "-nostats",
    "-y",
    input.outputPath,
  );
  return args;
}

export function thumbnailObjectKey(videoId: string): string {
  return `thumbnails/${videoId}.jpg`;
}

export function buildThumbnailFfmpegArguments(input: {
  inputPath: string;
  outputPath: string;
}): string[] {
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-i", input.inputPath,
    "-frames:v", "1",
    "-vf", "scale=320:-2",
    "-q:v", "4",
    "-y",
    input.outputPath,
  ];
}

type SourceProbe = { durationMs: number; hasAudio: boolean };

async function probeSource(url: string): Promise<SourceProbe> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_type",
      "-of", "json",
      url,
    ], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8") || "无法读取源视频"));
        return;
      }
      try {
        const output = JSON.parse(Buffer.concat(stdout).toString("utf8")) as {
          format?: { duration?: string };
          streams?: Array<{ codec_type?: string }>;
        };
        const durationSeconds = Number(output.format?.duration);
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("无法识别视频时长");
        resolve({
          durationMs: Math.round(durationSeconds * 1000),
          hasAudio: output.streams?.some((stream) => stream.codec_type === "audio") ?? false,
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function transcode(
  args: string[],
  durationMs: number,
  onProgress: (progress: number) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let progressBuffer = "";
    const errors: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      progressBuffer += chunk.toString("utf8");
      const lines = progressBuffer.split(/\r?\n/u);
      progressBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const match = /^out_time_(?:us|ms)=(\d+)$/u.exec(line);
        if (match) onProgress(Math.min(99, Math.round((Number(match[1]) / 1000 / durationMs) * 100)));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errors.push(chunk);
      if (errors.reduce((total, item) => total + item.length, 0) > 64 * 1024) errors.shift();
    });
    child.once("error", reject);
    child.once("close", (code) => code === 0
      ? resolve()
      : reject(new Error(Buffer.concat(errors).toString("utf8") || `ffmpeg exited with code ${code}`)));
  });
}

async function captureThumbnail(inputPath: string, outputPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", buildThumbnailFfmpegArguments({ inputPath, outputPath }), {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const errors: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => code === 0
      ? resolve()
      : reject(new Error(Buffer.concat(errors).toString("utf8") || `ffmpeg exited with code ${code}`)));
  });
}

export async function ensureVideoThumbnail(
  storage: MediaStorage,
  input: { id: string; objectKey: string },
): Promise<boolean> {
  const objectKey = thumbnailObjectKey(input.id);
  try {
    await storage.headObject(objectKey);
    return true;
  } catch {
    // Older READY videos may not have a thumbnail yet; create it on first request.
  }

  const workingDirectory = await mkdtemp(join(tmpdir(), "family-learning-thumbnail-"));
  const thumbnailPath = join(workingDirectory, "thumbnail.jpg");
  try {
    const sourceUrl = await storage.presignInternalGetObject(input.objectKey);
    await captureThumbnail(sourceUrl, thumbnailPath);
    await storage.putObjectFromFile(objectKey, thumbnailPath, "image/jpeg");
    return true;
  } catch {
    return false;
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

async function lockQuotaRow(tx: any): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "StorageQuota" WHERE "id" = 1 FOR UPDATE`;
}

export async function processNextVideo(prisma: PrismaClient, storage: MediaStorage): Promise<boolean> {
  const video = await prisma.video.findFirst({
    where: { status: "PROCESSING", processingStage: "QUEUED" },
    orderBy: { createdAt: "asc" },
  });
  if (!video) return false;
  const claimed = await prisma.video.updateMany({
    where: { id: video.id, status: "PROCESSING", processingStage: "QUEUED" },
    data: { processingStage: "TRANSCODING", processingProgress: 0, failureReason: null },
  });
  if (claimed.count !== 1) return true;

  const upload = await prisma.uploadSession.findUnique({ where: { videoId: video.id } });
  const workingDirectory = await mkdtemp(join(tmpdir(), "family-learning-transcode-"));
  const outputPath = join(workingDirectory, "output.mp4");
  const thumbnailPath = join(workingDirectory, "thumbnail.jpg");
  let thumbnailUploaded = false;
  try {
    if (!upload) throw new Error("找不到源视频上传记录");
    const sourceUrl = await storage.presignInternalGetObject(upload.objectKey);
    const source = await probeSource(sourceUrl);
    let lastSavedProgress = -1;
    await transcode(buildFfmpegArguments({ inputUrl: sourceUrl, outputPath, hasAudio: source.hasAudio }), source.durationMs, (progress) => {
      if (progress < lastSavedProgress + 2) return;
      lastSavedProgress = progress;
      void prisma.video.updateMany({
        where: { id: video.id, status: "PROCESSING" },
        data: { processingProgress: progress },
      }).catch(() => undefined);
    });
    await captureThumbnail(outputPath, thumbnailPath);
    await storage.putObjectFromFile(thumbnailObjectKey(video.id), thumbnailPath, "image/jpeg");
    thumbnailUploaded = true;
    await prisma.video.update({
      where: { id: video.id },
      data: { processingStage: "VERIFYING", processingProgress: 100 },
    });
    await storage.putObjectFromFile(video.objectKey, outputPath, "video/mp4");
    const validation = await validateMediaUrl(await storage.presignInternalGetObject(video.objectKey));
    if (!validation.valid) {
      await storage.deleteObject(video.objectKey).catch(() => undefined);
      await storage.deleteObject(thumbnailObjectKey(video.id)).catch(() => undefined);
      throw new Error(validation.reason);
    }
    const output = await storage.headObject(video.objectKey);
    await prisma.video.update({ where: { id: video.id }, data: { processingStage: "CLEANUP" } });
    await storage.deleteObject(upload.objectKey);
    await prisma.$transaction(async (tx) => {
      await lockQuotaRow(tx);
      await tx.storageQuota.update({
        where: { id: 1 },
        data: { usedBytes: { increment: output.byteSize - BigInt(video.sourceByteSize) } },
      });
      await tx.video.update({
        where: { id: video.id },
        data: {
          byteSize: output.byteSize,
          sourceByteSize: 0n,
          sourceDeletedAt: new Date(),
          sourceDeleteAfter: null,
          durationMs: validation.durationMs,
          codec: "h264/aac",
          status: "READY",
          processingStage: "COMPLETE",
          processingProgress: 100,
          failureReason: null,
        },
      });
    });
  } catch (error) {
    if (thumbnailUploaded) await storage.deleteObject(thumbnailObjectKey(video.id)).catch(() => undefined);
    const reason = error instanceof Error ? error.message.slice(0, 1000) : "视频转码失败";
    await prisma.video.update({
      where: { id: video.id },
      data: {
        status: "FAILED",
        processingStage: "FAILED",
        failureReason: reason,
        sourceDeleteAfter: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
  return true;
}

export async function cleanupExpiredFailedSources(
  prisma: PrismaClient,
  storage: MediaStorage,
  now = new Date(),
): Promise<number> {
  const videos = await prisma.video.findMany({
    where: { status: "FAILED", sourceDeleteAfter: { lte: now }, sourceDeletedAt: null, sourceByteSize: { gt: 0n } },
  });
  let removed = 0;
  for (const video of videos) {
    const upload = await prisma.uploadSession.findUnique({ where: { videoId: video.id } });
    if (!upload) continue;
    try {
      await storage.deleteObject(upload.objectKey);
      await prisma.$transaction(async (tx) => {
        await lockQuotaRow(tx);
        await tx.storageQuota.update({
          where: { id: 1 },
          data: { usedBytes: { decrement: BigInt(video.sourceByteSize) } },
        });
        await tx.video.update({
          where: { id: video.id },
          data: { sourceByteSize: 0n, sourceDeletedAt: now, sourceDeleteAfter: null },
        });
      });
      removed += 1;
    } catch {
      // Keep the source charged to quota and retry cleanup later.
    }
  }
  return removed;
}
