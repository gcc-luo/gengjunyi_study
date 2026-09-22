import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "../generated/prisma/client.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { MediaStorage } from "../storage/minio.js";
import { canChildAccessCourse } from "../services/courses.js";
import { ensureVideoThumbnail, thumbnailObjectKey } from "../services/media-transcoding.js";
import { z } from "zod";

const childParams = z.object({ childId: z.string().min(1).max(128) });
const videoParams = z.object({ videoId: z.string().min(1).max(128) });
const childVideoParams = childParams.extend({ videoId: z.string().min(1).max(128) });
const progressBody = z.object({
  positionMs: z.number().int().min(0).max(2_147_483_647),
  isPlaying: z.boolean(),
  watchedSeconds: z.number().int().min(0).max(30).optional(),
  eventType: z.enum(["PROGRESS", "PLAY", "PAUSE", "SEEK", "ENDED"]),
});
const favoriteBody = z.object({ videoId: z.string().min(1).max(128) });
const playbackExpiresInSeconds = 2 * 60 * 60;

function error(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

async function childCanAccessVideoCourse(
  request: FastifyRequest,
  prisma: PrismaClient,
  childId: string,
  courseId: string,
) {
  const session = request.parentSession;
  if (!session?.activeChildId) return true;
  return canChildAccessCourse(prisma, childId, courseId, session.adminUserId);
}

async function getActiveChild(
  request: FastifyRequest,
  reply: FastifyReply,
  prisma: PrismaClient,
  requestedChildId?: string,
) {
  const session = request.parentSession;
  if (!session?.activeChildId || (requestedChildId && session.activeChildId !== requestedChildId)) {
    error(reply, 403, "ACTIVE_CHILD_REQUIRED", "The currently selected child is required");
    return null;
  }
  const child = await prisma.child.findFirst({
    where: { id: session.activeChildId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!child) {
    await prisma.session.update({ where: { id: session.id }, data: { activeChildId: null } });
    error(reply, 403, "ACTIVE_CHILD_REQUIRED", "The currently selected child is unavailable");
    return null;
  }
  return child;
}

async function getFamilyChild(prisma: PrismaClient, childId: string) {
  return prisma.child.findFirst({ where: { id: childId, status: "ACTIVE" } });
}

async function getScopedChild(
  request: FastifyRequest,
  reply: FastifyReply,
  prisma: PrismaClient,
  childId: string,
) {
  const activeChildId = request.parentSession?.activeChildId;
  if (activeChildId && activeChildId !== childId) {
    error(reply, 403, "CHILD_SCOPE_MISMATCH", "This session cannot access another child's data");
    return null;
  }
  const child = await getFamilyChild(prisma, childId);
  if (!child) error(reply, 404, "RESOURCE_NOT_FOUND", "Child not found");
  return child;
}

function localDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function localDateKey(date: Date, timeZone: string) {
  const parts = localDateParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function zonedMidnightUtc(year: number, month: number, day: number, timeZone: string): Date {
  const wantedUtc = Date.UTC(year, month - 1, day);
  let candidate = wantedUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(candidate));
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const shownUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
    const delta = wantedUtc - shownUtc;
    if (delta === 0) break;
    candidate += delta;
  }
  return new Date(candidate);
}

function localDayStart(date: Date, timeZone: string, offsetDays = 0): Date {
  const parts = localDateParts(date, timeZone);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - offsetDays));
  return zonedMidnightUtc(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), timeZone);
}

function weekStart(date: Date, timeZone: string): Date {
  const parts = localDateParts(date, timeZone);
  const localDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const daysSinceMonday = (localDate.getUTCDay() + 6) % 7;
  localDate.setUTCDate(localDate.getUTCDate() - daysSinceMonday);
  return zonedMidnightUtc(localDate.getUTCFullYear(), localDate.getUTCMonth() + 1, localDate.getUTCDate(), timeZone);
}

function eventWhere(childId: string | undefined, from?: Date, until?: Date) {
  return {
    ...(childId ? { childId } : {}),
    ...(from || until ? { occurredAt: { ...(from ? { gte: from } : {}), ...(until ? { lt: until } : {}) } } : {}),
  };
}

async function videoSummary(prisma: PrismaClient, videoId: string) {
  const video = await prisma.video.findUnique({
    where: { id: videoId },
    include: { course: { include: { subject: { select: { slug: true, name: true } } } } },
  });
  if (!video) return null;
  return {
    id: video.id,
    title: video.title,
    durationMs: video.durationMs,
    status: video.status,
    course: video.course ? {
      id: video.course.id,
      title: video.course.title,
      status: video.course.status,
      subject: video.course.subject,
    } : null,
  };
}

