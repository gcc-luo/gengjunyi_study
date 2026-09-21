import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { MediaStorage } from "../storage/minio.js";
import type { MediaValidationResult } from "../services/media-validation.js";
import {
  cancelUpload,
  completeUpload,
  createUpload,
  getUploadStatus,
  signUploadPart,
  UploadError,
} from "../services/uploads.js";

const courseParams = z.object({ courseId: z.string().min(1).max(128) });
const uploadParams = z.object({ uploadId: z.string().min(1).max(128) });
const partParams = z.object({ uploadId: z.string().min(1).max(128), partNumber: z.coerce.number().int() });
const createSchema = z.object({
  fileName: z.string().min(1).max(255),
  sizeBytes: z.number().int().safe().positive(),
});

function sendUploadError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof UploadError)) throw error;
  const statusByCode: Record<UploadError["code"], number> = {
    "invalid-file": 400,
    "course-not-found": 404,
    "course-must-be-unpublished": 409,
    "quota-exceeded": 413,
    "upload-not-found": 404,
    "upload-expired": 410,
    "invalid-part-number": 400,
    "parts-incomplete": 409,
    "object-size-mismatch": 422,
    "video-not-found": 404,
    "video-not-archived": 409,
    "archived-object-missing": 422,
    "source-unavailable": 410,
    "video-not-failed": 409,
    "video-processing": 409,
    "course-is-published": 409,
    "confirmation-required": 400,
    "upload-not-active": 409,
  };
  return reply.code(statusByCode[error.code]).send({
    error: { code: error.code.replaceAll("-", "_").toUpperCase(), message: error.message },
  });
}

export function registerUploadRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  storage: MediaStorage,
  validateMedia: (url: string) => Promise<MediaValidationResult>,
): void {
  app.post("/api/courses/:courseId/uploads", { preHandler: app.requireParentUnlocked }, async (request, reply) => {
    const params = courseParams.safeParse(request.params);
    const body = createSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: { code: "BAD_REQUEST", message: "Upload details are invalid" } });
    }
    try {
      const result = await createUpload(prisma, storage, { ...body.data, courseId: params.data.courseId });
      return reply.code(201).send({ uploadId: result.uploadId, partCount: result.partCount, partSizeBytes: result.partSizeBytes });
    } catch (error) {
      return sendUploadError(reply, error);
    }
  });

  app.get("/api/uploads/:uploadId", { preHandler: app.requireParentUnlocked }, async (request, reply) => {
    const params = uploadParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: { code: "BAD_REQUEST", message: "Upload ID is invalid" } });
    try {
      return reply.send(await getUploadStatus(prisma, storage, params.data.uploadId));
    } catch (error) {
      return sendUploadError(reply, error);
    }
  });

  app.post("/api/uploads/:uploadId/parts/:partNumber/url", { preHandler: app.requireParentUnlocked }, async (request, reply) => {
    const params = partParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: { code: "BAD_REQUEST", message: "Part number is invalid" } });
    try {
      return reply.send(await signUploadPart(prisma, storage, params.data.uploadId, params.data.partNumber));
    } catch (error) {
      return sendUploadError(reply, error);
    }
  });

  app.post("/api/uploads/:uploadId/complete", { preHandler: app.requireParentUnlocked }, async (request, reply) => {
    const params = uploadParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: { code: "BAD_REQUEST", message: "Upload ID is invalid" } });
    try {
      const result = await completeUpload(prisma, storage, validateMedia, params.data.uploadId);
      return reply.send({ status: result.status, video: result.video });
    } catch (error) {
      return sendUploadError(reply, error);
    }
  });

  app.post("/api/uploads/:uploadId/cancel", { preHandler: app.requireParentUnlocked }, async (request, reply) => {
    const params = uploadParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: { code: "BAD_REQUEST", message: "Upload ID is invalid" } });
    try {
      await cancelUpload(prisma, storage, params.data.uploadId);
      return reply.code(204).send();
    } catch (error) {
      return sendUploadError(reply, error);
    }
  });
}
