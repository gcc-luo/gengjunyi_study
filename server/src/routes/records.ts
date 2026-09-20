import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";

const querySchema = z.object({
  childId: z.string().min(1).max(128).optional(),
  subjectId: z.string().min(1).max(64).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).refine((query) => !query.from || !query.to || query.from <= query.to);

function error(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

export function registerParentRecordRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.get("/api/records", { preHandler: app.requireParentUnlocked }, async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return error(reply, 400, "BAD_REQUEST", "Record filters are invalid");
    const query = parsed.data;
    if (query.childId) {
      const child = await prisma.child.findFirst({ where: { id: query.childId, status: "ACTIVE" }, select: { id: true } });
      if (!child) return error(reply, 404, "RESOURCE_NOT_FOUND", "Child not found");
    }
    const scopedChildId = query.childId;
    const where = {
      ...(scopedChildId ? { childId: scopedChildId } : {}),
      ...(query.from || query.to ? {
        occurredAt: {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to ? { lte: new Date(query.to) } : {}),
        },
      } : {}),
      ...(query.subjectId ? { video: { course: { subject: { slug: query.subjectId } } } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.watchEvent.findMany({
        where,
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        skip: query.offset,
        take: query.limit,
        include: {
          child: { select: { id: true, name: true, avatar: true } },
          video: { include: { course: { include: { subject: { select: { slug: true, name: true } } } } } },
        },
      }),
      prisma.watchEvent.count({ where }),
    ]);
    const childIds = [...new Set(rows.map((row) => row.childId))];
    const videoIds = [...new Set(rows.map((row) => row.videoId))];
    const progress = childIds.length && videoIds.length
      ? await prisma.watchProgress.findMany({ where: { childId: { in: childIds }, videoId: { in: videoIds } } })
      : [];
    const progressByKey = new Map(progress.map((item) => [`${item.childId}:${item.videoId}`, item]));
    return reply.send({
      total,
      limit: query.limit,
      offset: query.offset,
      items: rows.map((row) => ({
        id: row.id,
        childId: row.childId,
        child: row.child,
        videoId: row.videoId,
        video: { id: row.video.id, title: row.video.title, durationMs: row.video.durationMs },
        course: row.video.course ? {
          id: row.video.course.id,
          title: row.video.course.title,
          subjectId: row.video.course.subject?.slug ?? null,
          subject: row.video.course.subject,
        } : null,
        progress: progressByKey.get(`${row.childId}:${row.videoId}`)
          ? {
            maxProgressPercent: progressByKey.get(`${row.childId}:${row.videoId}`)!.maxProgressPercent,
              positionMs: progressByKey.get(`${row.childId}:${row.videoId}`)!.positionMs,
              completed: progressByKey.get(`${row.childId}:${row.videoId}`)!.completed,
            }
          : null,
        effectiveWatchSeconds: row.watchedSeconds,
        occurredAt: row.occurredAt,
      })),
    });
  });
}