export function registerLearningRoutes(app: FastifyInstance, prisma: PrismaClient, storage: MediaStorage, timeZone: string): void {
  app.get("/api/videos/:videoId/thumbnail", { preHandler: app.requireParent }, async (request, reply) => {
    const params = videoParams.safeParse(request.params);
    if (!params.success) return error(reply, 400, "BAD_REQUEST", "Video ID is invalid");
    const child = await getActiveChild(request, reply, prisma);
    if (!child) return;
    const video = await prisma.video.findFirst({
      where: { id: params.data.videoId, status: "READY", course: { status: "PUBLISHED" } },
      select: { id: true, courseId: true, objectKey: true },
    });
    if (!video) return error(reply, 404, "RESOURCE_NOT_FOUND", "Video thumbnail is unavailable");
    if (!await childCanAccessVideoCourse(request, prisma, child.id, video.courseId)) {
      return error(reply, 404, "RESOURCE_NOT_FOUND", "Video thumbnail is unavailable");
    }
    if (!await ensureVideoThumbnail(storage, video)) {
      return error(reply, 404, "RESOURCE_NOT_FOUND", "Video thumbnail is unavailable");
    }
    const objectKey = thumbnailObjectKey(video.id);
    return reply.redirect(await storage.presignGetObject(objectKey));
  });

  app.post("/api/videos/:videoId/playback", { preHandler: app.requireParent }, async (request, reply) => {
    const params = videoParams.safeParse(request.params);
    if (!params.success) return error(reply, 400, "BAD_REQUEST", "Video ID is invalid");
    const child = await getActiveChild(request, reply, prisma);
    if (!child) return reply;
    const video = await prisma.video.findFirst({
      where: { id: params.data.videoId, status: "READY", course: { status: "PUBLISHED" } },
      select: { id: true, courseId: true, objectKey: true },
    });
    if (!video) return error(reply, 404, "RESOURCE_NOT_FOUND", "Video is unavailable");
    if (!await childCanAccessVideoCourse(request, prisma, child.id, video.courseId)) {
      return error(reply, 404, "RESOURCE_NOT_FOUND", "Video is unavailable");
    }
    const url = await storage.presignGetObject(video.objectKey);
    return reply.send({ url, expiresInSeconds: playbackExpiresInSeconds });
  });

  app.put("/api/children/:childId/videos/:videoId/progress", { preHandler: app.requireParent }, async (request, reply) => {
    const params = childVideoParams.safeParse(request.params);
    const body = progressBody.safeParse(request.body);
    if (!params.success || !body.success) return error(reply, 400, "BAD_REQUEST", "Progress data is invalid");
    const child = await getActiveChild(request, reply, prisma, params.data.childId);
    if (!child) return reply;
    const video = await prisma.video.findFirst({
      where: { id: params.data.videoId, status: "READY", course: { status: "PUBLISHED" } },
      select: { id: true, courseId: true, durationMs: true },
    });
    if (!video || !video.durationMs || video.durationMs < 1) return error(reply, 404, "RESOURCE_NOT_FOUND", "Video is unavailable");
    if (!await childCanAccessVideoCourse(request, prisma, child.id, video.courseId)) {
      return error(reply, 404, "RESOURCE_NOT_FOUND", "Video is unavailable");
    }
    if (body.data.positionMs > video.durationMs) return error(reply, 400, "POSITION_OUT_OF_RANGE", "Position exceeds the video duration");

    const result = await prisma.$transaction(async (tx) => {
      // Serialize a child's progress writes so maxProgressPercent cannot move backwards under concurrent heartbeats.
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Child" WHERE "id" = ${child.id} FOR UPDATE`);
      const key = { childId_videoId: { childId: child.id, videoId: video.id } };
      const existing = await tx.watchProgress.findUnique({ where: key });
      const percent = Math.min(100, Math.floor((body.data.positionMs / video.durationMs!) * 100));
      const maxProgressPercent = Math.max(existing?.maxProgressPercent ?? 0, percent);
      const completed = Boolean(existing?.completed || maxProgressPercent >= 90);
      const progress = await tx.watchProgress.upsert({
        where: key,
        create: {
          childId: child.id,
          videoId: video.id,
          positionMs: body.data.positionMs,
          maxProgressPercent,
          completed,
        },
        update: { positionMs: body.data.positionMs, maxProgressPercent, completed },
      });
      const previousEvents = await tx.watchEvent.findMany({
        where: { childId: child.id, videoId: video.id },
        orderBy: { occurredAt: "desc" },
        take: 1,
        select: { occurredAt: true },
      });
      const elapsed = previousEvents[0]
        ? Math.max(0, Math.floor((Date.now() - previousEvents[0].occurredAt.getTime()) / 1000))
        : 0;
      // Heartbeats are server-timed; a PAUSE may also carry the few seconds
      // accumulated since the last heartbeat, while PLAY/SEEK/ENDED carry no
      // billable time by themselves.
      const watchedSeconds = body.data.eventType === "PAUSE" || body.data.eventType === "ENDED"
        ? Math.min(30, body.data.watchedSeconds ?? 0, elapsed)
        : body.data.isPlaying
          ? Math.min(30, elapsed)
          : 0;
      await tx.watchEvent.create({
        data: {
          childId: child.id,
          videoId: video.id,
          eventType: body.data.eventType,
          positionMs: body.data.positionMs,
          watchedSeconds,
        },
      });
      return { progress, watchedSeconds };
    });
    return reply.send({ progress: result.progress, recordedWatchedSeconds: result.watchedSeconds });
  });

  app.get("/api/children/:childId/favorites", { preHandler: app.requireParent }, async (request, reply) => {
    const params = childParams.safeParse(request.params);
    if (!params.success) return error(reply, 400, "BAD_REQUEST", "Child ID is invalid");
    const child = await getScopedChild(request, reply, prisma, params.data.childId);
    if (!child) return reply;
    const favorites = await prisma.favorite.findMany({
      where: { childId: child.id, video: { status: "READY", course: { status: "PUBLISHED" } } },
      orderBy: { createdAt: "desc" },
      include: { video: { include: { course: { include: { subject: { select: { slug: true, name: true } } } } } } },
    });
    const visibleFavorites = request.parentSession?.activeChildId
      ? (await Promise.all(favorites.map(async (favorite) => ({
        favorite,
        visible: await childCanAccessVideoCourse(request, prisma, child.id, favorite.video.courseId),
      })))).filter((item) => item.visible).map((item) => item.favorite)
      : favorites;
    return reply.send(visibleFavorites.map((favorite) => ({
      id: favorite.id,
      childId: favorite.childId,
      videoId: favorite.videoId,
      createdAt: favorite.createdAt,
      video: {
        id: favorite.video.id,
        title: favorite.video.title,
        fileName: favorite.video.fileName,
        durationMs: favorite.video.durationMs,
        status: favorite.video.status,
        course: favorite.video.course ? {
          id: favorite.video.course.id,
          title: favorite.video.course.title,
          subject: favorite.video.course.subject,
        } : null,
      },
    })));
  });

  app.put("/api/children/:childId/favorites", { preHandler: app.requireParent }, async (request, reply) => {
    const params = childParams.safeParse(request.params);
    const body = favoriteBody.safeParse(request.body);
    if (!params.success || !body.success) return error(reply, 400, "BAD_REQUEST", "Favorite data is invalid");
    const child = await getScopedChild(request, reply, prisma, params.data.childId);
    if (!child) return reply;
    const video = await prisma.video.findFirst({
      where: { id: body.data.videoId, status: "READY", course: { status: "PUBLISHED" } },
      select: { id: true, courseId: true },
    });
    if (!video) return error(reply, 404, "RESOURCE_NOT_FOUND", "Video is unavailable");
    if (!await childCanAccessVideoCourse(request, prisma, child.id, video.courseId)) {
      return error(reply, 404, "RESOURCE_NOT_FOUND", "Video is unavailable");
    }
    const key = { childId_videoId: { childId: child.id, videoId: video.id } };
    const existing = await prisma.favorite.findUnique({ where: key });
    if (existing) return reply.send(existing);
    try {
      const favorite = await prisma.favorite.create({ data: { childId: child.id, videoId: video.id } });
      return reply.code(201).send(favorite);
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
        const favorite = await prisma.favorite.findUnique({ where: key });
        if (favorite) return reply.send(favorite);
      }
      throw cause;
    }
  });

  app.delete("/api/children/:childId/favorites", { preHandler: app.requireParent }, async (request, reply) => {
    const params = childParams.safeParse(request.params);
    const body = favoriteBody.safeParse(request.body);
    if (!params.success || !body.success) return error(reply, 400, "BAD_REQUEST", "Favorite data is invalid");
    const child = await getScopedChild(request, reply, prisma, params.data.childId);
    if (!child) return reply;
    await prisma.favorite.deleteMany({ where: { childId: child.id, videoId: body.data.videoId } });
    return reply.code(204).send();
  });

  app.get("/api/children/:childId/records", { preHandler: app.requireParent }, async (request, reply) => {
    const params = childParams.safeParse(request.params);
    if (!params.success) return error(reply, 400, "BAD_REQUEST", "Child ID is invalid");
    const child = await getScopedChild(request, reply, prisma, params.data.childId);
    if (!child) return reply;
    const [progressRows, events, aggregate] = await Promise.all([
      prisma.watchProgress.findMany({ where: { childId: child.id }, orderBy: { updatedAt: "desc" } }),
      prisma.watchEvent.findMany({ where: { childId: child.id }, orderBy: { occurredAt: "desc" }, take: 20 }),
      prisma.watchEvent.aggregate({ where: { childId: child.id }, _sum: { watchedSeconds: true } }),
    ]);
    const videos = await Promise.all(progressRows.map(async (item) => ({
      videoId: item.videoId,
      video: await videoSummary(prisma, item.videoId),
      positionMs: item.positionMs,
      maxProgressPercent: item.maxProgressPercent,
      completed: item.completed,
      updatedAt: item.updatedAt,
    })));
    const recentActivity = await Promise.all(events.map(async (event) => ({
      id: event.id,
      videoId: event.videoId,
      video: await videoSummary(prisma, event.videoId),
      eventType: event.eventType,
      positionMs: event.positionMs,
      watchedSeconds: event.watchedSeconds,
      occurredAt: event.occurredAt,
    })));
    return reply.send({
      childId: child.id,
      totalWatchedSeconds: aggregate._sum.watchedSeconds ?? 0,
      completedVideos: progressRows.filter((item) => item.completed).length,
      videos,
      recentActivity,
    });
  });

  app.get("/api/overview", { preHandler: app.requireParentUnlocked }, async (request, reply) => {
    const now = new Date();
    const todayStart = localDayStart(now, timeZone);
    const tomorrowStart = localDayStart(now, timeZone, -1);
    const thisWeekStart = weekStart(now, timeZone);
    // Parent overview is family-wide. The selected child is only a playback/content scope,
    // and must not silently hide another child's activity from the management dashboard.
    const childWhere = {};
    const [children, courses, readyVideos, allWatchTime, todayWatchTime, todayEvents, weekWatchTime, completedRows, recentRows, progressRows] = await Promise.all([
      prisma.child.count({ where: { status: "ACTIVE" } }),
      prisma.course.count({ where: { status: "PUBLISHED" } }),
      prisma.video.count({ where: { status: "READY", course: { status: "PUBLISHED" } } }),
      prisma.watchEvent.aggregate({ where: childWhere, _sum: { watchedSeconds: true } }),
      prisma.watchEvent.aggregate({ where: eventWhere(undefined, todayStart, tomorrowStart), _sum: { watchedSeconds: true } }),
      prisma.watchEvent.count({ where: eventWhere(undefined, todayStart, tomorrowStart) }),
      prisma.watchEvent.aggregate({ where: eventWhere(undefined, thisWeekStart), _sum: { watchedSeconds: true } }),
      prisma.watchProgress.findMany({ where: { ...childWhere, completed: true }, select: { id: true } }),
      prisma.watchEvent.findMany({ where: childWhere, orderBy: { occurredAt: "desc" }, take: 10 }),
      prisma.watchProgress.findMany({ where: { ...childWhere, completed: false }, orderBy: { updatedAt: "desc" }, take: 10 }),
    ]);
    const recentActivity = await Promise.all(recentRows.map(async (event) => ({
      id: event.id,
      childId: event.childId,
      videoId: event.videoId,
      video: await videoSummary(prisma, event.videoId),
      watchedSeconds: event.watchedSeconds,
      occurredAt: event.occurredAt,
    })));
    const continueLearning = await Promise.all(progressRows.map(async (progress) => ({
      videoId: progress.videoId,
      video: await videoSummary(prisma, progress.videoId),
      childId: progress.childId,
      positionMs: progress.positionMs,
      maxProgressPercent: progress.maxProgressPercent,
      updatedAt: progress.updatedAt,
    })));
    const dailyActivity = await Promise.all(Array.from({ length: 7 }, async (_, index) => {
      const daysAgo = 6 - index;
      const startsAt = localDayStart(now, timeZone, daysAgo);
      const endsAt = localDayStart(now, timeZone, daysAgo - 1);
      const aggregate = await prisma.watchEvent.aggregate({
        where: eventWhere(undefined, startsAt, endsAt),
        _sum: { watchedSeconds: true },
      });
      return {
        date: localDateKey(startsAt, timeZone),
        watchedSeconds: aggregate._sum.watchedSeconds ?? 0,
      };
    }));
    return reply.send({
      totals: {
        children,
        courses,
        readyVideos,
        watchedSeconds: allWatchTime._sum.watchedSeconds ?? 0,
        completedVideos: completedRows.length,
      },
      today: { watchedSeconds: todayWatchTime._sum.watchedSeconds ?? 0, events: todayEvents },
      week: { watchedSeconds: weekWatchTime._sum.watchedSeconds ?? 0, startsAt: thisWeekStart },
      dailyActivity,
      recentActivity,
      continueLearning,
    });
  });
}
