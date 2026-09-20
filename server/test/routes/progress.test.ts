import { afterEach, describe, expect, it, vi } from "vitest";
import { makeLearningHarness, parentHeaders } from "./learning-test-utils";

describe("child learning progress", () => {
  const apps: Array<ReturnType<typeof makeLearningHarness>["app"]> = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    vi.restoreAllMocks();
  });

  it("stores the current position while keeping maximum progress monotonic and marking 90% complete", async () => {
    const harness = makeLearningHarness({
      progress: [{ id: "progress-1", childId: "child-1", videoId: "video-1", positionMs: 20_000, maxProgressPercent: 35, completed: false, updatedAt: new Date() }],
    });
    apps.push(harness.app);

    const response = await harness.app.inject({
      method: "PUT",
      url: "/api/children/child-1/videos/video-1/progress",
      headers: parentHeaders,
      payload: { positionMs: 90_000, isPlaying: true, watchedSeconds: 30, eventType: "PROGRESS" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().progress).toMatchObject({ positionMs: 90_000, maxProgressPercent: 90, completed: true });
    expect(response.json().recordedWatchedSeconds).toBeLessThanOrEqual(30);
  });

  it("records zero effective watch time while paused", async () => {
    const harness = makeLearningHarness({
      events: [{ id: "prior", childId: "child-1", videoId: "video-1", eventType: "PROGRESS", watchedSeconds: 0, occurredAt: new Date(Date.now() - 20_000) }],
    });
    apps.push(harness.app);

    const response = await harness.app.inject({
      method: "PUT",
      url: "/api/children/child-1/videos/video-1/progress",
      headers: parentHeaders,
      payload: { positionMs: 25_000, isPlaying: false, watchedSeconds: 0, eventType: "PAUSE" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().recordedWatchedSeconds).toBe(0);
    expect(harness.state.events.at(-1).watchedSeconds).toBe(0);
  });

  it("records pending played seconds on an explicit pause event", async () => {
    const harness = makeLearningHarness({
      events: [{ id: "prior", childId: "child-1", videoId: "video-1", eventType: "PROGRESS", watchedSeconds: 0, occurredAt: new Date(Date.now() - 20_000) }],
    });
    apps.push(harness.app);

    const response = await harness.app.inject({
      method: "PUT",
      url: "/api/children/child-1/videos/video-1/progress",
      headers: parentHeaders,
      payload: { positionMs: 25_000, isPlaying: false, watchedSeconds: 5, eventType: "PAUSE" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().recordedWatchedSeconds).toBe(5);
    expect(harness.state.events.at(-1).watchedSeconds).toBe(5);
  });

  it("records the final pending seconds on an ended event", async () => {
    const harness = makeLearningHarness({
      events: [{ id: "prior", childId: "child-1", videoId: "video-1", eventType: "PROGRESS", watchedSeconds: 0, occurredAt: new Date(Date.now() - 10_000) }],
    });
    apps.push(harness.app);

    const response = await harness.app.inject({
      method: "PUT",
      url: "/api/children/child-1/videos/video-1/progress",
      headers: parentHeaders,
      payload: { positionMs: 100_000, isPlaying: false, watchedSeconds: 4, eventType: "ENDED" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().recordedWatchedSeconds).toBe(4);
    expect(harness.state.events.at(-1).watchedSeconds).toBe(4);
  });

  it("prevents one selected child session from writing another child's progress", async () => {
    const harness = makeLearningHarness();
    apps.push(harness.app);

    const response = await harness.app.inject({
      method: "PUT",
      url: "/api/children/child-2/videos/video-1/progress",
      headers: parentHeaders,
      payload: { positionMs: 1_000, isPlaying: true, watchedSeconds: 1, eventType: "PROGRESS" },
    });

    expect(response.statusCode).toBe(403);
    expect(harness.state.progress).toHaveLength(0);
  });

  it("rejects positions outside the video's verified duration", async () => {
    const harness = makeLearningHarness();
    apps.push(harness.app);

    const response = await harness.app.inject({
      method: "PUT",
      url: "/api/children/child-1/videos/video-1/progress",
      headers: parentHeaders,
      payload: { positionMs: 100_001, isPlaying: true, watchedSeconds: 1, eventType: "PROGRESS" },
    });

    expect(response.statusCode).toBe(400);
    expect(harness.state.progress).toHaveLength(0);
  });

  it("derives billable watch time from server elapsed time, capped at 30 seconds", async () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-09-17T10:00:45.000Z").getTime());
    const harness = makeLearningHarness({
      events: [{ id: "prior", childId: "child-1", videoId: "video-1", eventType: "PLAY", watchedSeconds: 0, occurredAt: new Date("2026-09-17T10:00:00.000Z") }],
    });
    apps.push(harness.app);

    const response = await harness.app.inject({
      method: "PUT",
      url: "/api/children/child-1/videos/video-1/progress",
      headers: parentHeaders,
      payload: { positionMs: 15_000, isPlaying: true, watchedSeconds: 1, eventType: "PROGRESS" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().recordedWatchedSeconds).toBe(30);
    expect(harness.state.events.at(-1).watchedSeconds).toBe(30);
  });
});
