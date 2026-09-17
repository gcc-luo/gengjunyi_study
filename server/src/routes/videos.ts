import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { MediaStorage } from "../storage/minio.js";
import { deleteVideo, UploadError } from "../services/uploads.js";

const paramsSchema = z.object({ videoId: z.string().min(1).max(128) });
const deleteSchema = z.object({ confirmHistoryDeletion: z.literal(true) });

export function registerVideoManagementRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  storage: MediaStorage,
): void {
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
