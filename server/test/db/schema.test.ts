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

async function cleanupFixture(fixture: Fixture): Promise<void> {
  await prisma.watchEvent.deleteMany({ where: { childId: fixture.childId } });
  await prisma.favorite.deleteMany({ where: { childId: fixture.childId } });
  await prisma.watchProgress.deleteMany({ where: { childId: fixture.childId } });
  await prisma.uploadSession.deleteMany({ where: { videoId: fixture.videoId } });
  await prisma.video.deleteMany({ where: { id: fixture.videoId } });
  await prisma.course.deleteMany({ where: { id: fixture.courseId } });
  await prisma.child.deleteMany({ where: { id: fixture.childId } });
  await prisma.subject.deleteMany({ where: { id: fixture.subjectId } });
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

    try {
      await expect(
        prisma.video.create({
          data: {
            id: randomUUID(),
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
      await cleanupFixture(fixture);
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
});
