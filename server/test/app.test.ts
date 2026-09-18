import { afterEach, describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { buildApp } from "../src/app";
import { parseConfig, type AppConfig } from "../src/config";

const productionEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://family:secret@db.example.com:5432/family",
  TRUSTED_PROXIES: "172.30.0.2",
  MINIO_ENDPOINT: "minio.example.com",
  MINIO_PORT: "9000",
  MINIO_USE_SSL: "true",
  MINIO_ACCESS_KEY: "minio-access-key",
  MINIO_SECRET_KEY: "minio-secret-key",
  MINIO_BUCKET: "family-learning-videos",
  MINIO_PUBLIC_URL: "https://media.example.com",
  APP_ORIGIN: "https://learn.example.com",
  APP_TIMEZONE: "Asia/Shanghai",
  SESSION_SECRET: "p".repeat(32),
  PORT: "8080",
};

const productionRequiredKeys = [
  "DATABASE_URL",
  "TRUSTED_PROXIES",
  "MINIO_ENDPOINT",
  "MINIO_PORT",
  "MINIO_USE_SSL",
  "MINIO_ACCESS_KEY",
  "MINIO_SECRET_KEY",
  "MINIO_BUCKET",
  "MINIO_PUBLIC_URL",
  "APP_ORIGIN",
  "SESSION_SECRET",
] as const;

