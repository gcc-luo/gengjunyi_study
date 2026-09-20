import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";

const updateSettingsSchema = z.object({ freeChoice: z.boolean() }).strict();

function error(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

export function registerSettingsRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.get("/api/settings", { preHandler: app.requireParentUnlocked }, async (request, reply) => {
    const settings = await prisma.parentSetting.findMany({
      where: { adminUserId: request.parentSession!.adminUserId, key: "freeChoice" },
      select: { value: true },
    });
    return reply.send({ freeChoice: settings[0]?.value !== "false" });
  });

  app.patch("/api/settings", { preHandler: app.requireParentUnlocked }, async (request, reply) => {
    const parsed = updateSettingsSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, "BAD_REQUEST", "Settings are invalid");
    const setting = await prisma.parentSetting.upsert({
      where: { adminUserId_key: { adminUserId: request.parentSession!.adminUserId, key: "freeChoice" } },
      create: { adminUserId: request.parentSession!.adminUserId, key: "freeChoice", value: String(parsed.data.freeChoice) },
      update: { value: String(parsed.data.freeChoice) },
      select: { value: true },
    });
    return reply.send({ freeChoice: setting.value !== "false" });
  });
}
