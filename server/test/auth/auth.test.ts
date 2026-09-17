import { createHash } from "node:crypto";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { buildApp } from "../../src/app";
import type { AppConfig } from "../../src/config";
import { hashPassword } from "../../src/auth/password";
import {
  parseCreateAdminArgs,
  provisionAdmin,
  readHiddenPassword,
} from "../../scripts/create-admin";

const config: AppConfig = {
  nodeEnv: "test",
  port: 3000,
  sessionCookieName: "fl_parent_session",
  sessionLifetimeSeconds: 7 * 24 * 60 * 60,
  secureCookies: false,
  databaseUrl:
    "postgresql://family_learning_test:family_learning_test_local_only@127.0.0.1:15432/family_learning_test",
  trustedProxies: [],
  minio: {
    endpoint: "localhost",
    port: 9000,
    useSsl: false,
    accessKey: "test-access-key",
    secretKey: "test-secret-key",
    bucket: "family-learning-videos",
    publicUrl: "http://localhost:19000",
  },
  appOrigin: "http://localhost:5173",
  appTimezone: "Asia/Shanghai",
  sessionSecret: "test-session-secret-that-is-long-enough",
};

type Admin = { id: string; email: string; passwordHash: string };
type Child = { id: string; name: string; status: "ACTIVE" | "DISABLED" };
type Session = {
  id: string;
  adminUserId: string;
  activeChildId: string | null;
  tokenHash: string;
  expiresAt: Date;
};

function makePrisma({ admins = [], children = [] }: { admins?: Admin[]; children?: Child[] } = {}) {
  const state = { admins: [...admins], children: [...children], sessions: [] as Session[] };
  const client = {
    adminUser: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) =>
        state.admins.find((admin) =>
          where.email !== undefined ? admin.email === where.email : admin.id === where.id,
        ) ?? null,
      ),
      findMany: vi.fn(async () => [...state.admins]),
      count: vi.fn(async () => state.admins.length),
      create: vi.fn(async ({ data }: { data: Omit<Admin, "id"> }) => {
        const admin = { id: `admin-${state.admins.length + 1}`, ...data };
        state.admins.push(admin);
        return admin;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Admin> }) => {
        const admin = state.admins.find((candidate) => candidate.id === where.id);
        if (!admin) throw new Error("Admin not found");
        Object.assign(admin, data);
        return admin;
      }),
    },
    session: {
      findUnique: vi.fn(async ({ where, include }: { where: { tokenHash: string }; include?: object }) => {
        const session = state.sessions.find((candidate) => candidate.tokenHash === where.tokenHash);
        if (!session) return null;
        const adminUser = state.admins.find((admin) => admin.id === session.adminUserId) ?? null;
        const activeChild = state.children.find((child) => child.id === session.activeChildId) ?? null;
        return include ? { ...session, adminUser, activeChild } : session;
      }),
      create: vi.fn(async ({ data }: { data: Omit<Session, "id"> }) => {
        const session = { id: `session-${state.sessions.length + 1}`, ...data };
        state.sessions.push(session);
        return session;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Session> }) => {
        const session = state.sessions.find((candidate) => candidate.id === where.id);
        if (!session) throw new Error("Session not found");
        Object.assign(session, data);
        return session;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { id?: string; adminUserId?: string } }) => {
        const before = state.sessions.length;
        state.sessions = state.sessions.filter((session) =>
          where.id !== undefined
            ? session.id !== where.id
            : where.adminUserId !== undefined && session.adminUserId !== where.adminUserId,
        );
        return { count: before - state.sessions.length };
      }),
    },
    child: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; status: "ACTIVE" } }) =>
        state.children.find((child) => child.id === where.id && child.status === where.status) ?? null,
      ),
    },
    $disconnect: vi.fn(async () => undefined),
    $transaction: vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) => callback(client)),
    $queryRaw: vi.fn(async () => []),
  };

  return { prisma: client as unknown as PrismaClient, state };
}

async function createAdmin(email = "parent@example.com"): Promise<Admin> {
  return { id: "admin-1", email, passwordHash: await hashPassword("correct horse battery staple") };
}

function sessionTokenFrom(response: { headers: Record<string, unknown> }): string {
  const setCookie = response.headers["set-cookie"] as string;
  const match = setCookie.match(/(?:^|,\s*)fl_parent_session=([^;,]+)/u);
  if (!match) throw new Error("Session cookie not found");
  return match[1];
}

