import { createHash } from "node:crypto";
import { vi } from "vitest";
import { buildApp } from "../../src/app";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { config, parentHeaders, sessionTokenHash } from "./route-test-utils";

export const learningChildren = [
  { id: "child-1", name: "Mina", status: "ACTIVE" as const },
  { id: "child-2", name: "Noah", status: "ACTIVE" as const },
];
export const learningCourse = { id: "course-1", title: "Number Adventure", status: "PUBLISHED" as const, subject: { slug: "math", name: "数学" } };
export const learningVideo = {
  id: "video-1",
  courseId: learningCourse.id,
  title: "Numbers",
  fileName: "numbers.mp4",
  objectKey: "videos/private-video.mp4",
  byteSize: 100n,
  durationMs: 100_000,
  status: "READY" as const,
  sortOrder: 0,
  codec: "h264/aac",
  createdAt: new Date("2026-09-16T08:00:00.000Z"),
  updatedAt: new Date("2026-09-16T08:00:00.000Z"),
};

export function makeLearningHarness(options: {
  activeChildId?: string | null;
  course?: typeof learningCourse;
  video?: typeof learningVideo;
  children?: typeof learningChildren;
  progress?: Array<any>;
  events?: Array<any>;
  favorites?: Array<any>;
  freeChoice?: boolean;
  assignedCourseIds?: string[];
} = {}) {
  const state = {
    activeChildId: options.activeChildId === undefined ? "child-1" : options.activeChildId,
    children: [...(options.children ?? learningChildren)],
    course: options.course ?? learningCourse,
    video: options.video ?? learningVideo,
    progress: [...(options.progress ?? [])],
    events: (options.events ?? []).map((event) => ({ eventType: "PROGRESS", positionMs: null, watchedSeconds: 0, occurredAt: new Date(), ...event })),
    favorites: [...(options.favorites ?? [])],
    freeChoice: options.freeChoice ?? true,
    assignedCourseIds: [...(options.assignedCourseIds ?? [])],
  };
  const adminUser = { id: "admin-1", email: "parent@example.com" };
  const session = {
    id: "session-1",
    adminUserId: adminUser.id,
    tokenHash: sessionTokenHash,
    activeChildId: state.activeChildId,
    parentUnlockedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    expiresAt: new Date(Date.now() + 60_000),
  };
  const matches = (actual: any, where: any = {}) => Object.entries(where).every(([key, expected]) => {
    if (key === "course") return matches(state.course, expected);
    if (key === "video") return matches(state.video, expected);
    if (key === "completed" && typeof expected === "boolean") return actual[key] === expected;
    if (key === "status" && typeof expected === "object" && expected !== null) {
      return expected.in ? expected.in.includes(actual[key]) : actual[key] === expected;
    }
    if (key === "occurredAt" && typeof expected === "object" && expected !== null) {
      const value = actual[key]?.getTime?.();
      return value !== undefined && (!expected.gte || value >= expected.gte.getTime()) && (!expected.lt || value < expected.lt.getTime());
    }
    if (typeof expected === "object" && expected !== null && "in" in expected) {
      return expected.in.includes(actual[key]);
    }
    if (typeof expected === "object" && expected !== null && "gte" in expected) {
      return actual[key] >= expected.gte;
    }
    return actual[key] === expected;
  });
  const client: any = {
    adminUser: { findUnique: vi.fn(async () => adminUser) },
    parentSetting: {
      findUnique: vi.fn(async ({ where }: any) => {
        const key = where.adminUserId_key?.key;
        if (key === "freeChoice") return state.freeChoice ? null : { value: "false" };
        if (key === `childCourses:${state.activeChildId}`) return { value: JSON.stringify(state.assignedCourseIds) };
        return null;
      }),
    },
    session: {
      findUnique: vi.fn(async () => ({
        ...session,
        activeChild: state.children.find((child) => child.id === session.activeChildId) ?? null,
        adminUser,
      })),
      update: vi.fn(async ({ data }: any) => Object.assign(session, data)),
    },
    child: {
      findUnique: vi.fn(async ({ where }: any) => state.children.find((child) => child.id === where.id) ?? null),
      findFirst: vi.fn(async ({ where }: any) => state.children.find((child) => matches(child, where)) ?? null),
      findMany: vi.fn(async ({ where }: any = {}) => state.children.filter((child) => matches(child, where))),
      count: vi.fn(async ({ where }: any = {}) => state.children.filter((child) => matches(child, where)).length),
    },
    course: {
      findUnique: vi.fn(async ({ where }: any) => state.course.id === where.id ? state.course : null),
      findFirst: vi.fn(async ({ where }: any) => matches(state.course, where) ? state.course : null),
      count: vi.fn(async ({ where }: any = {}) => matches(state.course, where) ? 1 : 0),
    },
    video: {
      findUnique: vi.fn(async ({ where, include }: any) => {
        if (state.video.id !== where.id) return null;
        return include?.course ? { ...state.video, course: { ...state.course, subject: state.course.subject } } : state.video;
      }),
      findFirst: vi.fn(async ({ where, include }: any) => {
        if (!matches(state.video, where) || !matches(state.course, where?.course ?? {})) return null;
        return include?.course ? { ...state.video, course: state.course } : state.video;
      }),
      findMany: vi.fn(async ({ where }: any = {}) => matches(state.video, where) && matches(state.course, where?.course ?? {}) ? [state.video] : []),
      count: vi.fn(async ({ where }: any = {}) => matches(state.video, where) && matches(state.course, where?.course ?? {}) ? 1 : 0),
    },
    watchProgress: {
      findUnique: vi.fn(async ({ where }: any) => state.progress.find((item) =>
        item.childId === where.childId_videoId.childId && item.videoId === where.childId_videoId.videoId,
      ) ?? null),
      findMany: vi.fn(async ({ where, orderBy }: any = {}) => {
        const result = state.progress.filter((item) => matches(item, where));
        if (orderBy?.updatedAt === "desc") result.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        return result;
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const found = state.progress.find((item) =>
          item.childId === where.childId_videoId.childId && item.videoId === where.childId_videoId.videoId,
        );
        if (found) return Object.assign(found, update, { updatedAt: new Date() });
        const created = { id: `progress-${state.progress.length + 1}`, ...create, updatedAt: new Date() };
        state.progress.push(created);
        return created;
      }),
      count: vi.fn(async ({ where }: any = {}) => state.progress.filter((item) => matches(item, where)).length),
    },
    watchEvent: {
      create: vi.fn(async ({ data }: any) => {
        const event = { id: `event-${state.events.length + 1}`, occurredAt: new Date(), ...data };
        state.events.push(event);
        return event;
      }),
      findMany: vi.fn(async ({ where, orderBy, take, skip }: any = {}) => {
        let result = state.events.filter((item) => matches(item, where));
        const firstOrder = Array.isArray(orderBy) ? orderBy[0] : orderBy;
        if (firstOrder?.occurredAt === "desc") result = result.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
        if (typeof skip === "number") result = result.slice(skip);
        result = typeof take === "number" ? result.slice(0, take) : result;
        return result.map((event) => ({
          ...event,
          child: state.children.find((item) => item.id === event.childId),
          video: {
            ...state.video,
            course: { ...state.course, subject: state.course.subject },
          },
        }));
      }),
      aggregate: vi.fn(async ({ where }: any = {}) => ({
        _sum: { watchedSeconds: state.events.filter((item) => matches(item, where)).reduce((sum, item) => sum + item.watchedSeconds, 0) },
      })),
      count: vi.fn(async ({ where }: any = {}) => state.events.filter((item) => matches(item, where)).length),
    },
    favorite: {
      findUnique: vi.fn(async ({ where }: any) => state.favorites.find((item) =>
        item.childId === where.childId_videoId.childId && item.videoId === where.childId_videoId.videoId,
      ) ?? null),
      findMany: vi.fn(async ({ where, orderBy }: any = {}) => {
        const result = state.favorites.filter((item) => matches(item, where));
        if (orderBy?.createdAt === "desc") result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return result.map((item) => ({ ...item, video: state.video, course: state.course }));
      }),
      create: vi.fn(async ({ data }: any) => {
        const item = { id: `favorite-${state.favorites.length + 1}`, createdAt: new Date(), ...data };
        state.favorites.push(item);
        return item;
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const before = state.favorites.length;
        state.favorites = state.favorites.filter((item) => !matches(item, where));
        return { count: before - state.favorites.length };
      }),
    },
    storageQuota: { findUnique: vi.fn(async () => ({ id: 1, maxBytes: 100_000_000_000n, usedBytes: 0n, reservedBytes: 0n })) },
    uploadSession: { findMany: vi.fn(async () => []) },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(client)),
    $disconnect: vi.fn(async () => undefined),
  };
  const storage = {
    presignGetObject: vi.fn(async () => "https://media.example.com/family/video.mp4?X-Amz-Signature=secret"),
    presignInternalGetObject: vi.fn(async () => "http://minio:9000/family/video.mp4?X-Amz-Signature=secret"),
    close: vi.fn(),
  };
  const app = buildApp({ config, prisma: client as PrismaClient, storage: storage as any });
  return { app, prisma: client, storage, state, session, adminUser };
}

export { config, parentHeaders, createHash };
