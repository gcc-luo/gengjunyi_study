import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import { createPrismaClient } from "./db.js";
import { installAuthProtection } from "./plugins/auth.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerChildrenRoutes } from "./routes/children.js";
import { registerCourseRoutes } from "./routes/courses.js";
import { registerChildContentRoutes } from "./routes/child-content.js";
import type { PrismaClient } from "./generated/prisma/client.js";

function stripQueryString(url: string): string {
  const queryStart = url.indexOf("?");
  return queryStart === -1 ? url : url.slice(0, queryStart);
}

export function buildApp({
  config,
  loggerStream,
  prisma: injectedPrisma,
}: {
  config: AppConfig;
  loggerStream?: { write(message: string): void };
  prisma?: PrismaClient;
}): FastifyInstance {
  const prisma = injectedPrisma ?? createPrismaClient(config.databaseUrl);
  const ownsPrisma = injectedPrisma === undefined;
  const app = Fastify({
    trustProxy: config.trustedProxies,
    logger: {
      level: config.nodeEnv === "test" ? "silent" : "info",
      ...(loggerStream ? { stream: loggerStream } : {}),
      redact: {
        paths: [
          "req.headers.cookie",
          "req.headers.authorization",
          "req.headers.x-csrf-token",
          "req.body",
          "req.cookies",
          'res.headers["set-cookie"]',
        ],
        censor: "[REDACTED]",
      },
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: stripQueryString(request.url),
            hostname: request.hostname,
          };
        },
      },
    },
  });

  void app.register(helmet);
  void app.register(cookie);
  installAuthProtection(app, config, prisma);
  void app.register(async (authScope) => {
    registerAuthRoutes(authScope, config, prisma);
  });
  void app.register(async (parentScope) => {
    registerChildrenRoutes(parentScope, prisma);
  });
  void app.register(async (parentScope) => {
    registerCourseRoutes(parentScope, prisma);
    registerChildContentRoutes(parentScope, prisma);
  });

  app.setErrorHandler((error, _request, reply) => {
    const candidateStatusCode =
      typeof error === "object" && error !== null && "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : undefined;
    const statusCode = candidateStatusCode && candidateStatusCode >= 400 ? candidateStatusCode : 500;
    const knownErrors: Record<number, { code: string; message: string }> = {
      400: { code: "BAD_REQUEST", message: "Request is invalid" },
      413: { code: "PAYLOAD_TOO_LARGE", message: "Request payload is too large" },
      415: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Request media type is not supported" },
    };
    const body = knownErrors[statusCode] ?? {
      code: "INTERNAL_ERROR",
      message: statusCode >= 500 ? "An unexpected error occurred" : "Request could not be completed",
    };
    return reply.code(statusCode).send({ error: body });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({
      error: { code: "ROUTE_NOT_FOUND", message: "Route not found" },
    }),
  );

  app.addHook("onClose", async () => {
    if (ownsPrisma) await prisma.$disconnect();
  });

  app.get("/api/health", async () => ({ status: "ok" }));

  return app;
}
