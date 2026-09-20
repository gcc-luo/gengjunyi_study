import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, vi } from "vitest";
import { buildApp } from "../../src/app";
import type { AppConfig } from "../../src/config";
import { createSessionCsrfToken } from "../../src/plugins/auth";
import type { PrismaClient } from "../../src/generated/prisma/client";

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  const apps = openApps.splice(0);
  await Promise.all(apps.map((app) => app.close()));
});

export const config: AppConfig = {
  nodeEnv: "test",
  port: 3000,
  sessionCookieName: "fl_parent_session",
  sessionLifetimeSeconds: 7 * 24 * 60 * 60,
  secureCookies: false,
  authBypass: false,
  databaseUrl:
    "postgresql://family_learning_test:family_learning_test_local_only@127.0.0.1:15432/family_learning_test",
  trustedProxies: [],
  minio: {
    endpoint: "localhost",
    port: 9000,
    useSsl: false,
    accessKey: "test-access-key",
    secretKey: "test-secret-key",
    bucket: "family-learning-videos",
    publicUrl: "http://localhost:19000",
  },
  appOrigin: "http://localhost:5173",
  appAllowedOrigins: ["http://localhost:5173"],
  appTimezone: "Asia/Shanghai",
  sessionSecret: "test-session-secret-that-is-long-enough",
};

export const sessionToken = "S".repeat(43);
export const sessionTokenHash = createHash("sha256").update(sessionToken).digest("hex");
export const parentHeaders = {
  origin: config.appOrigin,
  "x-csrf-token": createSessionCsrfToken(config.sessionSecret, sessionTokenHash),
  cookie: `${config.sessionCookieName}=${sessionToken}`,
};

export type ChildRecord = {
  id: string;
  name: string;
  avatar: string;
  grade: string;
  status: "ACTIVE" | "DISABLED";
  createdAt: Date;
  updatedAt: Date;
};
export type SubjectRecord = { id: string; name: string; slug: string };
export type CourseRecord = {
  id: string;
  subjectId: string;
  title: string;
  description: string | null;
  ageRange: string;
  coverStyle: string;
  status: "DRAFT" | "PUBLISHED" | "UNPUBLISHED";
  createdAt: Date;
  updatedAt: Date;
};
export type VideoRecord = {
  id: string;
  courseId: string;
  title: string;
  objectKey: string;
  fileName: string;
  byteSize: bigint;
  durationMs: number | null;
  codec: string | null;
  status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED" | "ARCHIVED";
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};
export type ProgressRecord = {
  childId: string;
  videoId: string;
  positionMs: number;
  maxProgressPercent: number;
  completed: boolean;
  updatedAt: Date;
};

export type RouteState = {
  children: ChildRecord[];
  sessions: Array<{
    id: string;
    adminUserId: string;
    activeChildId: string | null;
    parentUnlockedUntil: Date | null;
    tokenHash: string;
    expiresAt: Date;
  }>;
  subjects: SubjectRecord[];
  courses: CourseRecord[];
  videos: VideoRecord[];
  progress: ProgressRecord[];
  events: Array<{ id: string; childId: string; videoId: string }>;
  favorites: Array<{ id: string; childId: string; videoId: string }>;
};

const now = new Date("2026-09-17T00:00:00.000Z");
export const activeChild: ChildRecord = {
  id: "child-1",
  name: "Mina",
  avatar: "🌟",
  grade: "",
  status: "ACTIVE",
  createdAt: now,
  updatedAt: now,
};
export const mathSubject: SubjectRecord = { id: "subject-math", name: "数学", slug: "math" };
export const scienceSubject: SubjectRecord = { id: "subject-science", name: "科学", slug: "science" };

