import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  createCourse,
  getCourse,
  listCourses,
  publishCourse,
  unpublishCourse,
  updateCourse,
} from "../services/courses.js";

const courseIdParamsSchema = z.object({ courseId: z.string().min(1).max(128) });
const createCourseSchema = z.object({
  title: z.string().trim().max(200).default(""),
  subjectId: z.string().trim().min(1).max(64),
  description: z.string().max(5000).nullable().optional(),
  ageRange: z.string().trim().max(80).default(""),
  coverStyle: z.enum(["sunrise", "mountain", "planet", "rainbow"]).default("sunrise"),
});
const updateCourseSchema = z.object({
  title: z.string().trim().max(200).optional(),
  subjectId: z.string().trim().min(1).max(64).optional(),
  description: z.string().max(5000).nullable().optional(),
  ageRange: z.string().trim().max(80).optional(),
  coverStyle: z.enum(["sunrise", "mountain", "planet", "rainbow"]).optional(),
  videoIds: z.array(z.string().min(1).max(128)).max(500).optional(),
}).refine((value) => Object.keys(value).length > 0);

function errorResponse(code: string, message: string) {
  return { error: { code, message } };
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send(errorResponse("RESOURCE_NOT_FOUND", "Resource not found"));
}

export function registerCourseRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.get("/api/courses", { preHandler: app.requireParentUnlocked }, async (_request, reply) => {
    return reply.send(await listCourses(prisma));
  });

  app.post("/api/courses", { preHandler: app.requireParentUnlocked }, async (request, reply) => {
    const parsed = createCourseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse("BAD_REQUEST", "Course details are invalid"));
    }
    const result = await createCourse(prisma, parsed.data);
    if (result.kind === "invalid-subject") {
      return reply.code(400).send(errorResponse("BAD_REQUEST", "A valid subject is required"));
    }
    return reply.code(201).send(result.course);
  });

  app.get("/api/courses/:courseId", { preHandler: app.requireParentUnlocked }, async (request, reply) => {
    const params = courseIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(errorResponse("BAD_REQUEST", "Course ID is invalid"));
    }
    const course = await getCourse(prisma, params.data.courseId);
    if (!course) return notFound(reply);
    return reply.send(course);
  });

  app.patch("/api/courses/:courseId", { preHandler: app.requireParentUnlocked }, async (request, reply) => {
    const params = courseIdParamsSchema.safeParse(request.params);
    const body = updateCourseSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send(errorResponse("BAD_REQUEST", "Course update is invalid"));
    }
    const result = await updateCourse(prisma, params.data.courseId, body.data);
    if (result.kind === "not-found") return notFound(reply);
    if (result.kind === "invalid-subject") {
      return reply.code(400).send(errorResponse("BAD_REQUEST", "A valid subject is required"));
    }
    if (result.kind === "invalid-video-order") {
      return reply.code(400).send(errorResponse("BAD_REQUEST", "Video order is invalid"));
    }
    return reply.send(result.course);
  });

  app.post("/api/courses/:courseId/publish", { preHandler: app.requireParentUnlocked }, async (request, reply) => {
    const params = courseIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(errorResponse("BAD_REQUEST", "Course ID is invalid"));
    }
    const result = await publishCourse(prisma, params.data.courseId);
    if (result.kind === "not-found") return notFound(reply);
    if (result.kind === "not-publishable") {
      return reply.code(422).send(errorResponse(
        "COURSE_NOT_PUBLISHABLE",
        "Course needs a title, a valid subject, and at least one READY video",
      ));
    }
    return reply.send(result.course);
  });

  app.post("/api/courses/:courseId/unpublish", { preHandler: app.requireParentUnlocked }, async (request, reply) => {
    const params = courseIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(errorResponse("BAD_REQUEST", "Course ID is invalid"));
    }
    const course = await unpublishCourse(prisma, params.data.courseId);
    if (!course) return notFound(reply);
    return reply.send(course);
  });
}
