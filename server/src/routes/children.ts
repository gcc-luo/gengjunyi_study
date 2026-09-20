import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  createChild,
  activateChild,
  deactivateChild,
  listChildren,
  updateChild,
} from "../services/children.js";

const childIdParamsSchema = z.object({ id: z.string().min(1).max(128) });
const createChildSchema = z.object({
  name: z.string().trim().min(1).max(80),
  avatar: z.string().trim().min(1).max(16).default("🌟"),
  grade: z.string().trim().max(80).default(""),
});
const updateChildSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  avatar: z.string().trim().min(1).max(16).optional(),
  grade: z.string().trim().max(80).optional(),
}).refine((value) => Object.keys(value).length > 0);
const courseAccessSchema = z.object({
  courseIds: z.array(z.string().min(1).max(128)).max(500),
}).strict();

function errorResponse(code: string, message: string) {
  return { error: { code, message } };
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send(errorResponse("RESOURCE_NOT_FOUND", "Resource not found"));
}

export function registerChildrenRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.get("/api/children", { preHandler: app.requireParentUnlocked }, async (_request, reply) => {
    return reply.send(await listChildren(prisma));
  });

  app.post("/api/children", { preHandler: app.requireParentUnlocked }, async (request, reply) => {
    const parsed = createChildSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse("BAD_REQUEST", "A non-empty child name is required"));
    }
    return reply.code(201).send(await createChild(prisma, parsed.data));
  });

  app.patch("/api/children/:id", { preHandler: app.requireParentUnlocked }, async (request, reply) => {
    const params = childIdParamsSchema.safeParse(request.params);
    const body = updateChildSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send(errorResponse("BAD_REQUEST", "Child update is invalid"));
    }

    const updated = await updateChild(prisma, params.data.id, body.data);
    if (!updated) return notFound(reply);
    return reply.send(updated);
  });

  app.post("/api/children/:id/deactivate", { preHandler: app.requireParentUnlocked }, async (request, reply) => {
    const params = childIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(errorResponse("BAD_REQUEST", "Child ID is invalid"));
    }

    const deactivated = await deactivateChild(prisma, params.data.id);
    if (!deactivated) return notFound(reply);
    return reply.send(deactivated);
  });

  app.post("/api/children/:id/activate", { preHandler: app.requireParentUnlocked }, async (request, reply) => {
    const params = childIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(errorResponse("BAD_REQUEST", "Child ID is invalid"));
    }

    const activated = await activateChild(prisma, params.data.id);
    if (!activated) return notFound(reply);
    return reply.send(activated);
  });

  app.get("/api/children/:id/course-access", { preHandler: app.requireParentUnlocked }, async (request, reply) => {
    const params = childIdParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(errorResponse("BAD_REQUEST", "Child ID is invalid"));
    const child = await prisma.child.findFirst({ where: { id: params.data.id }, select: { id: true } });
    if (!child) return notFound(reply);
    const setting = await prisma.parentSetting.findUnique({
      where: { adminUserId_key: { adminUserId: request.parentSession!.adminUserId, key: `childCourses:${child.id}` } },
      select: { value: true },
    });
    let courseIds: string[] = [];
    try {
      const parsed = setting?.value ? JSON.parse(setting.value) : [];
      if (Array.isArray(parsed)) courseIds = parsed.filter((value): value is string => typeof value === "string");
    } catch { courseIds = []; }
    return reply.send({ childId: child.id, courseIds });
  });

  app.put("/api/children/:id/course-access", { preHandler: app.requireParentUnlocked }, async (request, reply) => {
    const params = childIdParamsSchema.safeParse(request.params);
    const body = courseAccessSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send(errorResponse("BAD_REQUEST", "Course access is invalid"));
    const child = await prisma.child.findFirst({ where: { id: params.data.id }, select: { id: true } });
    if (!child) return notFound(reply);
    const uniqueCourseIds = [...new Set(body.data.courseIds)];
    const courses = uniqueCourseIds.length === 0 ? [] : await prisma.course.findMany({
      where: { id: { in: uniqueCourseIds }, status: "PUBLISHED" },
      select: { id: true },
    });
    if (courses.length !== uniqueCourseIds.length) return reply.code(400).send(errorResponse("BAD_REQUEST", "Only published courses can be assigned"));
    const setting = await prisma.parentSetting.upsert({
      where: { adminUserId_key: { adminUserId: request.parentSession!.adminUserId, key: `childCourses:${child.id}` } },
      create: { adminUserId: request.parentSession!.adminUserId, key: `childCourses:${child.id}`, value: JSON.stringify(uniqueCourseIds) },
      update: { value: JSON.stringify(uniqueCourseIds) },
      select: { value: true },
    });
    return reply.send({ childId: child.id, courseIds: JSON.parse(setting.value) as string[] });
  });
}
