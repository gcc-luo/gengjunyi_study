import { afterEach, describe, expect, it, vi } from "vitest";
import { makeLearningHarness, parentHeaders } from "./learning-test-utils";

describe("parent overview", () => {
  const apps: Array<ReturnType<typeof makeLearningHarness>["app"]> = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    vi.useRealTimers();
  });

  it("returns zero activity rather than demo metrics when the family has no learning data", async () => {
    const harness = makeLearningHarness({ activeChildId: null });
    apps.push(harness.app);

    const response = await harness.app.inject({ method: "GET", url: "/api/overview", headers: parentHeaders });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      totals: { children: 2, courses: 1, readyVideos: 1, watchedSeconds: 0, completedVideos: 0 },
      today: { watchedSeconds: 0, events: 0 },
      recentActivity: [],
      continueLearning: [],
    });
  });

  it("does not expose another child's activity when a child session is active", async () => {
    const harness = makeLearningHarness({
      activeChildId: "child-1",
      events: [{ id: "event-2", childId: "child-2", videoId: "video-1", eventType: "PROGRESS", watchedSeconds: 15, occurredAt: new Date() }],
    });
    apps.push(harness.app);

    const response = await harness.app.inject({ method: "GET", url: "/api/overview", headers: parentHeaders });

    expect(response.statusCode).toBe(200);
    expect(response.json().totals.watchedSeconds).toBe(0);
    expect(response.json().recentActivity).toEqual([]);
  });

  it("uses APP_TIMEZONE local midnight when calculating today's activity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T02:00:00.000Z"));
    const harness = makeLearningHarness({
      activeChildId: null,
      events: [
        { id: "before-day", childId: "child-1", videoId: "video-1", eventType: "PROGRESS", watchedSeconds: 9, occurredAt: new Date("2026-09-16T15:59:59.000Z") },
        { id: "at-day", childId: "child-1", videoId: "video-1", eventType: "PROGRESS", watchedSeconds: 7, occurredAt: new Date("2026-09-16T16:00:00.000Z") },
      ],
    });
    apps.push(harness.app);

    const response = await harness.app.inject({ method: "GET", url: "/api/overview", headers: parentHeaders });

    expect(response.statusCode).toBe(200);
    expect(response.json().today).toMatchObject({ watchedSeconds: 7, events: 1 });
  });
});
