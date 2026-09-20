import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { getStorageQuota } from "../services/uploads.js";

export function registerStorageRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.get("/api/storage", { preHandler: app.requireParentUnlocked }, async (_request, reply: FastifyReply) => {
    return reply.send(await getStorageQuota(prisma));
  });
}