export function courseRecord(overrides: Partial<CourseRecord> = {}): CourseRecord {
  return {
    id: "course-1",
    subjectId: mathSubject.id,
    title: "Number Adventure",
    description: "Learn numbers",
    ageRange: "",
    coverStyle: "sunrise",
    status: "DRAFT",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function videoRecord(overrides: Partial<VideoRecord> = {}): VideoRecord {
  return {
    id: "video-1",
    courseId: "course-1",
    title: "Numbers",
    objectKey: "private/course-1/video-1.mp4",
    fileName: "numbers.mp4",
    byteSize: BigInt(1024),
    durationMs: 120_000,
    codec: "h264",
    status: "READY",
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makePrisma(options: {
  children?: ChildRecord[];
  activeChildId?: string | null;
  subjects?: SubjectRecord[];
  courses?: CourseRecord[];
  videos?: VideoRecord[];
  progress?: ProgressRecord[];
  events?: RouteState["events"];
  favorites?: RouteState["favorites"];
} = {}) {
  const state: RouteState = {
    children: [...(options.children ?? [])],
    sessions: [{
      id: "session-1",
      adminUserId: "admin-1",
      activeChildId: options.activeChildId ?? null,
      parentUnlockedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
      tokenHash: sessionTokenHash,
      expiresAt: new Date(Date.now() + 60_000),
    }],
    subjects: [...(options.subjects ?? [mathSubject, scienceSubject])],
    courses: [...(options.courses ?? [])],
    videos: [...(options.videos ?? [])],
    progress: [...(options.progress ?? [])],
    events: [...(options.events ?? [])],
    favorites: [...(options.favorites ?? [])],
  };
  const adminUser = { id: "admin-1", email: "parent@example.com" };
  const includedCourse = (course: CourseRecord, include: any = {}) => {
    const subject = state.subjects.find((candidate) => candidate.id === course.subjectId) ?? null;
    const videoInclude = include.videos;
    const videos = state.videos
      .filter((video) => video.courseId === course.id)
      .filter((video) => !videoInclude?.where?.status || video.status === videoInclude.where.status)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return { ...course, subject, videos };
  };
  const client = {
    adminUser: {
      findUnique: vi.fn(async () => adminUser),
    },
    session: {
      findUnique: vi.fn(async ({ where, include }: any) => {
        const session = state.sessions.find((candidate) => candidate.tokenHash === where.tokenHash);
        if (!session) return null;
        const active = state.children.find((child) => child.id === session.activeChildId) ?? null;
        return include
          ? { ...session, adminUser, activeChild: active }
          : session;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const session = state.sessions.find((candidate) => candidate.id === where.id);
        if (!session) throw new Error("Session not found");
        Object.assign(session, data);
        return session;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const session of state.sessions) {
          if (where.activeChildId === session.activeChildId) {
            Object.assign(session, data);
            count += 1;
          }
        }
        return { count };
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    child: {
      findMany: vi.fn(async ({ where }: any = {}) => state.children
        .filter((child) => !where?.status || child.status === where.status)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())),
      findUnique: vi.fn(async ({ where }: any) => state.children.find((child) => child.id === where.id) ?? null),
      findFirst: vi.fn(async ({ where }: any) => state.children.find((child) =>
        (!where?.id || child.id === where.id) && (!where?.status || child.status === where.status),
      ) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const created: ChildRecord = { ...data, id: `child-${state.children.length + 1}`, createdAt: now, updatedAt: now };
        state.children.push(created);
        return created;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const child = state.children.find((candidate) => candidate.id === where.id);
        if (!child) throw new Error("Child not found");
        Object.assign(child, data, { updatedAt: now });
        return child;
      }),
    },
    subject: {
      findUnique: vi.fn(async ({ where }: any) => state.subjects.find((subject) =>
        where.slug !== undefined ? subject.slug === where.slug : subject.id === where.id,
      ) ?? null),
    },
    course: {
      findMany: vi.fn(async ({ where, include }: any = {}) => state.courses
        .filter((course) => !where?.status || course.status === where.status)
        .filter((course) => !where?.id?.in || where.id.in.includes(course.id))
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .map((course) => include ? includedCourse(course, include) : course)),
      findUnique: vi.fn(async ({ where, include }: any) => {
        const course = state.courses.find((candidate) => candidate.id === where.id);
        return course ? (include ? includedCourse(course, include) : course) : null;
      }),
      findFirst: vi.fn(async ({ where, include }: any) => {
        const course = state.courses.find((candidate) =>
          (!where?.id || candidate.id === where.id) &&
          (!where?.status || candidate.status === where.status),
        );
        return course ? (include ? includedCourse(course, include) : course) : null;
      }),
      create: vi.fn(async ({ data, include }: any) => {
        const created = courseRecord({ ...data, id: `course-${state.courses.length + 1}`, status: "DRAFT" });
        state.courses.push(created);
        return include ? includedCourse(created, include) : created;
      }),
      update: vi.fn(async ({ where, data, include }: any) => {
        const course = state.courses.find((candidate) => candidate.id === where.id);
        if (!course) throw new Error("Course not found");
        Object.assign(course, data, { updatedAt: now });
        return include ? includedCourse(course, include) : course;
      }),
    },
    video: {
      findUnique: vi.fn(async ({ where }: any) => state.videos.find((video) => video.id === where.id) ?? null),
      findMany: vi.fn(async ({ where, orderBy }: any = {}) => state.videos
        .filter((video) => !where?.courseId || video.courseId === where.courseId)
        .filter((video) => !where?.status || video.status === where.status)
        .filter((video) => !where?.id?.in || where.id.in.includes(video.id))
        .sort((a, b) => a.sortOrder - b.sortOrder)),
      update: vi.fn(async ({ where, data, select }: any) => {
        const video = state.videos.find((candidate) => candidate.id === where.id);
        if (!video) throw new Error("Video not found");
        Object.assign(video, data, { updatedAt: now });
        return select ? Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, (video as any)[key]])) : video;
      }),
    },
    watchProgress: {
      findMany: vi.fn(async ({ where }: any = {}) => state.progress
        .filter((item) => !where?.childId || item.childId === where.childId)
        .filter((item) => !where?.videoId?.in || where.videoId.in.includes(item.videoId))),
    },
    parentSetting: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async ({ create, update }: any) => ({ value: update?.value ?? create?.value })),
    },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(client)),
    $disconnect: vi.fn(async () => undefined),
  };
  return { prisma: client as unknown as PrismaClient, state, raw: client };
}

export function useRouteApp(prisma: PrismaClient) {
  const app = buildApp({ config, prisma });
  openApps.push(app);
  return app;
}
