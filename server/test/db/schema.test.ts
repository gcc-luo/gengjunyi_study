import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.DATABASE_URL;

function requireLoopbackTestDatabase(url: string | undefined): string {
  if (!url) {
    throw new Error("DATABASE_URL must point to a loopback *_test database");
  }

  const parsed = new URL(url);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  const overridesHost =
    parsed.searchParams.has("host") || parsed.searchParams.has("hostaddr");
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    !databaseName.endsWith("_test") ||
    overridesHost
  ) {
    throw new Error(
      "Schema integration tests only permit localhost/127.0.0.1 databases ending in _test",
    );
  }

  return url;
}

const connectionString = requireLoopbackTestDatabase(databaseUrl);
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

type Fixture = {
  childId: string;
  courseId: string;
  subjectId: string;
  videoId: string;
};

async function createFixture(): Promise<Fixture> {
  const id = randomUUID();
  const fixture = {
    childId: randomUUID(),
    courseId: randomUUID(),
    subjectId: randomUUID(),
    videoId: randomUUID(),
  };

  try {
    await prisma.subject.create({
      data: {
        id: fixture.subjectId,
        name: `Schema test ${id}`,
        slug: `schema-test-${id}`,
      },
    });
    await prisma.child.create({
      data: { id: fixture.childId, name: `Schema test ${id}` },
    });
    await prisma.course.create({
      data: {
        id: fixture.courseId,
        subjectId: fixture.subjectId,
        title: `Schema test ${id}`,
        status: "PUBLISHED",
      },
    });
    await prisma.video.create({
      data: {
        id: fixture.videoId,
        courseId: fixture.courseId,
        title: `Schema test ${id}`,
        objectKey: `schema-test/${fixture.videoId}/video.mp4`,
        fileName: "video.mp4",
        byteSize: BigInt(1024),
        durationMs: 1_000,
        codec: "h264",
        status: "READY",
        sortOrder: 0,
      },
    });

    return fixture;
  } catch (error) {
    await cleanupFixture(fixture);
    throw error;
  }
}

async function cleanupFixture(
  fixture: Fixture,
  additionalVideoIds: readonly string[] = [],
): Promise<void> {
  const videoIds = [fixture.videoId, ...additionalVideoIds];
  const fixtureHistoryWhere = {
    OR: [{ childId: fixture.childId }, { videoId: { in: videoIds } }],
  };

  await prisma.watchEvent.deleteMany({ where: fixtureHistoryWhere });
  await prisma.favorite.deleteMany({ where: fixtureHistoryWhere });
  await prisma.watchProgress.deleteMany({ where: fixtureHistoryWhere });
  await prisma.uploadSession.deleteMany({ where: { videoId: { in: videoIds } } });
  await prisma.video.deleteMany({ where: { id: { in: videoIds } } });
  await prisma.course.deleteMany({ where: { id: fixture.courseId } });
  await prisma.child.deleteMany({ where: { id: fixture.childId } });
  await prisma.subject.deleteMany({ where: { id: fixture.subjectId } });
}

async function expectCheckViolation(operation: () => Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toMatch(/Code: `23514`/);
  expect((caught as Error).message).toMatch(/violates check constraint/);
}

