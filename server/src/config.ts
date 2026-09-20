import { isIP } from "node:net";
import { z } from "zod";

const nodeEnvSchema = z.enum(["development", "test", "production"]);

const booleanFromEnvironment = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

const nonWhitespaceString = z.string().refine((value) => /\S/u.test(value));
const trustedProxiesSchema = z.preprocess(
  (value) =>
    typeof value === "string"
      ? value.split(",").map((address) => address.trim()).filter(Boolean)
      : value ?? [],
  z.array(
    z.string().refine(
      (address) => isIP(address) !== 0 && address !== "0.0.0.0" && address !== "::",
      "TRUSTED_PROXIES must contain exact IPv4 or IPv6 addresses, not wildcard addresses",
    ),
  ),
);

const databaseUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol),
    "DATABASE_URL must use the postgres or postgresql protocol",
  );

const appOriginSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  return (
    ["http:", "https:"].includes(url.protocol) &&
    url.origin === value.replace(/\/$/, "") &&
    url.pathname === "/"
  );
}, "APP_ORIGIN must be an HTTP or HTTPS origin without a path or query");
const appAllowedOriginsSchema = z.preprocess(
  (value) => typeof value === "string" ? value.split(",").map((origin) => origin.trim()) : value,
  z.array(appOriginSchema).optional(),
);

const environmentSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    PORT: z.coerce.number().int().min(1).max(65535),
    DATABASE_URL: databaseUrlSchema,
    MINIO_ENDPOINT: nonWhitespaceString,
    MINIO_PORT: z.coerce.number().int().min(1).max(65535),
    MINIO_USE_SSL: booleanFromEnvironment,
    MINIO_ACCESS_KEY: nonWhitespaceString,
    MINIO_SECRET_KEY: nonWhitespaceString,
    MINIO_BUCKET: nonWhitespaceString,
    MINIO_PUBLIC_URL: z.string().url().refine((value) => {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && url.pathname === "/" &&
        !url.search && !url.hash && !url.username && !url.password;
    }, "MINIO_PUBLIC_URL must be an HTTP(S) origin without a path or query"),
    APP_ORIGIN: appOriginSchema,
    APP_ALLOWED_ORIGINS: appAllowedOriginsSchema,
    AUTH_BYPASS: booleanFromEnvironment,
    TRUSTED_PROXIES: trustedProxiesSchema,
    APP_TIMEZONE: z.string().min(1).refine((value) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "APP_TIMEZONE must be a valid IANA time zone"),
    SESSION_SECRET: z.string().min(1),
  })
  .superRefine((config, context) => {
    if (config.APP_ALLOWED_ORIGINS && !config.APP_ALLOWED_ORIGINS.includes(config.APP_ORIGIN)) {
      context.addIssue({
        code: "custom",
        path: ["APP_ALLOWED_ORIGINS"],
        message: "APP_ALLOWED_ORIGINS must include APP_ORIGIN",
      });
    }
    if (config.NODE_ENV === "production" && config.TRUSTED_PROXIES.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["TRUSTED_PROXIES"],
        message: "TRUSTED_PROXIES must explicitly list the reverse proxy address in production",
      });
    }
    if (config.NODE_ENV === "production" && !config.MINIO_PUBLIC_URL.startsWith("https://")) {
      context.addIssue({
        code: "custom",
        path: ["MINIO_PUBLIC_URL"],
        message: "MINIO_PUBLIC_URL must use HTTPS in production",
      });
    }
    if (config.NODE_ENV === "production" && !config.APP_ORIGIN.startsWith("https://")) {
      context.addIssue({
        code: "custom",
        path: ["APP_ORIGIN"],
        message: "APP_ORIGIN must use HTTPS in production",
      });
    }
    const nonWhitespaceSessionSecretLength = config.SESSION_SECRET.replace(/\s/g, "").length;
    if (config.NODE_ENV === "production" && nonWhitespaceSessionSecretLength < 32) {
      context.addIssue({
        code: "custom",
        path: ["SESSION_SECRET"],
        message: "SESSION_SECRET must be at least 32 characters in production",
      });
    }
  })
  .transform((config) => ({
    nodeEnv: config.NODE_ENV,
    port: config.PORT,
    sessionCookieName: "fl_parent_session",
    sessionLifetimeSeconds: 7 * 24 * 60 * 60,
    secureCookies: config.NODE_ENV === "production",
    authBypass: config.AUTH_BYPASS,
    databaseUrl: config.DATABASE_URL,
    minio: {
      endpoint: config.MINIO_ENDPOINT,
      port: config.MINIO_PORT,
      useSsl: config.MINIO_USE_SSL,
      accessKey: config.MINIO_ACCESS_KEY,
      secretKey: config.MINIO_SECRET_KEY,
      bucket: config.MINIO_BUCKET,
      publicUrl: config.MINIO_PUBLIC_URL,
    },
    appOrigin: config.APP_ORIGIN,
    appAllowedOrigins: config.APP_ALLOWED_ORIGINS ?? [config.APP_ORIGIN],
    trustedProxies: config.TRUSTED_PROXIES,
    appTimezone: config.APP_TIMEZONE,
    sessionSecret: config.SESSION_SECRET,
  }));

export type AppConfig = z.output<typeof environmentSchema>;

const sharedDefaults = {
  NODE_ENV: "development",
  PORT: "3000",
  APP_TIMEZONE: "Asia/Shanghai",
};

const developmentDefaults = {
  DATABASE_URL:
    "postgresql://family_learning:family_learning_dev@localhost:5432/family_learning",
  MINIO_ENDPOINT: "localhost",
  MINIO_PORT: "19000",
  MINIO_USE_SSL: "false",
  MINIO_BUCKET: "family-learning-videos",
  MINIO_PUBLIC_URL: "http://localhost:19000",
  APP_ORIGIN: "http://localhost:5173",
  TRUSTED_PROXIES: "",
};

export function parseConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = nodeEnvSchema.parse(env.NODE_ENV ?? sharedDefaults.NODE_ENV);
  const defaults = {
    ...sharedDefaults,
    AUTH_BYPASS: nodeEnv === "development" ? "true" : "false",
    ...(nodeEnv === "development" ? developmentDefaults : {}),
  };
  const providedValues = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined),
  );

  return environmentSchema.parse({
    ...defaults,
    ...providedValues,
    NODE_ENV: nodeEnv,
  });
}
