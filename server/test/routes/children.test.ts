import { describe, expect, it } from "vitest";
import { activeChild, makePrisma, parentHeaders, useRouteApp } from "./route-test-utils";

describe("parent child routes", () => {
  it("requires a parent session to read children", async () => {
    const { prisma } = makePrisma();
    const app = useRouteApp(prisma);

    const response = await app.inject({ method: "GET", url: "/api/children" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "AUTH_REQUIRED", message: "Parent authentication is required" },
    });
  });

  it("creates a child with a trimmed non-empty nickname", async () => {
    const { prisma } = makePrisma();
    const app = useRouteApp(prisma);

    const response = await app.inject({
      method: "POST",
      url: "/api/children",
      headers: parentHeaders,
      payload: { name: "  Mina  " },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: "Mina", status: "ACTIVE" });
  });

  it("persists the child's avatar and grade across reads", async () => {
    const { prisma } = makePrisma();
    const app = useRouteApp(prisma);

    const created = await app.inject({
      method: "POST",
      url: "/api/children",
      headers: parentHeaders,
      payload: { name: "Mina", avatar: "🚀", grade: "小学一年级" },
    });
    const listed = await app.inject({ method: "GET", url: "/api/children", headers: parentHeaders });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ avatar: "🚀", grade: "小学一年级" });
    expect(listed.json()).toEqual([expect.objectContaining({ avatar: "🚀", grade: "小学一年级" })]);
  });

  it("rejects an empty nickname", async () => {
    const { prisma } = makePrisma();
    const app = useRouteApp(prisma);

    const response = await app.inject({
      method: "POST",
      url: "/api/children",
      headers: parentHeaders,
      payload: { name: "   " },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("edits a child's nickname without changing the child's status", async () => {
    const { prisma, state } = makePrisma({ children: [activeChild] });
    const app = useRouteApp(prisma);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/children/child-1",
      headers: parentHeaders,
      payload: { name: "  Nova " },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: "child-1", name: "Nova", status: "ACTIVE" });
    expect(state.children[0].status).toBe("ACTIVE");
  });

  it("updates the child's avatar and grade", async () => {
    const { prisma, state } = makePrisma({ children: [activeChild] });
    const app = useRouteApp(prisma);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/children/child-1",
      headers: parentHeaders,
      payload: { avatar: "🐳", grade: "二年级" },
    });

    expect(response.statusCode).toBe(200);
    expect(state.children[0]).toMatchObject({ avatar: "🐳", grade: "二年级" });
  });

  it("deactivates a child, clears active selections, and preserves learning history", async () => {
    const { prisma, state } = makePrisma({
      children: [activeChild],
      activeChildId: activeChild.id,
      progress: [{
        childId: activeChild.id,
        videoId: "video-1",
        positionMs: 500,
        maxProgressPercent: 40,
        completed: false,
        updatedAt: new Date("2026-09-16T10:00:00.000Z"),
      }],
      events: [{ id: "event-1", childId: activeChild.id, videoId: "video-1" }],
      favorites: [{ id: "favorite-1", childId: activeChild.id, videoId: "video-1" }],
    });
    const app = useRouteApp(prisma);

    const response = await app.inject({
      method: "POST",
      url: "/api/children/child-1/deactivate",
      headers: parentHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: "child-1", status: "DISABLED" });
    expect(state.sessions[0].activeChildId).toBeNull();
    expect(state.progress).toHaveLength(1);
    expect(state.events).toHaveLength(1);
    expect(state.favorites).toHaveLength(1);
  });

  it("reactivates a disabled child without changing learning history", async () => {
    const { prisma, state } = makePrisma({ children: [{ ...activeChild, status: "DISABLED" }], progress: [{ childId: activeChild.id, videoId: "video-1" }] });
    const app = useRouteApp(prisma);

    const response = await app.inject({ method: "POST", url: "/api/children/child-1/activate", headers: parentHeaders });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: "child-1", status: "ACTIVE" });
    expect(state.progress).toHaveLength(1);
  });

  it("does not reveal whether an unknown child exists", async () => {
    const { prisma } = makePrisma();
    const app = useRouteApp(prisma);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/children/secret-child-id",
      headers: parentHeaders,
      payload: { name: "Nova" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: "RESOURCE_NOT_FOUND", message: "Resource not found" },
    });
  });
});
