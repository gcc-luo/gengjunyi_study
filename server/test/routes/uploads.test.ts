import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app";
import { createAnonymousCsrfToken } from "../../src/plugins/auth";
import { expireOldUploads } from "../../src/services/uploads";
import { config, parentHeaders, sessionTokenHash } from "./route-test-utils";

function uploadHarness(options: { usedBytes?: bigint; reservedBytes?: bigint } = {}) {
  const state = {
    quota: {
      id: 1,
      maxBytes: 100_000_000_000n,
      usedBytes: options.usedBytes ?? 0n,
      reservedBytes: options.reservedBytes ?? 0n,
    },
    video: null as any,
    upload: null as any,
  };
  const now = new Date();
  const prisma = {
    adminUser: { findUnique: vi.fn(async () => ({ id: "admin-1", email: "parent@example.com" })) },
    session: {
      findUnique: vi.fn(async () => ({
        id: "session-1",
        adminUserId: "admin-1",
        activeChildId: null,
        tokenHash: sessionTokenHash,
        expiresAt: new Date(Date.now() + 60_000),
        adminUser: { id: "admin-1", email: "parent@example.com" },
        activeChild: null,
      })),
    },
    course: {
      findUnique: vi.fn(async ({ where }: any) => where.id === "course-1"
        ? { id: "course-1", title: "Course", status: "DRAFT" }
        : null),
    },
    storageQuota: {
      findUnique: vi.fn(async () => ({ ...state.quota })),
      update: vi.fn(async ({ data }: any) => {
        for (const key of ["usedBytes", "reservedBytes"] as const) {
          const change = data[key];
          if (change?.increment !== undefined) state.quota[key] += BigInt(change.increment);
          else if (change?.decrement !== undefined) state.quota[key] -= BigInt(change.decrement);
          else if (change !== undefined) state.quota[key] = BigInt(change);
        }
        return state.quota;
      }),
    },
    video: {
      create: vi.fn(async ({ data }: any) => {
        state.video = { id: "video-1", ...data, createdAt: now, updatedAt: now };
        return state.video;
      }),
      update: vi.fn(async ({ data }: any) => Object.assign(state.video, data)),
      findUnique: vi.fn(async () => state.video),
      findMany: vi.fn(async () => state.video ? [{ sortOrder: state.video.sortOrder ?? 0 }] : []),
      delete: vi.fn(async () => { const deleted = state.video; state.video = null; return deleted; }),
    },
    uploadSession: {
      create: vi.fn(async ({ data }: any) => {
        state.upload = { id: "upload-1", status: "ACTIVE", ...data, createdAt: now, updatedAt: now };
        return state.upload;
      }),
      findUnique: vi.fn(async () => state.upload),
      update: vi.fn(async ({ data }: any) => Object.assign(state.upload, data)),
      findMany: vi.fn(async () => state.upload?.expiresAt.getTime() <= Date.now() ? [state.upload] : []),
    },
    watchProgress: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    watchEvent: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    favorite: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma)),
    $disconnect: vi.fn(async () => undefined),
  };
  const storage = {
    createMultipartUpload: vi.fn(async () => "minio-upload-1"),
    presignUploadPart: vi.fn(async (_key: string, _uploadId: string, partNumber: number) =>
      `https://media.example.com/bucket/key?partNumber=${partNumber}&signature=secret`),
    listParts: vi.fn(async () => [{ partNumber: 1, etag: '"etag-1"', size: 100 }]),
    completeMultipartUpload: vi.fn(async () => undefined),
    abortMultipartUpload: vi.fn(async () => undefined),
    headObject: vi.fn(async () => ({ byteSize: 100n, contentType: "video/mp4" })),
    presignGetObject: vi.fn(async () => "https://media.example.com/private?signature=secret"),
    presignInternalGetObject: vi.fn(async () => "http://minio:9000/internal?signature=secret"),
    deleteObject: vi.fn(async () => undefined),
    ensureBucket: vi.fn(async () => undefined),
    close: vi.fn(),
  };
  const validateMedia = vi.fn(async () => ({
    valid: true as const,
    durationMs: 3000,
    videoCodec: "h264",
    audioCodec: "aac",
  }));
  const app = buildApp({
    config,
    prisma: prisma as any,
    storage: storage as any,
    validateMedia,
  });
  return { app, prisma, storage, state, validateMedia };
}

