import { createHash, createHmac, randomBytes } from "node:crypto";
import { normalizeIP } from "@fastify/rate-limit";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  createAnonymousCsrfToken,
  createSessionCsrfToken,
  resolveParentSession,
} from "../plugins/auth.js";
import {
  isAcceptableParentPassword,
  verifyPassword,
} from "../auth/password.js";

const loginBodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().refine(isAcceptableParentPassword),
});

const activeChildBodySchema = z.object({
  childId: z.string().min(1).max(128),
});

const maxLoginAttemptsPerIp = 30;
const maxLoginAttemptsPerAccountAndIp = 5;
// Fail closed rather than evict an active limiter window under high-cardinality traffic.
const maxTrackedLoginIps = 10_000;
// At most two fixed IP windows can overlap a rolling account window.
const maxTrackedAccountsPerIp = maxLoginAttemptsPerIp * 2;
const loginWindowMs = 15 * 60 * 1000;

type AccountLoginBucket = { count: number; expiresAt: number };
type IpLoginBucket = {
  count: number;
  expiresAt: number;
  accounts: Map<string, AccountLoginBucket>;
};

function errorResponse(code: string, message: string) {
  return { error: { code, message } };
}

async function createParentSession(
  prisma: PrismaClient,
  config: AppConfig,
  reply: FastifyReply,
  admin: { id: string; email: string },
) {
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + config.sessionLifetimeSeconds * 1000);
  const session = await prisma.session.create({
    data: { adminUserId: admin.id, tokenHash, expiresAt },
  });

  reply.setCookie(config.sessionCookieName, rawToken, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
    maxAge: config.sessionLifetimeSeconds,
  });

  return {
    authenticated: true,
    admin: { id: admin.id, email: admin.email },
    activeChildId: null,
    activeChild: null,
    csrfToken: createSessionCsrfToken(config.sessionSecret, session.tokenHash),
  };
}

function accountRateLimitKey(request: FastifyRequest, config: AppConfig): string {
  const body = request.body;
  const email =
    typeof body === "object" && body !== null && "email" in body &&
    typeof body.email === "string"
      ? body.email.trim().toLowerCase().slice(0, 254)
      : "invalid-account";
  return createHmac("sha256", config.sessionSecret)
    .update(normalizeIP(request.ip, 64))
    .update("\0")
    .update(email)
    .digest("base64url");
}

export function registerAuthRoutes(
  app: FastifyInstance,
  config: AppConfig,
  prisma: PrismaClient,
): void {
  const loginIpBuckets = new Map<string, IpLoginBucket>();
  const loginIpLimit = createLoginIpLimit(loginIpBuckets, config);

  app.get("/api/auth/session", async (request, reply) => {
    const rawToken = request.cookies[config.sessionCookieName];
    const session = await resolveParentSession(prisma, config, rawToken);
    if (!session && config.authBypass) {
      const admin = await prisma.adminUser.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true, email: true },
      });
      if (!admin) {
        return reply.code(503).send(errorResponse(
          "AUTH_BYPASS_UNAVAILABLE",
          "尚未创建家长管理员，请先完成服务器初始化。",
        ));
      }
      return createParentSession(prisma, config, reply, admin);
    }

    if (!session) {
      if (rawToken) reply.clearCookie(config.sessionCookieName, { path: "/", sameSite: "lax" });
      return {
        authenticated: false,
        activeChildId: null,
        csrfToken: createAnonymousCsrfToken(config.sessionSecret),
      };
    }

    return {
      authenticated: true,
      admin: { id: session.adminUser.id, email: session.adminUser.email },
      activeChildId: session.activeChildId,
      activeChild: session.activeChild
        ? { id: session.activeChild.id, name: session.activeChild.name }
        : null,
      csrfToken: createSessionCsrfToken(config.sessionSecret, session.tokenHash),
    };
  });

  app.post(
    "/api/auth/login",
    {
      preHandler: loginIpLimit,
    },
    async (request, reply) => {
      if (config.authBypass) {
        return reply.code(404).send(errorResponse("LOGIN_DISABLED", "Password login is disabled"));
      }
      const parsed = loginBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(errorResponse("BAD_REQUEST", "Email and password are required"));
      }

      const email = parsed.data.email;
      const admin = await prisma.adminUser.findUnique({ where: { email } });
      const passwordMatches = await verifyPassword(parsed.data.password, admin?.passwordHash);
      if (!admin || !passwordMatches) {
        return reply.code(401).send(
          errorResponse("INVALID_CREDENTIALS", "Email or password is incorrect"),
        );
      }

      return reply.code(200).send(await createParentSession(prisma, config, reply, admin));
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    if (request.parentSession) {
      await prisma.session.deleteMany({ where: { id: request.parentSession.id } });
    }
    reply.clearCookie(config.sessionCookieName, { path: "/", sameSite: "lax" });
    return reply.code(204).send();
  });

  app.put("/api/auth/active-child", async (request, reply) => {
    const session = request.parentSession;
    if (!session) {
      return reply.code(401).send(errorResponse("AUTH_REQUIRED", "Parent authentication is required"));
    }
    const parsed = activeChildBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse("BAD_REQUEST", "A child ID is required"));
    }

    const child = await prisma.child.findFirst({
      where: { id: parsed.data.childId, status: "ACTIVE" },
      select: { id: true, name: true },
    });
    if (!child) {
      return reply.code(404).send(errorResponse("ACTIVE_CHILD_NOT_FOUND", "Active child not found"));
    }

    await prisma.session.update({
      where: { id: session.id },
      data: { activeChildId: child.id },
    });
    return {
      activeChildId: child.id,
      activeChild: { id: child.id, name: child.name },
    };
  });
}

