import { afterEach, describe, expect, it } from "vitest";
import { makeLearningHarness, parentHeaders } from "./learning-test-utils";

describe("family learning records", () => {
  const apps: Array<ReturnType<typeof makeLearningHarness>["app"]> = [];
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

  it("aggregates only the requested child's watch time and progress", async () => {
    const harness = makeLearningHarness({
      progress: [
        { id: "progress-1", childId: "child-1", videoId: "video-1", positionMs: 40_000, maxProgressPercent: 40, completed: false, updatedAt: new Date() },
        { id: "progress-2", childId: "child-2", videoId: "video-1", positionMs: 90_000, maxProgressPercent: 90, completed: true, updatedAt: new Date() },
      ],
      events: [
        { id: "event-1", childId: "child-1", videoId: "video-1", eventType: "PROGRESS", positionMs: 40_000, watchedSeconds: 12, occurredAt: new Date() },
        { id: "event-2", childId: "child-2", videoId: "video-1", eventType: "PROGRESS", positionMs: 90_000, watchedSeconds: 20, occurredAt: new Date() },
      ],
    });
    apps.push(harness.app);

    const response = await harness.app.inject({ method: "GET", url: "/api/children/child-1/records", headers: parentHeaders });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      childId: "child-1",
      totalWatchedSeconds: 12,
      completedVideos: 0,
      videos: [{ videoId: "video-1", positionMs: 40_000, maxProgressPercent: 40 }],
    });
  });

  it("returns empty, honest records for a child with no watch activity", async () => {
    const harness = makeLearningHarness({ activeChildId: null });
    apps.push(harness.app);

    const response = await harness.app.inject({ method: "GET", url: "/api/children/child-2/records", headers: parentHeaders });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ childId: "child-2", totalWatchedSeconds: 0, videos: [], recentActivity: [] });
  });

  it("does not let an active child inspect another child's records", async () => {
    const harness = makeLearningHarness();
    apps.push(harness.app);

    const response = await harness.app.inject({ method: "GET", url: "/api/children/child-2/records", headers: parentHeaders });

    expect(response.statusCode).toBe(403);
  });
});