const testConfig: AppConfig = {
  nodeEnv: "test",
  port: 3000,
  sessionCookieName: "fl_parent_session",
  sessionLifetimeSeconds: 7 * 24 * 60 * 60,
  secureCookies: false,
  authBypass: false,
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

describe("GET /api/health", () => {
  let app: ReturnType<typeof buildApp> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("returns the health status from an injected app without listening", async () => {
    app = buildApp({ config: testConfig });

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(app.server.listening).toBe(false);
  });

  it("redacts query strings and authentication headers from request logs", async () => {
    const logOutput: string[] = [];
    const loggerStream = new Writable({
      write(chunk, _encoding, callback) {
        logOutput.push(chunk.toString());
        callback();
      },
    });

    app = buildApp({
      config: { ...testConfig, nodeEnv: "development" },
      loggerStream,
    });

    await app.inject({
      method: "GET",
      url: "/api/health?token=query-sentinel",
      headers: {
        cookie: "cookie-sentinel",
        authorization: "Bearer authorization-sentinel",
        referer: "https://learn.example.com/watch?token=referer-sentinel",
      },
    });

    const output = logOutput.join("");
    expect(output).toContain("/api/health");
    expect(output).not.toContain("/api/health?");
    expect(output).not.toContain("query-sentinel");
    expect(output).not.toContain("cookie-sentinel");
    expect(output).not.toContain("authorization-sentinel");
    expect(output).not.toContain("referer-sentinel");
  });

  it("uses forwarded client addresses only from explicitly trusted proxy IPs", async () => {
    app = buildApp({
      config: { ...testConfig, trustedProxies: ["127.0.0.1"] },
    });
    app.get("/api/test/client-ip", async (request) => ({ ip: request.ip }));

    const fromTrustedProxy = await app.inject({
      method: "GET",
      url: "/api/test/client-ip",
      remoteAddress: "127.0.0.1",
      headers: { "x-forwarded-for": "198.51.100.11" },
    });
    const fromUntrustedPeer = await app.inject({
      method: "GET",
      url: "/api/test/client-ip",
      remoteAddress: "192.0.2.10",
      headers: { "x-forwarded-for": "198.51.100.12" },
    });

    expect(fromTrustedProxy.json()).toEqual({ ip: "198.51.100.11" });
    expect(fromUntrustedPeer.json()).toEqual({ ip: "192.0.2.10" });
  });
});

describe("parseConfig", () => {
  it("accepts a complete production config and maps its key fields", () => {
    const config = parseConfig(productionEnv);

    expect(config.nodeEnv).toBe("production");
    expect(config.authBypass).toBe(true);
    expect(config.databaseUrl).toBe(productionEnv.DATABASE_URL);
    expect(config.minio).toEqual({
      endpoint: productionEnv.MINIO_ENDPOINT,
      port: 9000,
      useSsl: true,
      accessKey: productionEnv.MINIO_ACCESS_KEY,
      secretKey: productionEnv.MINIO_SECRET_KEY,
      bucket: productionEnv.MINIO_BUCKET,
      publicUrl: productionEnv.MINIO_PUBLIC_URL,
    });
    expect(config.appOrigin).toBe(productionEnv.APP_ORIGIN);
    expect(config.trustedProxies).toEqual(["172.30.0.2"]);
    expect(config.sessionSecret).toBe(productionEnv.SESSION_SECRET);
  });

  it("applies only the safe local defaults in development", () => {
    const config = parseConfig({
      NODE_ENV: "development",
      MINIO_ACCESS_KEY: "local-access-key",
      MINIO_SECRET_KEY: "local-secret-key",
      SESSION_SECRET: "d".repeat(32),
    });

    expect(config.port).toBe(3000);
    expect(config.minio.port).toBe(19000);
    expect(config.minio.useSsl).toBe(false);
    expect(config.minio.bucket).toBe("family-learning-videos");
    expect(config.appTimezone).toBe("Asia/Shanghai");
    expect(config.appOrigin).toBe("http://localhost:5173");
    expect(config.authBypass).toBe(true);
    expect(config.databaseUrl).toBe(
      "postgresql://family_learning:family_learning_dev@localhost:5432/family_learning",
    );
    expect(config.minio.endpoint).toBe("localhost");
    expect(config.minio.publicUrl).toBe("http://localhost:19000");
  });

  it("does not default credential secrets in any environment", () => {
    expect(() => parseConfig({ NODE_ENV: "development" })).toThrow();
  });

  it("allows disabling auth bypass explicitly", () => {
    expect(parseConfig({ ...productionEnv, AUTH_BYPASS: "false" }).authBypass).toBe(false);
  });

  it("requires database, MinIO, origin, and session settings in production", () => {
    expect(() => parseConfig({ NODE_ENV: "production" })).toThrow();
  });

  it.each(productionRequiredKeys)(
    "rejects production config with %s omitted",
    (key) => {
      const env: Record<string, string> = { ...productionEnv };
      delete env[key];

      expect(() => parseConfig(env)).toThrow();
    },
  );

  it("requires a production session secret of at least 32 characters", () => {
    expect(() =>
      parseConfig({ ...productionEnv, SESSION_SECRET: "too-short" }),
    ).toThrow();
  });

  it.each(["http://media.example.com", "https://media.example.com/storage", "https://user:pass@media.example.com"])(
    "rejects a non-HTTPS or path-based public MinIO URL in production: %s",
    (publicUrl) => {
      expect(() => parseConfig({ ...productionEnv, MINIO_PUBLIC_URL: publicUrl })).toThrow();
    },
  );

  it("requires HTTPS for the public application origin in production", () => {
    expect(() => parseConfig({ ...productionEnv, APP_ORIGIN: "http://learn.example.com" })).toThrow();
  });

  it.each(["0.0.0.0", "::", "example.com", "172.30.0.2/24"])(
    "rejects non-exact production trusted proxy entries: %s",
    (address) => {
      expect(() => parseConfig({ ...productionEnv, TRUSTED_PROXIES: address })).toThrow();
    },
  );

  it.each([
    ["MINIO_ENDPOINT", "   "],
    ["MINIO_ACCESS_KEY", "   "],
    ["MINIO_SECRET_KEY", "   "],
    ["MINIO_BUCKET", "   "],
    ["SESSION_SECRET", " ".repeat(32)],
  ] as const)(
    "rejects production %s containing only whitespace",
    (key, value) => {
      expect(() => parseConfig({ ...productionEnv, [key]: value })).toThrow();
    },
  );
});
