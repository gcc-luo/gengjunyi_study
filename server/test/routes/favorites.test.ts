import { afterEach, describe, expect, it } from "vitest";
import { makeLearningHarness, parentHeaders } from "./learning-test-utils";

describe("child favorites", () => {
  const apps: Array<ReturnType<typeof makeLearningHarness>["app"]> = [];
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

  it("adds a favorite for only the selected child and returns that child's list", async () => {
    const harness = makeLearningHarness();
    apps.push(harness.app);

    const added = await harness.app.inject({
      method: "PUT",
      url: "/api/children/child-1/favorites",
      headers: parentHeaders,
      payload: { videoId: "video-1" },
    });
    const listed = await harness.app.inject({ method: "GET", url: "/api/children/child-1/favorites", headers: parentHeaders });

    expect(added.statusCode).toBe(201);
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0]).toMatchObject({ videoId: "video-1", childId: "child-1" });
  });

  it("does not let the current child mutate another child's favorites", async () => {
    const harness = makeLearningHarness();
    apps.push(harness.app);

    const response = await harness.app.inject({
      method: "PUT",
      url: "/api/children/child-2/favorites",
      headers: parentHeaders,
      payload: { videoId: "video-1" },
    });

    expect(response.statusCode).toBe(403);
    expect(harness.state.favorites).toHaveLength(0);
  });

  it("does not let the current child read another child's favorites", async () => {
    const harness = makeLearningHarness();
    apps.push(harness.app);

    const response = await harness.app.inject({ method: "GET", url: "/api/children/child-2/favorites", headers: parentHeaders });

    expect(response.statusCode).toBe(403);
  });

  it("allows a parent-mode session to manage either child's favorites", async () => {
    const harness = makeLearningHarness({ activeChildId: null });
    apps.push(harness.app);

    const response = await harness.app.inject({
      method: "PUT",
      url: "/api/children/child-2/favorites",
      headers: parentHeaders,
      payload: { videoId: "video-1" },
    });

    expect(response.statusCode).toBe(201);
    expect(harness.state.favorites).toMatchObject([{ childId: "child-2", videoId: "video-1" }]);
  });

  it("removes the selected child's favorite without affecting another child", async () => {
    const harness = makeLearningHarness({
      favorites: [
        { id: "favorite-1", childId: "child-1", videoId: "video-1", createdAt: new Date() },
        { id: "favorite-2", childId: "child-2", videoId: "video-1", createdAt: new Date() },
      ],
    });
    apps.push(harness.app);

    const response = await harness.app.inject({
      method: "DELETE",
      url: "/api/children/child-1/favorites",
      headers: parentHeaders,
      payload: { videoId: "video-1" },
    });

    expect(response.statusCode).toBe(204);
    expect(harness.state.favorites.map((favorite) => favorite.childId)).toEqual(["child-2"]);
  });

  it("hides and rejects favorites for courses not assigned to the selected child", async () => {
    const harness = makeLearningHarness({
      freeChoice: false,
      assignedCourseIds: [],
      favorites: [{ id: "favorite-1", childId: "child-1", videoId: "video-1", createdAt: new Date() }],
    });
    apps.push(harness.app);

    const listed = await harness.app.inject({ method: "GET", url: "/api/children/child-1/favorites", headers: parentHeaders });
    const added = await harness.app.inject({
      method: "PUT",
      url: "/api/children/child-1/favorites",
      headers: parentHeaders,
      payload: { videoId: "video-1" },
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([]);
    expect(added.statusCode).toBe(404);
  });
});
