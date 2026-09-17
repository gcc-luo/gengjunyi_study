import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { MediaStorage } from "../storage/minio.js";
import { deleteVideo, UploadError } from "../services/uploads.js";

const paramsSchema = z.object({ videoId: z.string().min(1).max(128) });
const deleteSchema = z.object({ confirmHistoryDeletion: z.literal(true) });
const updateSchema = z.object({ title: z.string().trim().min(1).max(200) });

export function registerVideoManagementRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  storage: MediaStorage,
): void {
  app.patch("/api/videos/:videoId", { preHandler: app.requireParent }, async (request, reply: FastifyReply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = updateSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: { code: "BAD_REQUEST", message: "Video title is invalid" } });
    }
    const video = await prisma.video.findUnique({ where: { id: params.data.videoId }, select: { id: true } });
    if (!video) return reply.code(404).send({ error: { code: "RESOURCE_NOT_FOUND", message: "Resource not found" } });
    const updated = await prisma.video.update({
      where: { id: video.id },
      data: { title: body.data.title },
      select: { id: true, courseId: true, title: true, fileName: true, durationMs: true, status: true, sortOrder: true, createdAt: true, updatedAt: true },
    });
    return reply.send(updated);
  });

  app.delete("/api/videos/:videoId", { preHandler: app.requireParent }, async (request, reply: FastifyReply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = deleteSchema.safeParse(request.body);
    if (!params.success) {
      return reply.code(400).send({ error: { code: "BAD_REQUEST", message: "Video ID is invalid" } });
    }
    if (!body.success) {
      return reply.code(400).send({
        error: { code: "CONFIRMATION_REQUIRED", message: "Confirm that learning history will also be deleted" },
      });
    }
    try {
      await deleteVideo(prisma, storage, { videoId: params.data.videoId, ...body.data });
      return reply.code(204).send();
    } catch (error) {
      if (!(error instanceof UploadError)) throw error;
      const status = error.code === "video-not-found" ? 404 :
        error.code === "course-is-published" ? 409 : 400;
      return reply.code(status).send({
        error: { code: error.code.replaceAll("-", "_").toUpperCase(), message: error.message },
      });
    }
  });
}