describe("parent authentication routes", () => {
  let app: ReturnType<typeof buildApp> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("returns an anonymous session with a CSRF token when no session exists", async () => {
    const { prisma, state } = makePrisma();
    app = buildApp({ config, prisma } as Parameters<typeof buildApp>[0]);

    const response = await app.inject({ method: "GET", url: "/api/auth/session" });

    expect(state.admins).toHaveLength(0);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ authenticated: false, activeChildId: null });
    expect(response.json().csrfToken).toEqual(expect.any(String));
    expect(response.json().csrfToken.length).toBeGreaterThan(20);
  });

  it("does not expose a public registration route", async () => {
    const { prisma } = makePrisma();
    app = buildApp({ config, prisma } as Parameters<typeof buildApp>[0]);

    const response = await app.inject({ method: "POST", url: "/api/auth/register" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: expect.any(String), message: expect.any(String) },
    });
  });

  it("uses one generic response for unknown accounts and incorrect passwords", async () => {
    const { prisma } = makePrisma({ admins: [await createAdmin()] });
    app = buildApp({ config, prisma } as Parameters<typeof buildApp>[0]);
    const csrfToken = (await app.inject({ method: "GET", url: "/api/auth/session" })).json().csrfToken;
    const headers = { origin: config.appOrigin, "x-csrf-token": csrfToken };

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers,
      payload: { email: "parent@example.com", password: "incorrect password" },
    });
    const unknownAccount = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers,
      payload: { email: "nobody@example.com", password: "incorrect password" },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownAccount.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownAccount.json());
    expect(wrongPassword.json()).toMatchObject({ error: { code: "INVALID_CREDENTIALS" } });
  });

  it("rejects passwords below the parent minimum length", async () => {
    const { prisma } = makePrisma({ admins: [await createAdmin()] });
    app = buildApp({ config, prisma } as Parameters<typeof buildApp>[0]);
    const csrfToken = (await app.inject({ method: "GET", url: "/api/auth/session" })).json().csrfToken;

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: config.appOrigin, "x-csrf-token": csrfToken },
      payload: { email: "parent@example.com", password: "short" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("sets a seven-day HttpOnly, SameSite=Lax cookie and stores only its SHA-256 hash", async () => {
    const { prisma, state } = makePrisma({ admins: [await createAdmin()] });
    app = buildApp({ config, prisma } as Parameters<typeof buildApp>[0]);
    const csrfToken = (await app.inject({ method: "GET", url: "/api/auth/session" })).json().csrfToken;

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: config.appOrigin, "x-csrf-token": csrfToken },
      payload: { email: "parent@example.com", password: "correct horse battery staple" },
    });

    const rawToken = sessionTokenFrom(response);
    const cookie = response.headers["set-cookie"] as string;
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ authenticated: true, csrfToken: expect.any(String) });
    expect(cookie).toMatch(/HttpOnly/iu);
    expect(cookie).toMatch(/SameSite=Lax/iu);
    expect(cookie).toMatch(/Max-Age=604800/iu);
    expect(cookie).not.toMatch(/; Secure(?:;|$)/iu);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].tokenHash).toBe(createHash("sha256").update(rawToken).digest("hex"));
    expect(state.sessions[0].tokenHash).not.toBe(rawToken);
    expect(state.sessions[0].expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
    expect(state.sessions[0].expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 7 * 24 * 60 * 60 * 1000);
  });

  it("sets Secure cookies in production", async () => {
    const productionConfig = {
      ...config,
      nodeEnv: "production" as const,
      appOrigin: "https://learn.example.com",
      secureCookies: true,
    };
    const { prisma } = makePrisma({ admins: [await createAdmin()] });
    app = buildApp({ config: productionConfig, prisma } as Parameters<typeof buildApp>[0]);
    const csrfToken = (await app.inject({ method: "GET", url: "/api/auth/session" })).json().csrfToken;

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: productionConfig.appOrigin, "x-csrf-token": csrfToken },
      payload: { email: "parent@example.com", password: "correct horse battery staple" },
    });

    expect(response.headers["set-cookie"]).toMatch(/; Secure(?:;|$)/iu);
  });

  it("rejects cookie-based writes without a valid exact Origin and CSRF header", async () => {
    const { prisma } = makePrisma({ admins: [await createAdmin()] });
    app = buildApp({ config, prisma } as Parameters<typeof buildApp>[0]);
    const csrfToken = (await app.inject({ method: "GET", url: "/api/auth/session" })).json().csrfToken;
    const payload = { email: "parent@example.com", password: "correct horse battery staple" };

    const missingCsrf = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: config.appOrigin },
      payload,
    });
    const wrongOrigin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: `${config.appOrigin}.attacker.invalid`, "x-csrf-token": csrfToken },
      payload,
    });

    expect(missingCsrf.statusCode).toBe(403);
    expect(wrongOrigin.statusCode).toBe(403);
    expect(missingCsrf.json().error.code).toBe("CSRF_INVALID");
  });

  it("revokes the database session immediately on logout", async () => {
    const { prisma, state } = makePrisma({ admins: [await createAdmin()] });
    app = buildApp({ config, prisma } as Parameters<typeof buildApp>[0]);
    const anonCsrf = (await app.inject({ method: "GET", url: "/api/auth/session" })).json().csrfToken;
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: config.appOrigin, "x-csrf-token": anonCsrf },
      payload: { email: "parent@example.com", password: "correct horse battery staple" },
    });
    const rawToken = sessionTokenFrom(login);
    const csrfToken = login.json().csrfToken;

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        origin: config.appOrigin,
        "x-csrf-token": csrfToken,
        cookie: `fl_parent_session=${rawToken}`,
      },
    });
    const session = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: `fl_parent_session=${rawToken}` },
    });

    expect(logout.statusCode).toBe(204);
    expect(state.sessions).toHaveLength(0);
    expect(session.json()).toMatchObject({ authenticated: false });
  });

  it("allows selecting only an ACTIVE child and writes the choice to this session", async () => {
    const { prisma, state } = makePrisma({
      admins: [await createAdmin()],
      children: [
        { id: "active-child", name: "Active", status: "ACTIVE" },
        { id: "disabled-child", name: "Disabled", status: "DISABLED" },
      ],
    });
    app = buildApp({ config, prisma } as Parameters<typeof buildApp>[0]);
    const anonCsrf = (await app.inject({ method: "GET", url: "/api/auth/session" })).json().csrfToken;
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: config.appOrigin, "x-csrf-token": anonCsrf },
      payload: { email: "parent@example.com", password: "correct horse battery staple" },
    });
    const cookie = `fl_parent_session=${sessionTokenFrom(login)}`;

    const active = await app.inject({
      method: "PUT",
      url: "/api/auth/active-child",
      headers: { origin: config.appOrigin, "x-csrf-token": login.json().csrfToken, cookie },
      payload: { childId: "active-child" },
    });
    const disabled = await app.inject({
      method: "PUT",
      url: "/api/auth/active-child",
      headers: { origin: config.appOrigin, "x-csrf-token": login.json().csrfToken, cookie },
      payload: { childId: "disabled-child" },
    });

    expect(active.statusCode).toBe(200);
    expect(active.json()).toMatchObject({ activeChildId: "active-child" });
    expect(state.sessions[0].activeChildId).toBe("active-child");
    expect(disabled.statusCode).toBe(404);
    expect(state.sessions[0].activeChildId).toBe("active-child");
  });

  it("clears a previously selected child after the child is disabled", async () => {
    const rawToken = "s".repeat(43);
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const admin = await createAdmin();
    const { prisma, state } = makePrisma({
      admins: [admin],
      children: [{ id: "disabled-child", name: "Disabled", status: "DISABLED" }],
    });
    state.sessions.push({
      id: "existing-session",
      adminUserId: admin.id,
      activeChildId: "disabled-child",
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
    });
    app = buildApp({ config, prisma } as Parameters<typeof buildApp>[0]);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: `fl_parent_session=${rawToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      authenticated: true,
      activeChildId: null,
      activeChild: null,
    });
    expect(state.sessions[0].activeChildId).toBeNull();
  });

  it("limits login attempts by IP and normalized account", async () => {
    const { prisma } = makePrisma({ admins: [await createAdmin()] });
    app = buildApp({ config, prisma } as Parameters<typeof buildApp>[0]);
    const csrfToken = (await app.inject({ method: "GET", url: "/api/auth/session" })).json().csrfToken;
    const attempt = (email: string, remoteAddress: string) =>
      app!.inject({
        method: "POST",
        url: "/api/auth/login",
        remoteAddress,
        headers: { origin: config.appOrigin, "x-csrf-token": csrfToken },
        payload: { email, password: "wrong password" },
      });

    const firstAccountAttempts = [];
    for (let attemptNumber = 0; attemptNumber < 5; attemptNumber += 1) {
      firstAccountAttempts.push(
        await attempt("parent@example.com", "2001:db8:abcd:1234::1"),
      );
    }
    const blocked = await attempt("parent@example.com", "2001:db8:abcd:1234::2");
    const otherAccount = await attempt("another@example.com", "2001:db8:abcd:1234::2");

    expect(firstAccountAttempts.every((response) => response.statusCode === 401)).toBe(true);
    expect(blocked.statusCode, JSON.stringify(blocked.json())).toBe(429);
    expect(blocked.json()).toMatchObject({ error: { code: expect.any(String) } });
    expect(otherAccount.statusCode).toBe(401);
  });

  it("caps login attempts per IP so many account names cannot displace the account bucket", async () => {
    const { prisma } = makePrisma();
    app = buildApp({ config, prisma } as Parameters<typeof buildApp>[0]);
    const csrfToken = (await app.inject({ method: "GET", url: "/api/auth/session" })).json().csrfToken;
    const attempt = (index: number) =>
      app!.inject({
        method: "POST",
        url: "/api/auth/login",
        remoteAddress: "2001:db8:abcd:1234::1",
        headers: { origin: config.appOrigin, "x-csrf-token": csrfToken },
        payload: { email: `account-${index}@example.com`, password: "wrong password" },
      });

    const attempts = [];
    for (let index = 0; index < 30; index += 1) attempts.push(await attempt(index));
    const blocked = await attempt(30);

    expect(attempts.every((response) => response.statusCode === 401)).toBe(true);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it("bounds malformed account identifiers used by the in-memory rate-limit key", async () => {
    const { prisma } = makePrisma();
    app = buildApp({ config, prisma } as Parameters<typeof buildApp>[0]);
    const csrfToken = (await app.inject({ method: "GET", url: "/api/auth/session" })).json().csrfToken;
    const commonPrefix = "a".repeat(254);
    const attempt = (suffix: string) =>
      app!.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: config.appOrigin, "x-csrf-token": csrfToken },
        payload: { email: `${commonPrefix}${suffix}@example.com`, password: "wrong password" },
      });

    const firstAttempts = [];
    for (let attemptNumber = 0; attemptNumber < 5; attemptNumber += 1) {
      firstAttempts.push(await attempt(String(attemptNumber)));
    }
    const boundedAccount = await attempt("overflow");

    expect(firstAttempts.every((response) => response.statusCode === 400)).toBe(true);
    expect(boundedAccount.statusCode, JSON.stringify(boundedAccount.json())).toBe(429);
  });

  it("protects parent routes and does not log passwords, CSRF tokens, or query strings", async () => {
    const logOutput: string[] = [];
    const loggerStream = new Writable({
      write(chunk, _encoding, callback) {
        logOutput.push(chunk.toString());
        callback();
      },
    });
    const { prisma } = makePrisma({ admins: [await createAdmin()] });
    const developmentConfig = { ...config, nodeEnv: "development" as const };
    app = buildApp({ config: developmentConfig, prisma, loggerStream } as Parameters<typeof buildApp>[0]);
    const parentApp = app as typeof app & {
      requireParent: (request: unknown, reply: unknown) => Promise<void>;
    };
    parentApp.get("/api/parent/protected", { preHandler: parentApp.requireParent }, async () => ({ ok: true }));

    const anonymous = await app.inject({ method: "GET", url: "/api/parent/protected" });
    const csrfToken = (await app.inject({ method: "GET", url: "/api/auth/session" })).json().csrfToken;
    const badLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login?secret=query-sentinel",
      headers: { origin: config.appOrigin, "x-csrf-token": csrfToken },
      payload: { email: "parent@example.com", password: "password-sentinel" },
    });

    const logs = logOutput.join("");
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
    expect(badLogin.statusCode).toBe(401);
    expect(logs).not.toContain("password-sentinel");
    expect(logs).not.toContain(csrfToken);
    expect(logs).not.toContain("query-sentinel");
    expect(logs).not.toContain("?secret=");
  });
});

describe("password hashing", () => {
  it("stores passwords as Argon2id hashes rather than plaintext", async () => {
    const password = "sensitive-test-password";
    const passwordHash = await hashPassword(password);

    expect(passwordHash).toMatch(/^\$argon2id\$/u);
    expect(passwordHash).not.toContain(password);
  });
});

describe("single parent administrator setup", () => {
  it("creates exactly one administrator with a normalized email and Argon2id hash", async () => {
    const { prisma, state } = makePrisma();

    await provisionAdmin(prisma, {
      email: " Parent@Example.com ",
      password: "a sufficiently long password",
      reset: false,
    });

    expect(state.admins).toHaveLength(1);
    expect(state.admins[0].email).toBe("parent@example.com");
    expect(state.admins[0].passwordHash).toMatch(/^\$argon2id\$/u);
    await expect(
      provisionAdmin(prisma, {
        email: "parent@example.com",
        password: "another sufficiently long password",
        reset: false,
      }),
    ).rejects.toThrow(/already exists/u);
    expect(state.admins).toHaveLength(1);
  });

  it("rejects password arguments without echoing them", () => {
    const password = "argv-password-sentinel";

    expect(() => parseCreateAdminArgs(["--password", password])).toThrow();
    try {
      parseCreateAdminArgs(["--password", password]);
    } catch (error) {
      expect((error as Error).message).not.toContain(password);
    }
  });

  it("rejects whitespace-only passwords before touching administrator data", async () => {
    const { prisma } = makePrisma();

    await expect(
      provisionAdmin(prisma, { email: "parent@example.com", password: " ".repeat(12), reset: false }),
    ).rejects.toThrow();
    expect(prisma.adminUser.create).not.toHaveBeenCalled();
  });

  it("rejects short passwords before hashing or touching administrator data", async () => {
    const { prisma } = makePrisma();

    await expect(
      provisionAdmin(prisma, { email: "parent@example.com", password: "tiny", reset: false }),
    ).rejects.toThrow();
    expect(prisma.adminUser.create).not.toHaveBeenCalled();
  });

  it("rejects passwords longer than the login limit before touching administrator data", async () => {
    const { prisma } = makePrisma();

    await expect(
      provisionAdmin(prisma, {
        email: "parent@example.com",
        password: "x".repeat(1025),
        reset: false,
      }),
    ).rejects.toThrow();
    expect(prisma.adminUser.create).not.toHaveBeenCalled();
  });

  it("requires explicit reset mode and revokes existing sessions when resetting", async () => {
    const admin = await createAdmin();
    const { prisma, state } = makePrisma({ admins: [admin] });
    state.sessions.push({
      id: "existing-session",
      adminUserId: admin.id,
      activeChildId: null,
      tokenHash: "a".repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      provisionAdmin(prisma, {
        email: admin.email,
        password: "new secure password",
        reset: false,
      }),
    ).rejects.toThrow();
    await provisionAdmin(prisma, {
      email: admin.email,
      password: "new secure password",
      reset: true,
    });

    expect(state.admins).toHaveLength(1);
    expect(state.admins[0].passwordHash).toMatch(/^\$argon2id\$/u);
    expect(state.sessions).toHaveLength(0);
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it("reads a password from a TTY without writing its characters to the prompt", async () => {
    const input = new PassThrough() as PassThrough & {
      isTTY: boolean;
      setRawMode: (enabled: boolean) => void;
    };
    input.isTTY = true;
    input.setRawMode = vi.fn();
    const output: string[] = [];
    const password = "hidden-password-sentinel";

    const read = readHiddenPassword(input as never, { write: (chunk: string) => output.push(chunk) });
    input.write(`${password}\r`);

    await expect(read).resolves.toBe(password);
    expect(output.join("")).not.toContain(password);
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it("treats Ctrl-D as cancellation and restores terminal mode", async () => {
    const input = new PassThrough() as PassThrough & {
      isTTY: boolean;
      setRawMode: (enabled: boolean) => void;
    };
    input.isTTY = true;
    input.setRawMode = vi.fn();

    const read = readHiddenPassword(input as never, { write: () => undefined });
    input.write("\u0004");

    await expect(read).rejects.toThrow(/cancelled/u);
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it("does not disconnect a Prisma client owned by the caller", async () => {
    const { prisma } = makePrisma();
    const injectedApp = buildApp({ config, prisma } as Parameters<typeof buildApp>[0]);

    await injectedApp.close();

    expect(prisma.$disconnect).not.toHaveBeenCalled();
  });
});
