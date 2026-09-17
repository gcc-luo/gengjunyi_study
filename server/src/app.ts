import helmet from "@fastify/helmet";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";

function stripQueryString(url: string): string {
  const queryStart = url.indexOf("?");
  return queryStart === -1 ? url : url.slice(0, queryStart);
}

export function buildApp({ config }: { config: AppConfig }): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.nodeEnv === "test" ? "silent" : "info",
      redact: {
        paths: ["req.headers.cookie", "req.headers.authorization"],
        censor: "[REDACTED]",
      },
      serializers: {
        req(request) {
          const headers = { ...request.headers };
          delete headers.cookie;
          delete headers.authorization;

          return {
            method: request.method,
            url: stripQueryString(request.url),
            hostname: request.hostname,
            headers,
          };
        },
      },
    },
  });

  void app.register(helmet);
  app.get("/api/health", async () => ({ status: "ok" }));

  return app;
}
