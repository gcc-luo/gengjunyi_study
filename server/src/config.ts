import { z } from "zod";

const nodeEnvSchema = z.enum(["development", "test", "production"]);

const booleanFromEnvironment = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

const nonWhitespaceString = z.string().refine((value) => /\S/u.test(value));

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
    APP_ORIGIN: appOriginSchema,
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
    databaseUrl: config.DATABASE_URL,
    minio: {
      endpoint: config.MINIO_ENDPOINT,
      port: config.MINIO_PORT,
      useSsl: config.MINIO_USE_SSL,
      accessKey: config.MINIO_ACCESS_KEY,
      secretKey: config.MINIO_SECRET_KEY,
      bucket: config.MINIO_BUCKET,
    },
    appOrigin: config.APP_ORIGIN,
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
  MINIO_PORT: "9000",
  MINIO_USE_SSL: "false",
  MINIO_BUCKET: "family-learning-videos",
  APP_ORIGIN: "http://localhost:5173",
};

export function parseConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = nodeEnvSchema.parse(env.NODE_ENV ?? sharedDefaults.NODE_ENV);
  const defaults = {
    ...sharedDefaults,
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
