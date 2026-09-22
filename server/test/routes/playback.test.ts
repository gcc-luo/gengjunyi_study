import { afterEach, describe, expect, it, vi } from "vitest";
import { makeLearningHarness, parentHeaders } from "./learning-test-utils";

describe("authorized video playback", () => {
  const apps: Array<ReturnType<typeof makeLearningHarness>["app"]> = [];
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

  it("requires the currently selected active child", async () => {
    const harness = makeLearningHarness({ activeChildId: null });
    apps.push(harness.app);

    const response = await harness.app.inject({ method: "POST", url: "/api/videos/video-1/playback", headers: parentHeaders });

    expect(response.statusCode).toBe(403);
    expect(harness.storage.presignGetObject).not.toHaveBeenCalled();
  });

  it("signs a short-lived public media URL for READY video in a published course", async () => {
    const harness = makeLearningHarness();
    apps.push(harness.app);

    const response = await harness.app.inject({ method: "POST", url: "/api/videos/video-1/playback", headers: parentHeaders });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      url: "https://media.example.com/family/video.mp4?X-Amz-Signature=secret",
      expiresInSeconds: 7200,
    });
    expect(harness.storage.presignGetObject).toHaveBeenCalledWith("videos/private-video.mp4");
  });

  it("signs the first-frame thumbnail for an accessible READY video", async () => {
    const harness = makeLearningHarness();
    apps.push(harness.app);
    harness.storage.headObject = vi.fn(async () => ({ byteSize: 4_096n, contentType: "image/jpeg" }));

    const response = await harness.app.inject({ method: "GET", url: "/api/videos/video-1/thumbnail", headers: parentHeaders });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://media.example.com/family/video.mp4?X-Amz-Signature=secret");
    expect(harness.storage.headObject).toHaveBeenCalledWith("thumbnails/video-1.jpg");
    expect(harness.storage.presignGetObject).toHaveBeenCalledWith("thumbnails/video-1.jpg");
  });

  it.each([
    [{ status: "DRAFT" as const }, { status: "READY" as const }],
    [{ status: "PUBLISHED" as const }, { status: "FAILED" as const }],
  ])("does not issue playback signatures for unpublished or failed media", async (course, video) => {
    const harness = makeLearningHarness({
      course: { id: "course-1", title: "Numbers", status: course.status, subject: { slug: "math", name: "数学" } },
      video: { ...({} as any), id: "video-1", courseId: "course-1", status: video.status },
    });
    apps.push(harness.app);

    const response = await harness.app.inject({ method: "POST", url: "/api/videos/video-1/playback", headers: parentHeaders });

    expect(response.statusCode).toBe(404);
    expect(harness.storage.presignGetObject).not.toHaveBeenCalled();
  });

  it("does not issue playback for an inactive selected child", async () => {
    const harness = makeLearningHarness();
    apps.push(harness.app);
    harness.session.activeChildId = "child-2";
    harness.state.children[1].status = "DISABLED" as any;

    const response = await harness.app.inject({ method: "POST", url: "/api/videos/video-1/playback", headers: parentHeaders });

    expect(response.statusCode).toBe(403);
    expect(harness.storage.presignGetObject).not.toHaveBeenCalled();
  });

  it("does not issue playback for a course that is not assigned to the selected child", async () => {
    const harness = makeLearningHarness({ freeChoice: false, assignedCourseIds: [] });
    apps.push(harness.app);

    const response = await harness.app.inject({ method: "POST", url: "/api/videos/video-1/playback", headers: parentHeaders });

    expect(response.statusCode).toBe(404);
    expect(harness.storage.presignGetObject).not.toHaveBeenCalled();
  });

  it("allows playback when the restricted course is assigned", async () => {
    const harness = makeLearningHarness({ freeChoice: false, assignedCourseIds: ["course-1"] });
    apps.push(harness.app);

    const response = await harness.app.inject({ method: "POST", url: "/api/videos/video-1/playback", headers: parentHeaders });

    expect(response.statusCode).toBe(200);
  });
});