describe("resumable uploads", () => {
  const openApps: Array<ReturnType<typeof buildApp>> = [];
  afterEach(async () => {
    await Promise.all(openApps.splice(0).map((app) => app.close()));
  });

  it("requires a parent session to create an upload", async () => {
    const harness = uploadHarness();
    openApps.push(harness.app);

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/courses/course-1/uploads",
      headers: {
        origin: config.appOrigin,
        "x-csrf-token": createAnonymousCsrfToken(config.sessionSecret),
      },
      payload: { fileName: "lesson.mp4", sizeBytes: 100 },
    });

    expect(response.statusCode).toBe(401);
    expect(harness.storage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong extension", "lesson.mov", 100],
    ["zero size", "lesson.mp4", 0],
    ["negative size", "lesson.mp4", -1],
  ])("rejects %s before reserving quota", async (_reason, fileName, sizeBytes) => {
    const harness = uploadHarness();
    openApps.push(harness.app);

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/courses/course-1/uploads",
      headers: parentHeaders,
      payload: { fileName, sizeBytes },
    });

    expect(response.statusCode).toBe(400);
    expect(harness.state.quota.reservedBytes).toBe(0n);
    expect(harness.storage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it("reserves quota atomically and signs a part against the browser-facing MinIO URL", async () => {
    const harness = uploadHarness();
    openApps.push(harness.app);

    const created = await harness.app.inject({
      method: "POST",
      url: "/api/courses/course-1/uploads",
      headers: parentHeaders,
      payload: { fileName: "lesson.mp4", sizeBytes: 16 * 1024 * 1024 + 1 },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ uploadId: "upload-1", partCount: 2 });
    expect(harness.state.quota.reservedBytes).toBe(16n * 1024n * 1024n + 1n);

    const signed = await harness.app.inject({
      method: "POST",
      url: "/api/uploads/upload-1/parts/2/url",
      headers: parentHeaders,
      payload: {},
    });

    expect(signed.statusCode).toBe(200);
    expect(signed.json().url).toMatch(/^https:\/\/media\.example\.com\//);
    expect(signed.json().expiresInSeconds).toBe(900);
  });

  it("assigns a distinct display order to each file added to a course", async () => {
    const harness = uploadHarness();
    openApps.push(harness.app);
    const create = (fileName: string) => harness.app.inject({
      method: "POST",
      url: "/api/courses/course-1/uploads",
      headers: parentHeaders,
      payload: { fileName, sizeBytes: 100 },
    });

    expect((await create("lesson-1.mp4")).statusCode).toBe(201);
    expect((await create("lesson-2.mp4")).statusCode).toBe(201);
    expect(harness.prisma.video.create.mock.calls.map(([input]: any[]) => input.data.sortOrder)).toEqual([0, 1]);
  });

  it("rejects actual object bytes above the reservation and deletes the object", async () => {
    const harness = uploadHarness();
    openApps.push(harness.app);
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/courses/course-1/uploads",
      headers: parentHeaders,
      payload: { fileName: "lesson.mp4", sizeBytes: 99 },
    });
    expect(created.statusCode).toBe(201);
    harness.storage.headObject.mockResolvedValue({ byteSize: 100n, contentType: "video/mp4" });

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/uploads/upload-1/complete",
      headers: parentHeaders,
      payload: {},
    });

    expect(response.statusCode).toBe(422);
    expect(harness.storage.deleteObject).toHaveBeenCalledOnce();
    expect(harness.state.quota.reservedBytes).toBe(0n);
    expect(harness.validateMedia).not.toHaveBeenCalled();
  });

  it("completes a valid upload, settles the reservation and marks the video READY", async () => {
    const harness = uploadHarness();
    openApps.push(harness.app);
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/courses/course-1/uploads",
      headers: parentHeaders,
      payload: { fileName: "lesson.mp4", sizeBytes: 100 },
    });
    expect(created.statusCode).toBe(201);

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/uploads/upload-1/complete",
      headers: parentHeaders,
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("READY");
    expect(harness.state.quota.usedBytes).toBe(100n);
    expect(harness.state.quota.reservedBytes).toBe(0n);
    expect(harness.state.video.status).toBe("READY");
    expect(harness.storage.presignInternalGetObject).toHaveBeenCalledOnce();
  });

  it("releases reserved bytes when an upload is cancelled", async () => {
    const harness = uploadHarness();
    openApps.push(harness.app);
    await harness.app.inject({
      method: "POST",
      url: "/api/courses/course-1/uploads",
      headers: parentHeaders,
      payload: { fileName: "lesson.mp4", sizeBytes: 100 },
    });

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/uploads/upload-1/cancel",
      headers: parentHeaders,
      payload: {},
    });

    expect(response.statusCode).toBe(204);
    expect(harness.storage.abortMultipartUpload).toHaveBeenCalledOnce();
    expect(harness.state.quota.reservedBytes).toBe(0n);
    expect(harness.state.upload.status).toBe("ABORTED");
  });

  it("expires a seven-day inactive multipart and releases its quota reservation", async () => {
    const harness = uploadHarness();
    openApps.push(harness.app);
    await harness.app.inject({
      method: "POST",
      url: "/api/courses/course-1/uploads",
      headers: parentHeaders,
      payload: { fileName: "lesson.mp4", sizeBytes: 100 },
    });
    harness.state.upload.expiresAt = new Date(0);

    const count = await expireOldUploads(harness.prisma, harness.storage as any, new Date());

    expect(count).toBe(1);
    expect(harness.storage.abortMultipartUpload).toHaveBeenCalledOnce();
    expect(harness.state.quota.reservedBytes).toBe(0n);
    expect(harness.state.upload.status).toBe("EXPIRED");
  });

  it("removes invalid media without leaving a stale quota charge", async () => {
    const harness = uploadHarness();
    openApps.push(harness.app);
    await harness.app.inject({
      method: "POST",
      url: "/api/courses/course-1/uploads",
      headers: parentHeaders,
      payload: { fileName: "lesson.mp4", sizeBytes: 100 },
    });
    harness.validateMedia.mockResolvedValue({ valid: false, reason: "The video must use H.264 encoding" });

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/uploads/upload-1/complete",
      headers: parentHeaders,
      payload: {},
    });

    expect(response.statusCode).toBe(422);
    expect(harness.storage.deleteObject).toHaveBeenCalledOnce();
    expect(harness.state.quota.usedBytes).toBe(0n);
    expect(harness.state.video.byteSize).toBe(0n);
    expect(harness.state.video.status).toBe("FAILED");
  });

  it("does not issue a new URL for a part already present in MinIO", async () => {
    const harness = uploadHarness();
    openApps.push(harness.app);
    await harness.app.inject({
      method: "POST",
      url: "/api/courses/course-1/uploads",
      headers: parentHeaders,
      payload: { fileName: "lesson.mp4", sizeBytes: 100 },
    });

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/uploads/upload-1/parts/1/url",
      headers: parentHeaders,
      payload: {},
    });

    expect(response.json()).toEqual({ alreadyUploaded: true, partNumber: 1 });
    expect(harness.storage.presignUploadPart).not.toHaveBeenCalled();
  });

  it("rejects uploads that exceed the available quota before creating multipart state", async () => {
    const harness = uploadHarness({ usedBytes: 99_999_999_950n });
    openApps.push(harness.app);

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/courses/course-1/uploads",
      headers: parentHeaders,
      payload: { fileName: "lesson.mp4", sizeBytes: 100 },
    });

    expect(response.statusCode).toBe(413);
    expect(harness.storage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it("reports 80% and 95% quota warning levels using used plus reserved bytes", async () => {
    const warning = uploadHarness({ usedBytes: 80_000_000_000n });
    const critical = uploadHarness({ usedBytes: 95_000_000_000n });
    openApps.push(warning.app, critical.app);

    const warningResponse = await warning.app.inject({ method: "GET", url: "/api/storage", headers: parentHeaders });
    const criticalResponse = await critical.app.inject({ method: "GET", url: "/api/storage", headers: parentHeaders });

    expect(warningResponse.json().warningLevel).toBe("warning");
    expect(criticalResponse.json().warningLevel).toBe("critical");
  });

  it("archives instead of removing a video from a published course", async () => {
    const harness = uploadHarness();
    openApps.push(harness.app);
    harness.state.video = {
      id: "video-1",
      courseId: "course-1",
      objectKey: "videos/video-1.mp4",
      byteSize: 123n,
      status: "READY",
    };
    harness.prisma.course.findUnique.mockResolvedValue({ id: "course-1", status: "PUBLISHED" } as any);

    const response = await harness.app.inject({
      method: "DELETE",
      url: "/api/videos/video-1",
      headers: parentHeaders,
      payload: { confirmHistoryDeletion: true },
    });

    expect(response.statusCode).toBe(409);
    expect(harness.storage.deleteObject).not.toHaveBeenCalled();
  });

  it("archives the private object without deleting learning history and can restore it", async () => {
    const harness = uploadHarness({ usedBytes: 100n });
    openApps.push(harness.app);
    harness.state.video = {
      id: "video-1",
      courseId: "course-1",
      objectKey: "videos/video-1.mp4",
      byteSize: 100n,
      status: "READY",
    };

    const response = await harness.app.inject({
      method: "DELETE",
      url: "/api/videos/video-1",
      headers: parentHeaders,
      payload: { confirmHistoryDeletion: true },
    });

    expect(response.statusCode).toBe(204);
    expect(harness.storage.deleteObject).not.toHaveBeenCalled();
    expect(harness.prisma.watchProgress.deleteMany).not.toHaveBeenCalled();
    expect(harness.prisma.watchEvent.deleteMany).not.toHaveBeenCalled();
    expect(harness.prisma.favorite.deleteMany).not.toHaveBeenCalled();
    expect(harness.state.quota.usedBytes).toBe(100n);
    expect(harness.state.video.status).toBe("ARCHIVED");

    const restored = await harness.app.inject({
      method: "POST",
      url: "/api/videos/video-1/restore",
      headers: parentHeaders,
    });

    expect(restored.statusCode).toBe(200);
    expect(harness.state.video.status).toBe("READY");
  });
});
