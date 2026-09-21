import { Prisma, type PrismaClient } from "../generated/prisma/client.js";

const courseInclude = {
  subject: { select: { name: true, slug: true } },
  videos: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      courseId: true,
      title: true,
      fileName: true,
      failureReason: true,
      durationMs: true,
      status: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.CourseInclude;

const childCourseInclude = {
  subject: { select: { name: true, slug: true } },
  videos: {
    where: { status: "READY" },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      courseId: true,
      title: true,
      fileName: true,
      durationMs: true,
      status: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.CourseInclude;

const publishCourseInclude = {
  subject: { select: { slug: true } },
} satisfies Prisma.CourseInclude;

const coverColors: Record<string, string[]> = {
  sunrise: ["#2D86F5", "#9ED8FF"],
  mountain: ["#37A7E8", "#B5ECFF"],
  planet: ["#7F6CF4", "#C4BFFF"],
  rainbow: ["#FF6C66", "#FFD5D2"],
};

type CourseDtoSource = {
  id: string;
  title: string;
  description: string | null;
  ageRange: string;
  coverStyle: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  subject: { name?: string; slug: string } | null;
  videos: Array<{
    id: string;
    courseId: string;
    title: string;
    fileName: string;
    failureReason?: string | null;
    durationMs: number | null;
    status: string;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }>;
};

function toCourseDto(course: CourseDtoSource) {
  return {
    id: course.id,
    title: course.title,
    subjectId: course.subject?.slug ?? null,
    subject: course.subject ? { slug: course.subject.slug, ...(course.subject.name ? { name: course.subject.name } : {}) } : null,
    description: course.description,
    ageRange: course.ageRange,
    cover: { style: course.coverStyle, colors: coverColors[course.coverStyle] ?? coverColors.sunrise },
    status: course.status,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    videos: course.videos.map((video) => ({
      id: video.id,
      courseId: video.courseId,
      title: video.title,
      fileName: video.fileName,
      failureReason: video.failureReason ?? null,
      filesDeleted: video.failureReason === "Video files deleted by parent",
      durationMs: video.durationMs,
      status: video.status,
      sortOrder: video.sortOrder,
      createdAt: video.createdAt,
      updatedAt: video.updatedAt,
    })),
  };
}

function toChildCourseDto(
  course: CourseDtoSource,
  progress: Array<{
    videoId: string;
    positionMs: number;
    maxProgressPercent: number;
    completed: boolean;
    updatedAt: Date;
  }>,
) {
  const courseDto = toCourseDto(course);
  const byVideoId = new Map(progress.map((item) => [item.videoId, item]));
  return {
    ...courseDto,
    videos: courseDto.videos.map(({ courseId: _courseId, ...video }) => {
      const item = byVideoId.get(video.id);
      return {
        ...video,
        progress: item ? {
          positionMs: item.positionMs,
          maxProgressPercent: item.maxProgressPercent,
          completed: item.completed,
          updatedAt: item.updatedAt,
        } : null,
      };
    }),
  };
}

export async function listCourses(prisma: PrismaClient) {
  const courses = await prisma.course.findMany({
    orderBy: { updatedAt: "desc" },
    include: courseInclude,
  });
  return courses.map(toCourseDto);
}

export async function getCourse(prisma: PrismaClient, id: string) {
  const course = await prisma.course.findUnique({ where: { id }, include: courseInclude });
  return course ? toCourseDto(course) : null;
}

export async function createCourse(
  prisma: PrismaClient,
  input: { title: string; subjectId: string; description?: string | null; ageRange?: string; coverStyle?: string },
) {
  const subject = await prisma.subject.findUnique({
    where: { slug: input.subjectId },
    select: { id: true },
  });
  if (!subject) return { kind: "invalid-subject" as const };

  const course = await prisma.course.create({
    data: {
      title: input.title,
      subjectId: subject.id,
      description: input.description ?? null,
      ageRange: input.ageRange ?? "",
      coverStyle: input.coverStyle ?? "sunrise",
      status: "DRAFT",
    },
    include: courseInclude,
  });
  return { kind: "created" as const, course: toCourseDto(course) };
}

export type UpdateCourseResult =
  | { kind: "updated"; course: ReturnType<typeof toCourseDto> }
  | { kind: "not-found" }
  | { kind: "invalid-subject" }
  | { kind: "invalid-video-order" };

export function updateCourse(
  prisma: PrismaClient,
  id: string,
  input: {
    title?: string;
    subjectId?: string;
    description?: string | null;
    ageRange?: string;
    coverStyle?: string;
    videoIds?: string[];
  },
): Promise<UpdateCourseResult> {
  return prisma.$transaction(async (transaction) => {
    const current = await transaction.course.findUnique({ where: { id }, select: { id: true } });
    if (!current) return { kind: "not-found" };

    const data: { title?: string; subjectId?: string; description?: string | null; ageRange?: string; coverStyle?: string } = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.ageRange !== undefined) data.ageRange = input.ageRange;
    if (input.coverStyle !== undefined) data.coverStyle = input.coverStyle;
    if (input.subjectId !== undefined) {
      const subject = await transaction.subject.findUnique({
        where: { slug: input.subjectId },
        select: { id: true },
      });
      if (!subject) return { kind: "invalid-subject" };
      data.subjectId = subject.id;
    }

    if (input.videoIds !== undefined) {
      if (new Set(input.videoIds).size !== input.videoIds.length) {
        return { kind: "invalid-video-order" };
      }
      const videos = await transaction.video.findMany({
        where: { courseId: id },
        select: { id: true },
      });
      const courseVideoIds = new Set(videos.map((video) => video.id));
      if (
        videos.length !== input.videoIds.length ||
        input.videoIds.some((videoId) => !courseVideoIds.has(videoId))
      ) {
        return { kind: "invalid-video-order" };
      }
      await Promise.all(input.videoIds.map((videoId, sortOrder) =>
        transaction.video.update({ where: { id: videoId }, data: { sortOrder } }),
      ));
    }

    const course = await transaction.course.update({
      where: { id },
      data,
      include: courseInclude,
    });
    return { kind: "updated", course: toCourseDto(course) };
  });
}

export type PublishCourseResult =
  | { kind: "published"; course: ReturnType<typeof toCourseDto> }
  | { kind: "not-found" }
  | { kind: "not-publishable" };

export function publishCourse(prisma: PrismaClient, id: string): Promise<PublishCourseResult> {
  return prisma.$transaction(async (transaction) => {
    // Row locks keep an existing READY video from changing status before commit.
    await transaction.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Course" WHERE "id" = ${id} FOR UPDATE
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Video" WHERE "courseId" = ${id} FOR UPDATE
    `);

    const course = await transaction.course.findUnique({
      where: { id },
      include: publishCourseInclude,
    });
    if (!course) return { kind: "not-found" };

    const videos = await transaction.video.findMany({
      where: { courseId: id },
      select: { id: true, status: true },
    });
    if (
      !course.title.trim() ||
      !course.subject?.slug ||
      !videos.some((video) => video.status === "READY")
    ) {
      return { kind: "not-publishable" };
    }

    const published = await transaction.course.update({
      where: { id },
      data: { status: "PUBLISHED" },
      include: courseInclude,
    });
    return { kind: "published", course: toCourseDto(published) };
  });
}

export async function unpublishCourse(prisma: PrismaClient, id: string) {
  const existing = await prisma.course.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return null;
  const course = await prisma.course.update({
    where: { id },
    data: { status: "UNPUBLISHED" },
    include: courseInclude,
  });
  return toCourseDto(course);
}

async function assignedCourseIds(prisma: PrismaClient, childId: string, adminUserId?: string): Promise<string[] | null> {
  if (!adminUserId) return null;
  const freeChoice = await prisma.parentSetting.findUnique({
    where: { adminUserId_key: { adminUserId, key: "freeChoice" } },
    select: { value: true },
  });
  if (freeChoice?.value !== "false") return null;
  const assigned = await prisma.parentSetting.findUnique({
    where: { adminUserId_key: { adminUserId, key: `childCourses:${childId}` } },
    select: { value: true },
  });
  try {
    const parsed = assigned?.value ? JSON.parse(assigned.value) : [];
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch { return []; }
}

export async function canChildAccessCourse(
  prisma: PrismaClient,
  childId: string,
  courseId: string,
  adminUserId: string,
): Promise<boolean> {
  const assignedIds = await assignedCourseIds(prisma, childId, adminUserId);
  return assignedIds === null || assignedIds.includes(courseId);
}

export async function listChildCourses(prisma: PrismaClient, childId: string, adminUserId?: string) {
  const assignedIds = await assignedCourseIds(prisma, childId, adminUserId);
  const courses = await prisma.course.findMany({
    where: { status: "PUBLISHED", ...(assignedIds ? { id: { in: assignedIds } } : {}) },
    orderBy: { updatedAt: "desc" },
    include: childCourseInclude,
  });
  const videoIds = courses.flatMap((course) => course.videos.map((video) => video.id));
  const progress = videoIds.length === 0
    ? []
    : await prisma.watchProgress.findMany({
      where: { childId, videoId: { in: videoIds } },
      select: {
        childId: true,
        videoId: true,
        positionMs: true,
        maxProgressPercent: true,
        completed: true,
        updatedAt: true,
      },
    });
  return courses.map((course) => toChildCourseDto(course, progress));
}

export async function getChildCourse(prisma: PrismaClient, childId: string, id: string, adminUserId?: string) {
  const assignedIds = await assignedCourseIds(prisma, childId, adminUserId);
  const course = await prisma.course.findFirst({
    where: { id, status: "PUBLISHED", ...(assignedIds ? { id: { in: assignedIds } } : {}) },
    include: childCourseInclude,
  });
  if (!course) return null;

  const progress = course.videos.length === 0
    ? []
    : await prisma.watchProgress.findMany({
      where: { childId, videoId: { in: course.videos.map((video) => video.id) } },
      select: {
        videoId: true,
        positionMs: true,
        maxProgressPercent: true,
        completed: true,
        updatedAt: true,
      },
    });
  return toChildCourseDto(course, progress);
}
