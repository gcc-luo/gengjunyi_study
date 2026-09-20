import { describe, expect, it } from "vitest";
import {
  activeChild,
  courseRecord,
  makePrisma,
  mathSubject,
  parentHeaders,
  scienceSubject,
  useRouteApp,
  videoRecord,
} from "./route-test-utils";

describe("parent and child course routes", () => {
  it("requires a parent session to read course management data", async () => {
    const { prisma } = makePrisma();
    const app = useRouteApp(prisma);

    const response = await app.inject({ method: "GET", url: "/api/courses" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
  });

  it("creates courses as DRAFT and returns the subject slug", async () => {
    const { prisma } = makePrisma();
    const app = useRouteApp(prisma);

    const response = await app.inject({
      method: "POST",
      url: "/api/courses",
      headers: parentHeaders,
      payload: { title: "Numbers", subjectId: "math", description: "Count together", ageRange: "6-8岁", coverStyle: "planet" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      title: "Numbers",
      subjectId: "math",
      ageRange: "6-8岁",
      cover: { style: "planet", colors: ["#7F6CF4", "#C4BFFF"] },
      status: "DRAFT",
    });
    expect(JSON.stringify(response.json())).not.toContain(mathSubject.id);
  });

  it("edits course fields and updates video order", async () => {
    const course = courseRecord();
    const videos = [
      videoRecord({ id: "video-1", sortOrder: 0 }),
      videoRecord({ id: "video-2", title: "Addition", sortOrder: 1 }),
    ];
    const { prisma, state } = makePrisma({ courses: [course], videos });
    const app = useRouteApp(prisma);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/courses/course-1",
      headers: parentHeaders,
      payload: { title: "Numbers and Addition", subjectId: "science", ageRange: "7-9岁", coverStyle: "rainbow", videoIds: ["video-2", "video-1"] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      title: "Numbers and Addition",
      subjectId: "science",
      ageRange: "7-9岁",
      cover: { style: "rainbow", colors: ["#FF6C66", "#FFD5D2"] },
      videos: [{ id: "video-2", sortOrder: 0 }, { id: "video-1", sortOrder: 1 }],
    });
    expect(state.courses[0].subjectId).toBe(scienceSubject.id);
    expect(state.videos.map((video) => video.sortOrder)).toEqual([1, 0]);
  });

  it("rejects a video-order update containing a video from another course", async () => {
    const { prisma } = makePrisma({
      courses: [courseRecord()],
      videos: [videoRecord(), videoRecord({ id: "other-video", courseId: "other-course" })],
    });
    const app = useRouteApp(prisma);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/courses/course-1",
      headers: parentHeaders,
      payload: { videoIds: ["other-video"] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("requires video order updates to include every course video exactly once", async () => {
    const videos = [videoRecord({ id: "video-1", sortOrder: 0 }), videoRecord({ id: "video-2", sortOrder: 1 })];
    const { prisma, state } = makePrisma({ courses: [courseRecord()], videos });
    const app = useRouteApp(prisma);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/courses/course-1",
      headers: parentHeaders,
      payload: { videoIds: ["video-2"] },
    });

    expect(response.statusCode).toBe(400);
    expect(state.videos.map((video) => video.sortOrder)).toEqual([0, 1]);
  });

  it.each([
    ["blank title", courseRecord({ title: "  " }), [videoRecord()]],
    ["missing subject", courseRecord({ subjectId: "removed-subject" }), [videoRecord()]],
    ["no READY video", courseRecord(), [videoRecord({ status: "PROCESSING" })]],
  ])("rejects publishing with %s", async (_label, course, videos) => {
    const subjects = course.subjectId === "removed-subject" ? [scienceSubject] : [mathSubject, scienceSubject];
    const { prisma, state } = makePrisma({ courses: [course], videos, subjects });
    const app = useRouteApp(prisma);

    const response = await app.inject({
      method: "POST",
      url: "/api/courses/course-1/publish",
      headers: parentHeaders,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: "COURSE_NOT_PUBLISHABLE" } });
    expect(state.courses[0].status).toBe("DRAFT");
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it("locks and rereads course media in a transaction before publishing", async () => {
    const { prisma, state, raw } = makePrisma({ courses: [courseRecord()], videos: [videoRecord()] });
    const app = useRouteApp(prisma);

    const response = await app.inject({
      method: "POST",
      url: "/api/courses/course-1/publish",
      headers: parentHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(state.courses[0].status).toBe("PUBLISHED");
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(raw.$queryRaw).toHaveBeenCalled();
    expect(prisma.course.findUnique).toHaveBeenCalled();
    expect(prisma.video.findMany).toHaveBeenCalled();
  });

  it("returns only published courses and READY videos with the active child's progress", async () => {
    const published = courseRecord({ status: "PUBLISHED" });
    const draft = courseRecord({ id: "draft-course", status: "DRAFT" });
    const videos = [
      videoRecord({ id: "ready-video", sortOrder: 0 }),
      videoRecord({ id: "processing-video", status: "PROCESSING", sortOrder: 1 }),
      videoRecord({ id: "draft-video", courseId: "draft-course" }),
    ];
    const { prisma } = makePrisma({
      children: [activeChild],
      activeChildId: activeChild.id,
      courses: [published, draft],
      videos,
      progress: [
        { childId: activeChild.id, videoId: "ready-video", positionMs: 400, maxProgressPercent: 30, completed: false, updatedAt: new Date() },
        { childId: "other-child", videoId: "ready-video", positionMs: 900, maxProgressPercent: 90, completed: false, updatedAt: new Date() },
      ],
    });
    const app = useRouteApp(prisma);

    const response = await app.inject({ method: "GET", url: "/api/child/courses", headers: parentHeaders });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
    expect(response.json()[0]).toMatchObject({
      id: "course-1",
      subjectId: "math",
      videos: [{ id: "ready-video", progress: { positionMs: 400, maxProgressPercent: 30 } }],
    });
    expect(response.json()[0].videos).toHaveLength(1);
  });

  it("refuses child course reads when there is no active child", async () => {
    const { prisma } = makePrisma();
    const app = useRouteApp(prisma);

    const response = await app.inject({ method: "GET", url: "/api/child/courses", headers: parentHeaders });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "ACTIVE_CHILD_REQUIRED" } });
  });

  it("unpublishes without deleting history and hides the course from child queries", async () => {
    const progress = [{ childId: activeChild.id, videoId: "video-1", positionMs: 800, maxProgressPercent: 70, completed: false, updatedAt: new Date() }];
    const events = [{ id: "event-1", childId: activeChild.id, videoId: "video-1" }];
    const favorites = [{ id: "favorite-1", childId: activeChild.id, videoId: "video-1" }];
    const { prisma, state } = makePrisma({
      children: [activeChild],
      activeChildId: activeChild.id,
      courses: [courseRecord({ status: "PUBLISHED" })],
      videos: [videoRecord()],
      progress,
      events,
      favorites,
    });
    const app = useRouteApp(prisma);

    const offline = await app.inject({
      method: "POST",
      url: "/api/courses/course-1/unpublish",
      headers: parentHeaders,
    });
    const childList = await app.inject({ method: "GET", url: "/api/child/courses", headers: parentHeaders });

    expect(offline.statusCode).toBe(200);
    expect(offline.json()).toMatchObject({ status: "UNPUBLISHED" });
    expect(childList.statusCode).toBe(200);
    expect(childList.json()).toEqual([]);
    expect(state.progress).toHaveLength(1);
    expect(state.events).toHaveLength(1);
    expect(state.favorites).toHaveLength(1);
  });

  it("does not reveal whether a course exists when the child requests an unavailable course", async () => {
    const { prisma } = makePrisma({ children: [activeChild], activeChildId: activeChild.id });
    const app = useRouteApp(prisma);

    const response = await app.inject({
      method: "GET",
      url: "/api/child/courses/private-course",
      headers: parentHeaders,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: "RESOURCE_NOT_FOUND", message: "Resource not found" },
    });
  });
});