function createLoginIpLimit(
  buckets: Map<string, IpLoginBucket>,
  config: AppConfig,
): preHandlerHookHandler {
  return async (request, reply) => {
    const now = Date.now();
    const ipKey = normalizeIP(request.ip, 64);
    let bucket = buckets.get(ipKey);

    if (!bucket) {
      pruneExpiredLoginBuckets(buckets, now);
      if (buckets.size >= maxTrackedLoginIps) return loginRateLimitError(reply);

      bucket = { count: 0, expiresAt: now + loginWindowMs, accounts: new Map() };
      buckets.set(ipKey, bucket);
    }

    pruneExpiredAccountBuckets(bucket, now);
    if (bucket.expiresAt <= now) {
      bucket.count = 0;
      bucket.expiresAt = now + loginWindowMs;
    }

    const accountKey = accountRateLimitKey(request, config);
    let accountBucket = bucket.accounts.get(accountKey);
    if (!accountBucket) {
      if (bucket.accounts.size >= maxTrackedAccountsPerIp) return loginRateLimitError(reply);
      accountBucket = { count: 0, expiresAt: now + loginWindowMs };
      bucket.accounts.set(accountKey, accountBucket);
    }

    bucket.count = Math.min(bucket.count + 1, maxLoginAttemptsPerIp + 1);
    accountBucket.count = Math.min(
      accountBucket.count + 1,
      maxLoginAttemptsPerAccountAndIp + 1,
    );
    if (
      bucket.count > maxLoginAttemptsPerIp ||
      accountBucket.count > maxLoginAttemptsPerAccountAndIp
    ) {
      return loginRateLimitError(reply);
    }
  };
}

function pruneExpiredAccountBuckets(bucket: IpLoginBucket, now: number): void {
  for (const [key, accountBucket] of bucket.accounts) {
    if (accountBucket.expiresAt <= now) bucket.accounts.delete(key);
  }
}

function pruneExpiredLoginBuckets(buckets: Map<string, IpLoginBucket>, now: number): void {
  for (const [key, bucket] of buckets) {
    pruneExpiredAccountBuckets(bucket, now);
    if (bucket.expiresAt <= now && bucket.accounts.size === 0) buckets.delete(key);
  }
}

function loginRateLimitError(reply: FastifyReply) {
  return reply.code(429).send({
    error: { code: "RATE_LIMITED", message: "Too many login attempts; try again later" },
  });
}