describe("PostgreSQL learning schema constraints", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects a connection URL that overrides its loopback host", () => {
    expect(() =>
      requireLoopbackTestDatabase(
        "postgresql://family_learning_test:family_learning_test_local_only@localhost:15432/family_learning_test?host=192.0.2.1",
      ),
    ).toThrow(
      "Schema integration tests only permit localhost/127.0.0.1 databases ending in _test",
    );
  });

  it("requires Video.objectKey to be unique", async () => {
    const fixture = await createFixture();
    const duplicateId = randomUUID();

    try {
      await expect(
        prisma.video.create({
          data: {
            id: duplicateId,
            courseId: fixture.courseId,
            title: "Duplicate object key",
            objectKey: `schema-test/${fixture.videoId}/video.mp4`,
            fileName: "duplicate.mp4",
            byteSize: BigInt(2_048),
            durationMs: 2_000,
            codec: "h264",
            status: "READY",
            sortOrder: 1,
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    } finally {
      await cleanupFixture(fixture, [duplicateId]);
    }
  });

  it("cleans all candidate videos before deleting fixture parents", async () => {
    const fixture = await createFixture();
    const candidateVideoId = randomUUID();

    try {
      await prisma.video.create({
        data: {
          id: candidateVideoId,
          courseId: fixture.courseId,
          title: "Cleanup candidate video",
          objectKey: `schema-test/${candidateVideoId}/cleanup.mp4`,
          fileName: "cleanup.mp4",
          byteSize: BigInt(1),
          durationMs: 1,
          codec: "h264",
          status: "READY",
          sortOrder: 1,
        },
      });

      await cleanupFixture(fixture, [candidateVideoId]);
      await expect(
        prisma.video.findMany({
          where: { id: { in: [fixture.videoId, candidateVideoId] } },
        }),
      ).resolves.toHaveLength(0);
    } finally {
      await prisma.video.deleteMany({
        where: { id: { in: [fixture.videoId, candidateVideoId] } },
      });
      await cleanupFixture(fixture);
    }
  });

  it("allows only one WatchProgress per child and video", async () => {
    const fixture = await createFixture();

    try {
      await prisma.watchProgress.create({
        data: {
          childId: fixture.childId,
          videoId: fixture.videoId,
          positionMs: 500,
        },
      });

      await expect(
        prisma.watchProgress.create({
          data: {
            childId: fixture.childId,
            videoId: fixture.videoId,
            positionMs: 750,
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rejects a video whose course does not exist", async () => {
    const fixture = await createFixture();
    const orphanVideoId = randomUUID();

    try {
      await expect(
        prisma.video.create({
          data: {
            id: orphanVideoId,
            courseId: randomUUID(),
            title: "Orphan video",
            objectKey: `schema-test/${randomUUID()}/orphan.mp4`,
            fileName: "orphan.mp4",
            byteSize: BigInt(1),
            durationMs: 1,
            codec: "h264",
            status: "READY",
            sortOrder: 0,
          },
        }),
      ).rejects.toMatchObject({ code: "P2003" });
    } finally {
      await cleanupFixture(fixture, [orphanVideoId]);
    }
  });

  it("retains watch progress and events when a course is unpublished and a child is disabled", async () => {
    const fixture = await createFixture();

    try {
      await prisma.watchProgress.create({
        data: {
          childId: fixture.childId,
          videoId: fixture.videoId,
          positionMs: 500,
        },
      });
      await prisma.watchEvent.create({
        data: {
          childId: fixture.childId,
          videoId: fixture.videoId,
          eventType: "PROGRESS",
          positionMs: 500,
        },
      });

      await prisma.course.update({
        where: { id: fixture.courseId },
        data: { status: "UNPUBLISHED" },
      });
      await prisma.child.update({
        where: { id: fixture.childId },
        data: { status: "DISABLED" },
      });

      await expect(
        prisma.watchProgress.count({ where: { childId: fixture.childId } }),
      ).resolves.toBe(1);
      await expect(
        prisma.watchEvent.count({ where: { childId: fixture.childId } }),
      ).resolves.toBe(1);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("stores PROCESSING media status, maximum progress percent, and watched seconds at their upper bounds", async () => {
    const fixture = await createFixture();

    try {
      await prisma.watchProgress.create({
        data: {
          childId: fixture.childId,
          videoId: fixture.videoId,
          positionMs: 500,
          maxProgressPercent: 0,
        },
      });
      await prisma.watchEvent.create({
        data: {
          childId: fixture.childId,
          videoId: fixture.videoId,
          eventType: "PROGRESS",
          positionMs: 500,
          watchedSeconds: 0,
        },
      });

      await prisma.watchProgress.update({
        where: {
          childId_videoId: {
            childId: fixture.childId,
            videoId: fixture.videoId,
          },
        },
        data: { maxProgressPercent: 100 },
      });
      await prisma.watchEvent.updateMany({
        where: { childId: fixture.childId, videoId: fixture.videoId },
        data: { watchedSeconds: 30 },
      });
      await prisma.video.update({
        where: { id: fixture.videoId },
        data: { status: "PROCESSING" },
      });

      await expect(
        prisma.watchProgress.findUnique({
          where: {
            childId_videoId: {
              childId: fixture.childId,
              videoId: fixture.videoId,
            },
          },
        }),
      ).resolves.toMatchObject({ maxProgressPercent: 100 });
      await expect(
        prisma.watchEvent.findFirst({ where: { childId: fixture.childId } }),
      ).resolves.toMatchObject({ watchedSeconds: 30 });
      await expect(
        prisma.video.findUnique({ where: { id: fixture.videoId } }),
      ).resolves.toMatchObject({ status: "PROCESSING" });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rejects negative video byte sizes and durations", async () => {
    const fixture = await createFixture();

    try {
      await expectCheckViolation(() =>
        prisma.video.update({
          where: { id: fixture.videoId },
          data: { byteSize: BigInt(-1) },
        }),
      );
      await expectCheckViolation(() =>
        prisma.video.update({
          where: { id: fixture.videoId },
          data: { durationMs: -1 },
        }),
      );
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rejects negative upload-session byte reservations", async () => {
    const fixture = await createFixture();

    try {
      const uploadSession = await prisma.uploadSession.create({
        data: {
          videoId: fixture.videoId,
          objectKey: `schema-test/${fixture.videoId}/upload.mp4`,
          minioUploadId: randomUUID(),
          reservedBytes: BigInt(100),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      await expectCheckViolation(() =>
        prisma.uploadSession.update({
          where: { id: uploadSession.id },
          data: { reservedBytes: BigInt(-1) },
        }),
      );
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("keeps the singleton quota row at id 1 and rejects negative or over-reserved quota", async () => {
    const quota = await prisma.storageQuota.findUnique({ where: { id: 1 } });
    expect(quota).toMatchObject({
      id: 1,
      maxBytes: BigInt(100_000_000_000),
      usedBytes: BigInt(0),
      reservedBytes: BigInt(0),
    });
    if (!quota) return;

    try {
      await expectCheckViolation(() =>
        prisma.storageQuota.create({
          data: {
            id: 2,
            maxBytes: BigInt(100),
          },
        }),
      );
      await expectCheckViolation(() =>
        prisma.storageQuota.update({
          where: { id: 1 },
          data: { maxBytes: BigInt(-1) },
        }),
      );
      await expectCheckViolation(() =>
        prisma.storageQuota.update({
          where: { id: 1 },
          data: { usedBytes: BigInt(-1) },
        }),
      );
      await expectCheckViolation(() =>
        prisma.storageQuota.update({
          where: { id: 1 },
          data: { reservedBytes: BigInt(-1) },
        }),
      );

      await prisma.storageQuota.update({
        where: { id: 1 },
        data: { maxBytes: BigInt(100) },
      });
      await expectCheckViolation(() =>
        prisma.storageQuota.update({
          where: { id: 1 },
          data: { usedBytes: BigInt(70), reservedBytes: BigInt(31) },
        }),
      );
    } finally {
      await prisma.storageQuota.update({
        where: { id: 1 },
        data: {
          maxBytes: BigInt(100_000_000_000),
          usedBytes: BigInt(0),
          reservedBytes: BigInt(0),
        },
      });
    }
  });

  it("rejects negative watch positions and progress percentages outside 0..100", async () => {
    const fixture = await createFixture();

    try {
      const progress = await prisma.watchProgress.create({
        data: {
          childId: fixture.childId,
          videoId: fixture.videoId,
          positionMs: 500,
          maxProgressPercent: 50,
        },
      });

      await expectCheckViolation(() =>
        prisma.watchProgress.update({
          where: { id: progress.id },
          data: { positionMs: -1 },
        }),
      );
      await expectCheckViolation(() =>
        prisma.watchProgress.update({
          where: { id: progress.id },
          data: { maxProgressPercent: -1 },
        }),
      );
      await expectCheckViolation(() =>
        prisma.watchProgress.update({
          where: { id: progress.id },
          data: { maxProgressPercent: 101 },
        }),
      );
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rejects negative event positions and watched seconds outside 0..30", async () => {
    const fixture = await createFixture();

    try {
      const event = await prisma.watchEvent.create({
        data: {
          childId: fixture.childId,
          videoId: fixture.videoId,
          eventType: "PROGRESS",
          positionMs: 500,
          watchedSeconds: 10,
        },
      });

      await expectCheckViolation(() =>
        prisma.watchEvent.update({
          where: { id: event.id },
          data: { positionMs: -1 },
        }),
      );
      await expectCheckViolation(() =>
        prisma.watchEvent.update({
          where: { id: event.id },
          data: { watchedSeconds: -1 },
        }),
      );
      await expectCheckViolation(() =>
        prisma.watchEvent.update({
          where: { id: event.id },
          data: { watchedSeconds: 31 },
        }),
      );
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
