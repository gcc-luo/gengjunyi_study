import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import { getChildCourse, listChildCourses } from "../services/courses.js";

const courseIdParamsSchema = z.object({ courseId: z.string().min(1).max(128) });

function errorResponse(code: string, message: string) {
  return { error: { code, message } };
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send(errorResponse("RESOURCE_NOT_FOUND", "Resource not found"));
}

async function requireActiveChild(request: FastifyRequest, prisma: PrismaClient, reply: FastifyReply) {
  const session = request.parentSession;
  if (!session?.activeChildId) {
    reply.code(403).send(errorResponse("ACTIVE_CHILD_REQUIRED", "An active child must be selected"));
    return null;
  }

  const child = await prisma.child.findFirst({
    where: { id: session.activeChildId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!child) {
    await prisma.session.update({ where: { id: session.id }, data: { activeChildId: null } });
    reply.code(403).send(errorResponse("ACTIVE_CHILD_REQUIRED", "An active child must be selected"));
    return null;
  }
  return child;
}

export function registerChildContentRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.get("/api/child/courses", { preHandler: app.requireParent }, async (request, reply) => {
    const child = await requireActiveChild(request, prisma, reply);
    if (!child) return reply;
    return reply.send(await listChildCourses(prisma, child.id));
  });

  app.get("/api/child/courses/:courseId", { preHandler: app.requireParent }, async (request, reply) => {
    const child = await requireActiveChild(request, prisma, reply);
    if (!child) return reply;
    const params = courseIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(errorResponse("BAD_REQUEST", "Course ID is invalid"));
    }
    const course = await getChildCourse(prisma, child.id, params.data.courseId);
    if (!course) return notFound(reply);
    return reply.send(course);
  });
}
