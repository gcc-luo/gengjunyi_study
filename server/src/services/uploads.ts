import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { MediaStorage, UploadedPart } from "../storage/minio.js";
import type { MediaValidationResult } from "./media-validation.js";
import { mediaContentType, mediaExtension, titleFromMediaFileName } from "./media-formats.js";
import { thumbnailObjectKey } from "./media-transcoding.js";

export const MEDIA_QUOTA_BYTES = 100_000_000_000n;
export const UPLOAD_PART_SIZE_BYTES = 16 * 1024 * 1024;
export const MAX_MULTIPART_PARTS = 10_000;
export const UPLOAD_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export type UploadErrorCode =
  | "invalid-file"
  | "course-not-found"
  | "course-must-be-unpublished"
  | "quota-exceeded"
  | "upload-not-found"
  | "upload-expired"
  | "invalid-part-number"
  | "parts-incomplete"
  | "object-size-mismatch"
  | "video-not-found"
  | "course-is-published"
  | "confirmation-required"
  | "video-not-archived"
  | "archived-object-missing"
  | "source-unavailable"
  | "video-not-failed"
  | "video-processing"
  | "upload-not-active";

export class UploadError extends Error {
  constructor(readonly code: UploadErrorCode, message: string) {
    super(message);
    this.name = "UploadError";
  }
}

function partCountFor(byteSize: bigint): number {
  return Number((byteSize + BigInt(UPLOAD_PART_SIZE_BYTES) - 1n) / BigInt(UPLOAD_PART_SIZE_BYTES));
}

function normalizeFileName(fileName: string): string {
  return fileName.replace(/[\\/]/g, "_").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
}

function videoIdFor(session: { videoId: string | null }): string {
  if (!session.videoId) throw new Error("Upload session is not linked to a video");
  return session.videoId;
}

function isNotFound(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === "NotFound" || candidate.name === "NoSuchKey" ||
    candidate.$metadata?.httpStatusCode === 404;
}

