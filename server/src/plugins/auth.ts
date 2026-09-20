import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { AppConfig } from "../config.js";

export type ParentSession = {
  id: string;
  adminUserId: string;
  activeChildId: string | null;
  parentUnlockedAt: Date | null;
  tokenHash: string;
  expiresAt: Date;
  adminUser: { id: string; email: string };
  activeChild: { id: string; name: string; status: "ACTIVE" | "DISABLED" } | null;
};

declare module "fastify" {
  interface FastifyRequest {
    parentSession: ParentSession | null;
  }

  interface FastifyInstance {
    requireParent: preHandlerHookHandler;
    requireParentUnlocked: preHandlerHookHandler;
  }
}

const anonymousCsrfLifetimeSeconds = 15 * 60;
const anonymousNoncePattern = /^[A-Za-z0-9_-]{22}$/u;
const signaturePattern = /^[A-Za-z0-9_-]{43}$/u;
const sessionTokenPattern = /^[A-Za-z0-9_-]{43}$/u;

function sign(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function fixedTimeEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function createAnonymousCsrfToken(secret: string, now = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + anonymousCsrfLifetimeSeconds;
  const nonce = randomBytes(16).toString("base64url");
  const payload = `anonymous.${expiresAt}.${nonce}`;
  return `${payload}.${sign(secret, payload)}`;
}

export function createSessionCsrfToken(secret: string, tokenHash: string): string {
  return sign(secret, `session.${tokenHash}`);
}

export function verifyCsrfToken(
  candidate: string | undefined,
  secret: string,
  sessionTokenHash: string | null,
  now = Date.now(),
): boolean {
  if (!candidate) return false;

  if (sessionTokenHash) {
    if (!signaturePattern.test(candidate)) return false;
    return fixedTimeEqual(candidate, createSessionCsrfToken(secret, sessionTokenHash));
  }

  const [kind, expiryValue, nonce, signature, extra] = candidate.split(".");
  if (kind !== "anonymous" || extra !== undefined || !anonymousNoncePattern.test(nonce ?? "")) {
    return false;
  }

  const expiresAt = Number(expiryValue);
  const nowSeconds = Math.floor(now / 1000);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= nowSeconds ||
    expiresAt > nowSeconds + anonymousCsrfLifetimeSeconds ||
    !signaturePattern.test(signature ?? "")
  ) {
    return false;
  }

  const payload = `anonymous.${expiryValue}.${nonce}`;
  return fixedTimeEqual(signature, sign(secret, payload));
}

export async function resolveParentSession(
  prisma: PrismaClient,
  config: AppConfig,
  rawToken: string | undefined,
): Promise<ParentSession | null> {
  if (!rawToken || !sessionTokenPattern.test(rawToken)) return null;

  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: {
      adminUser: { select: { id: true, email: true } },
      activeChild: { select: { id: true, name: true, status: true } },
    },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  if (session.activeChild && session.activeChild.status !== "ACTIVE") {
    await prisma.session.update({
      where: { id: session.id },
      data: { activeChildId: null },
    });
    session.activeChildId = null;
    session.activeChild = null;
  }
  return session as ParentSession;
}

function isWriteRequest(request: FastifyRequest): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
    request.url.startsWith("/api/");
}

function csrfError(reply: FastifyReply) {
  return reply.code(403).send({
    error: { code: "CSRF_INVALID", message: "Request origin or CSRF token is invalid" },
  });
}

export function installAuthProtection(
  app: FastifyInstance,
  config: AppConfig,
  prisma: PrismaClient,
): void {
  app.decorateRequest("parentSession", null);

  app.decorate("requireParent", async (request, reply) => {
    const session = request.parentSession ?? await resolveParentSession(
      prisma,
      config,
      request.cookies[config.sessionCookieName],
    );
    if (!session) {
      return reply.code(401).send({
        error: { code: "AUTH_REQUIRED", message: "Parent authentication is required" },
      });
    }
    request.parentSession = session;
  });

  app.decorate("requireParentUnlocked", async (request, reply) => {
    const session = request.parentSession ?? await resolveParentSession(
      prisma,
      config,
      request.cookies[config.sessionCookieName],
    );
    if (!session) {
      return reply.code(401).send({
        error: { code: "AUTH_REQUIRED", message: "Parent authentication is required" },
      });
    }
    request.parentSession = session;
    if (!config.authBypass && (!session.parentUnlockedAt || session.parentUnlockedAt.getTime() <= Date.now())) {
      return reply.code(423).send({
        error: { code: "PARENT_UNLOCK_REQUIRED", message: "Parent verification is required" },
      });
    }
  });

  app.addHook("preHandler", async (request, reply) => {
    if (request.is404 || !isWriteRequest(request)) return;
    if (!config.appAllowedOrigins.includes(request.headers.origin ?? "")) return csrfError(reply);

    const session = await resolveParentSession(
      prisma,
      config,
      request.cookies[config.sessionCookieName],
    );
    const csrfToken = request.headers["x-csrf-token"];
    if (
      !verifyCsrfToken(
        typeof csrfToken === "string" ? csrfToken : undefined,
        config.sessionSecret,
        session?.tokenHash ?? null,
      )
    ) {
      return csrfError(reply);
    }

    request.parentSession = session;
  });
}
