import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { parseConfig } from "../src/config";

const productionEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://family:secret@db.example.com:5432/family",
  MINIO_ENDPOINT: "minio.example.com",
  MINIO_PORT: "9000",
  MINIO_USE_SSL: "true",
  MINIO_ACCESS_KEY: "minio-access-key",
  MINIO_SECRET_KEY: "minio-secret-key",
  MINIO_BUCKET: "family-learning-videos",
  APP_ORIGIN: "https://learn.example.com",
  APP_TIMEZONE: "Asia/Shanghai",
  SESSION_SECRET: "p".repeat(32),
  PORT: "8080",
};

describe("GET /api/health", () => {
  let app: ReturnType<typeof buildApp> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("returns the health status from an injected app without listening", async () => {
    app = buildApp({
      config: {
        nodeEnv: "test",
        port: 3000,
        databaseUrl: "postgresql://test:test@localhost:5432/test",
        minio: {
          endpoint: "localhost",
          port: 9000,
          useSsl: false,
          accessKey: "test-access-key",
          secretKey: "test-secret-key",
          bucket: "family-learning-videos",
        },
        appOrigin: "http://localhost:5173",
        appTimezone: "Asia/Shanghai",
        sessionSecret: "test-session-secret-that-is-long-enough",
      },
    });

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(app.server.listening).toBe(false);
  });
});

describe("parseConfig", () => {
  it("applies only the safe local defaults in development", () => {
    const config = parseConfig({
      NODE_ENV: "development",
      MINIO_ACCESS_KEY: "local-access-key",
      MINIO_SECRET_KEY: "local-secret-key",
      SESSION_SECRET: "d".repeat(32),
    });

    expect(config.port).toBe(3000);
    expect(config.minio.port).toBe(9000);
    expect(config.minio.useSsl).toBe(false);
    expect(config.minio.bucket).toBe("family-learning-videos");
    expect(config.appTimezone).toBe("Asia/Shanghai");
    expect(config.appOrigin).toBe("http://localhost:5173");
    expect(config.databaseUrl).toBe(
      "postgresql://family_learning:family_learning_dev@localhost:5432/family_learning",
    );
    expect(config.minio.endpoint).toBe("localhost");
  });

  it("does not default credential secrets in any environment", () => {
    expect(() => parseConfig({ NODE_ENV: "development" })).toThrow();
  });

  it("requires database, MinIO, origin, and session settings in production", () => {
    expect(() => parseConfig({ NODE_ENV: "production" })).toThrow();
  });

  it("requires a production session secret of at least 32 characters", () => {
    expect(() =>
      parseConfig({ ...productionEnv, SESSION_SECRET: "too-short" }),
    ).toThrow();
  });
});