async function lockQuotaRow(tx: any): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "StorageQuota" WHERE "id" = 1 FOR UPDATE`;
}

export async function createUpload(
  prisma: PrismaClient,
  storage: MediaStorage,
  input: { courseId: string; fileName: string; sizeBytes: number },
) {
  const fileName = normalizeFileName(input.fileName);
  const extension = mediaExtension(fileName);
  const contentType = mediaContentType(fileName);
  if (!extension || !contentType || !fileName ||
    !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new UploadError("invalid-file", "Choose a non-empty supported video file with a valid size");
  }
  const reservedBytes = BigInt(input.sizeBytes);
  const partCount = partCountFor(reservedBytes);
  if (partCount < 1 || partCount > MAX_MULTIPART_PARTS) {
    throw new UploadError("invalid-file", "The file is too large for multipart upload");
  }

  const course = await prisma.course.findUnique({ where: { id: input.courseId } });
  if (!course) throw new UploadError("course-not-found", "Course not found");

  const mediaId = randomUUID();
  const objectKey = `sources/${mediaId}.${extension}`;
  const playbackObjectKey = `videos/${mediaId}.mp4`;
  let minioUploadId: string | undefined;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockQuotaRow(tx);
      const currentCourse = await tx.course.findUnique({ where: { id: input.courseId } });
      if (!currentCourse) throw new UploadError("course-not-found", "Course not found");
      const quota = await tx.storageQuota.findUnique({ where: { id: 1 } });
      if (!quota || BigInt(quota.usedBytes) + BigInt(quota.reservedBytes) + reservedBytes > BigInt(quota.maxBytes)) {
        throw new UploadError("quota-exceeded", "There is not enough storage space for this upload");
      }
      await tx.storageQuota.update({
        where: { id: 1 },
        data: { reservedBytes: { increment: reservedBytes } },
      });

      minioUploadId = await storage.createMultipartUpload(objectKey, contentType);
      const courseVideos = await tx.video.findMany({
        where: { courseId: input.courseId },
        select: { sortOrder: true },
      });
      const sortOrder = courseVideos.reduce((maximum, video) => Math.max(maximum, video.sortOrder), -1) + 1;
      const video = await tx.video.create({
        data: {
          courseId: input.courseId,
          title: titleFromMediaFileName(fileName),
          objectKey: playbackObjectKey,
          fileName,
          byteSize: 0n,
          status: "UPLOADING",
          sortOrder,
        },
      });
      const upload = await tx.uploadSession.create({
        data: {
          videoId: video.id,
          objectKey,
          minioUploadId,
          reservedBytes,
          completedParts: [],
          status: "ACTIVE",
          expiresAt: new Date(Date.now() + UPLOAD_LIFETIME_MS),
        },
      });
      return upload;
    });
    return { uploadId: result.id as string, objectKey, partCount, partSizeBytes: UPLOAD_PART_SIZE_BYTES };
  } catch (error) {
    if (minioUploadId) await storage.abortMultipartUpload(objectKey, minioUploadId).catch(() => undefined);
    throw error;
  }
}

async function findActiveUpload(prisma: PrismaClient, uploadId: string) {
  const session = await prisma.uploadSession.findUnique({ where: { id: uploadId } });
  if (!session) throw new UploadError("upload-not-found", "Upload session not found");
  if (session.status !== "ACTIVE") throw new UploadError("upload-not-active", "Upload session is no longer active");
  if (session.expiresAt.getTime() <= Date.now()) {
    throw new UploadError("upload-expired", "Upload session has expired");
  }
  return session;
}

export async function getUploadStatus(prisma: PrismaClient, storage: MediaStorage, uploadId: string) {
  const session = await prisma.uploadSession.findUnique({ where: { id: uploadId } });
  if (!session) throw new UploadError("upload-not-found", "Upload session not found");
  const expectedPartCount = session.status === "ACTIVE"
    ? partCountFor(BigInt(session.reservedBytes))
    : (session.completedParts as UploadedPart[]).length;
  const parts = session.status === "ACTIVE"
    ? await storage.listParts(session.objectKey, session.minioUploadId)
    : (session.completedParts as UploadedPart[]);
  const video = session.videoId
    ? await prisma.video.findUnique({ where: { id: session.videoId } })
    : null;
  return {
    uploadId: session.id,
    status: session.status,
    expiresAt: session.expiresAt,
    partSizeBytes: UPLOAD_PART_SIZE_BYTES,
    partCount: expectedPartCount,
    parts,
    videoId: video?.id ?? null,
    mediaStatus: video?.status ?? null,
    processingStage: video?.processingStage ?? null,
    processingProgress: video?.processingProgress ?? 0,
    processingUpdatedAt: video?.updatedAt?.toISOString() ?? null,
    failureReason: video?.failureReason ?? null,
  };
}

export async function signUploadPart(
  prisma: PrismaClient,
  storage: MediaStorage,
  uploadId: string,
  partNumber: number,
) {
  const session = await findActiveUpload(prisma, uploadId);
  const partCount = partCountFor(BigInt(session.reservedBytes));
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > partCount) {
    throw new UploadError("invalid-part-number", "Part number is outside this upload");
  }
  const parts = await storage.listParts(session.objectKey, session.minioUploadId);
  if (parts.some((part) => part.partNumber === partNumber)) {
    return { alreadyUploaded: true as const, partNumber };
  }
  return {
    alreadyUploaded: false as const,
    partNumber,
    url: await storage.presignUploadPart(session.objectKey, session.minioUploadId, partNumber),
    expiresInSeconds: 15 * 60,
  };
}

async function releaseFailedCompletion(
  prisma: PrismaClient,
  storage: MediaStorage,
  session: any,
  reason: string,
  objectMayExist: boolean,
): Promise<void> {
  if (objectMayExist) await storage.deleteObject(session.objectKey);
  await prisma.$transaction(async (tx) => {
    await lockQuotaRow(tx);
    const current = await tx.uploadSession.findUnique({ where: { id: session.id } });
    if (!current || current.status !== "ACTIVE") return;
    await tx.storageQuota.update({
      where: { id: 1 },
      data: { reservedBytes: { decrement: BigInt(current.reservedBytes) } },
    });
    await tx.uploadSession.update({
      where: { id: current.id },
      data: { status: "COMPLETED", reservedBytes: 0n },
    });
    await tx.video.update({
      where: { id: videoIdFor(current) },
      data: { status: "FAILED", failureReason: reason, byteSize: 0n },
    });
  });
}

export async function completeUpload(
  prisma: PrismaClient,
  storage: MediaStorage,
  _validateMedia: (url: string) => Promise<MediaValidationResult>,
  uploadId: string,
) {
  const session = await findActiveUpload(prisma, uploadId);
  const expectedPartCount = partCountFor(BigInt(session.reservedBytes));
  const parts = await storage.listParts(session.objectKey, session.minioUploadId);
  if (parts.length !== expectedPartCount || parts.some((part, index) => part.partNumber !== index + 1)) {
    throw new UploadError("parts-incomplete", "Some upload parts are missing; resume the upload and try again");
  }
  await storage.completeMultipartUpload(session.objectKey, session.minioUploadId, parts);
  const head = await storage.headObject(session.objectKey);
  const videoBeforeCompletion = await prisma.video.findUnique({ where: { id: videoIdFor(session) } });
  const expectedContentType = videoBeforeCompletion ? mediaContentType(videoBeforeCompletion.fileName) : null;
  if (head.byteSize <= 0n || head.byteSize > BigInt(session.reservedBytes) ||
    !expectedContentType || head.contentType !== expectedContentType) {
    const reason = "Uploaded object size or media type does not match the reserved upload";
    await releaseFailedCompletion(prisma, storage, session, reason, true);
    throw new UploadError("object-size-mismatch", reason);
  }

  await prisma.$transaction(async (tx) => {
    await lockQuotaRow(tx);
    const current = await tx.uploadSession.findUnique({ where: { id: session.id } });
    if (!current || current.status !== "ACTIVE") throw new UploadError("upload-not-active", "Upload session is no longer active");
    await tx.storageQuota.update({
      where: { id: 1 },
      data: {
        usedBytes: { increment: head.byteSize },
        reservedBytes: { decrement: BigInt(current.reservedBytes) },
      },
    });
    await tx.uploadSession.update({
      where: { id: current.id },
      data: { status: "COMPLETED", reservedBytes: 0n, completedParts: parts },
    });
    await tx.video.update({
      where: { id: videoIdFor(current) },
      data: {
        byteSize: 0n,
        sourceByteSize: head.byteSize,
        status: "PROCESSING",
        processingStage: "QUEUED",
        processingProgress: 0,
        sourceDeleteAfter: null,
        sourceDeletedAt: null,
        failureReason: null,
      },
    });
  });
  return { status: "PROCESSING" as const, video: { id: videoIdFor(session) } };
}

export async function cancelUpload(prisma: PrismaClient, storage: MediaStorage, uploadId: string) {
  const session = await findActiveUpload(prisma, uploadId);
  await storage.abortMultipartUpload(session.objectKey, session.minioUploadId);
  await prisma.$transaction(async (tx) => {
    await lockQuotaRow(tx);
    const current = await tx.uploadSession.findUnique({ where: { id: session.id } });
    if (!current || current.status !== "ACTIVE") return;
    await tx.storageQuota.update({
      where: { id: 1 },
      data: { reservedBytes: { decrement: BigInt(current.reservedBytes) } },
    });
    await tx.uploadSession.update({
      where: { id: current.id },
      data: { status: "ABORTED", reservedBytes: 0n },
    });
    await tx.video.update({
      where: { id: videoIdFor(current) },
      data: { status: "FAILED", failureReason: "Upload cancelled" },
    });
  });
}

export async function getStorageQuota(prisma: PrismaClient) {
  const quota = await prisma.storageQuota.findUnique({ where: { id: 1 } });
  if (!quota) throw new Error("Storage quota has not been initialized");
  const usedBytes = BigInt(quota.usedBytes);
  const reservedBytes = BigInt(quota.reservedBytes);
  const totalBytes = BigInt(quota.maxBytes);
  const committedAndReserved = usedBytes + reservedBytes;
  const percent = totalBytes > 0n
    ? Number((committedAndReserved * 10_000n) / totalBytes) / 100
    : 100;
  return {
    usedBytes: usedBytes.toString(),
    reservedBytes: reservedBytes.toString(),
    totalBytes: totalBytes.toString(),
    availableBytes: (totalBytes > committedAndReserved ? totalBytes - committedAndReserved : 0n).toString(),
    usedPercent: percent,
    warningLevel: percent >= 95 ? "critical" : percent >= 80 ? "warning" : "none",
  };
}

export async function deleteVideo(
  prisma: PrismaClient,
  storage: MediaStorage,
  input: { videoId: string },
) {
  const video = await prisma.video.findUnique({ where: { id: input.videoId } });
  if (!video) throw new UploadError("video-not-found", "Video not found");
  if (video.status === "ARCHIVED") return;
  const course = await prisma.course.findUnique({ where: { id: video.courseId } });
  if (course?.status === "PUBLISHED") {
    throw new UploadError("course-is-published", "Unpublish the course before deleting its videos");
  }

  await prisma.video.update({ where: { id: video.id }, data: { status: "ARCHIVED" } });
  const upload = await prisma.uploadSession.findUnique({ where: { videoId: video.id } });
  if (upload?.status === "ACTIVE") {
    await storage.abortMultipartUpload(upload.objectKey, upload.minioUploadId);
  }

  await prisma.$transaction(async (tx) => {
    await lockQuotaRow(tx);
    if (upload?.status === "ACTIVE") {
      await tx.storageQuota.update({
        where: { id: 1 },
        data: { reservedBytes: { decrement: BigInt(upload.reservedBytes) } },
      });
      await tx.uploadSession.update({ where: { id: upload.id }, data: { status: "ABORTED", reservedBytes: 0n } });
    }
  });
}

export async function permanentlyDeleteVideoFiles(
  prisma: PrismaClient,
  storage: MediaStorage,
  input: { videoId: string },
) {
  const video = await prisma.video.findUnique({ where: { id: input.videoId } });
  if (!video) throw new UploadError("video-not-found", "Video not found");
  const course = await prisma.course.findUnique({ where: { id: video.courseId } });
  if (course?.status === "PUBLISHED") {
    throw new UploadError("course-is-published", "Unpublish the course before deleting its videos");
  }
  if (video.status === "PROCESSING" || video.status === "UPLOADING") {
    throw new UploadError("video-processing", "Wait until video processing finishes before deleting its files");
  }

  const upload = await prisma.uploadSession.findUnique({ where: { videoId: video.id } });
  const objectKeys = [...new Set([video.objectKey, thumbnailObjectKey(video.id), upload?.objectKey].filter((key): key is string => Boolean(key)))];
  await Promise.all(objectKeys.map((key) => storage.deleteObject(key)));

  await prisma.$transaction(async (tx) => {
    await lockQuotaRow(tx);
    const current = await tx.video.findUnique({ where: { id: video.id } });
    if (!current || current.status === "PROCESSING" || current.status === "UPLOADING") {
      throw new UploadError("video-processing", "Wait until video processing finishes before deleting its files");
    }
    const bytesToRelease = BigInt(current.byteSize ?? 0) + BigInt(current.sourceByteSize ?? 0);
    if (bytesToRelease > 0n) {
      await tx.storageQuota.update({
        where: { id: 1 },
        data: { usedBytes: { decrement: bytesToRelease } },
      });
    }
    await tx.video.update({
      where: { id: current.id },
      data: {
        status: "ARCHIVED",
        byteSize: 0n,
        sourceByteSize: 0n,
        sourceDeletedAt: new Date(),
        sourceDeleteAfter: null,
        failureReason: "Video files deleted by parent",
      },
    });
  });
}

export async function restoreVideo(
  prisma: PrismaClient,
  storage: MediaStorage,
  videoId: string,
) {
  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video) throw new UploadError("video-not-found", "Video not found");
  if (video.status !== "ARCHIVED") {
    throw new UploadError("video-not-archived", "Only archived videos can be restored");
  }

  let head: Awaited<ReturnType<MediaStorage["headObject"]>>;
  try {
    head = await storage.headObject(video.objectKey);
  } catch {
    throw new UploadError("archived-object-missing", "The archived video file is no longer available");
  }
  if (head.byteSize <= 0n || head.contentType !== "video/mp4") {
    throw new UploadError("archived-object-missing", "The archived video file is no longer available");
  }

  return prisma.video.update({
    where: { id: video.id },
    data: { status: "READY", byteSize: head.byteSize, failureReason: null },
  });
}

export async function retryVideoProcessing(
  prisma: PrismaClient,
  storage: MediaStorage,
  videoId: string,
) {
  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video) throw new UploadError("video-not-found", "Video not found");
  if (video.status !== "FAILED") {
    throw new UploadError("video-not-failed", "Only failed video processing can be retried");
  }
  if (BigInt(video.sourceByteSize) <= 0n || video.sourceDeletedAt) {
    throw new UploadError("source-unavailable", "The original video is no longer available; upload it again");
  }
  const upload = await prisma.uploadSession.findUnique({ where: { videoId } });
  if (!upload) throw new UploadError("source-unavailable", "The original video is no longer available; upload it again");
  try {
    const source = await storage.headObject(upload.objectKey);
    if (source.byteSize <= 0n) throw new Error("empty source");
  } catch {
    throw new UploadError("source-unavailable", "The original video is no longer available; upload it again");
  }
  return prisma.video.update({
    where: { id: video.id },
    data: {
      status: "PROCESSING",
      processingStage: "QUEUED",
      processingProgress: 0,
      sourceDeleteAfter: null,
      failureReason: null,
    },
  });
}

export async function expireOldUploads(
  prisma: PrismaClient,
  storage: MediaStorage,
  now = new Date(),
): Promise<number> {
  const sessions = await prisma.uploadSession.findMany({
    where: { status: "ACTIVE", expiresAt: { lte: now } },
  });
  let expired = 0;
  for (const session of sessions) {
    try {
      let completedHead: Awaited<ReturnType<MediaStorage["headObject"]>> | undefined;
      try {
        await storage.abortMultipartUpload(session.objectKey, session.minioUploadId);
      } catch (error) {
        const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        const missingUpload = candidate.name === "NoSuchUpload" || candidate.$metadata?.httpStatusCode === 404;
        if (!missingUpload) throw error;
        try {
          completedHead = await storage.headObject(session.objectKey);
        } catch (headError) {
          if (!isNotFound(headError)) throw headError;
        }
        if (completedHead && completedHead.byteSize > BigInt(session.reservedBytes)) {
          await storage.deleteObject(session.objectKey);
          completedHead = undefined;
        }
      }
      await prisma.$transaction(async (tx) => {
        await lockQuotaRow(tx);
        const current = await tx.uploadSession.findUnique({ where: { id: session.id } });
        if (!current || current.status !== "ACTIVE") return;
        await tx.storageQuota.update({
          where: { id: 1 },
          data: completedHead
            ? {
                usedBytes: { increment: completedHead.byteSize },
                reservedBytes: { decrement: BigInt(current.reservedBytes) },
              }
            : { reservedBytes: { decrement: BigInt(current.reservedBytes) } },
        });
        await tx.uploadSession.update({
          where: { id: current.id },
          data: { status: completedHead ? "COMPLETED" : "EXPIRED", reservedBytes: 0n },
        });
        await tx.video.update({
          where: { id: videoIdFor(current) },
          data: {
            status: "FAILED",
            failureReason: completedHead ? "Upload completed after its session expired" : "Upload expired",
            processingStage: "FAILED",
            ...(completedHead ? {
              byteSize: 0n,
              sourceByteSize: completedHead.byteSize,
              sourceDeleteAfter: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            } : {}),
          },
        });
      });
      expired += 1;
    } catch {
      // Keep reservation until storage confirms that the multipart upload was aborted.
    }
  }
  return expired;
}
