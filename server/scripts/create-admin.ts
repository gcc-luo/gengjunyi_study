import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { parseConfig } from "../src/config.js";
import { createPrismaClient } from "../src/db.js";
import {
  hashPassword,
  maximumParentPasswordLength,
  minimumParentPasswordLength,
  isAcceptableParentPassword,
} from "../src/auth/password.js";

const emailSchema = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const advisoryLockKey = [1_101_775_188, 1_948_282_209] as const;

export function parseCreateAdminArgs(argv: readonly string[]): { reset: boolean; bootstrap: boolean } {
  if (argv.length === 0) return { reset: false, bootstrap: false };
  if (argv.length === 1 && argv[0] === "--reset") return { reset: true, bootstrap: false };
  if (argv.length === 1 && argv[0] === "--bootstrap") return { reset: false, bootstrap: true };
  throw new Error("Usage: npm run admin:create [-- --reset|--bootstrap]");
}

async function prepareAdminCredentials(input: { email: string; password: string }) {
  const email = input.email.trim().toLowerCase();
  if (!emailSchema.test(email)) throw new Error("A valid email address is required");
  const passwordLength = Array.from(input.password).length;
  if (!isAcceptableParentPassword(input.password)) {
    if (!input.password.trim()) throw new Error("Password must not be empty");
    if (passwordLength < minimumParentPasswordLength) {
      throw new Error(`Password must contain at least ${minimumParentPasswordLength} characters`);
    }
    if (passwordLength > maximumParentPasswordLength) {
      throw new Error(`Password must contain no more than ${maximumParentPasswordLength} characters`);
    }
  }

  return { email, passwordHash: await hashPassword(input.password) };
}

export async function provisionAdmin(
  prisma: PrismaClient,
  input: { email: string; password: string; reset: boolean },
): Promise<void> {
  const { email, passwordHash } = await prepareAdminCredentials(input);
  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(${advisoryLockKey[0]}, ${advisoryLockKey[1]})
    `;

    const admins = await transaction.adminUser.findMany({
      select: { id: true, email: true },
      orderBy: { createdAt: "asc" },
    });

    if (input.reset) {
      if (admins.length !== 1 || admins[0].email !== email) {
        throw new Error("Reset requires the email of the single existing administrator");
      }
      await transaction.adminUser.update({
        where: { id: admins[0].id },
        data: { passwordHash },
      });
      await transaction.session.deleteMany({ where: { adminUserId: admins[0].id } });
      return;
    }

    if (admins.length !== 0) {
      throw new Error("An administrator already exists; use explicit --reset to reset it");
    }
    await transaction.adminUser.create({ data: { email, passwordHash } });
  });
}

export async function ensureDefaultAdmin(
  prisma: PrismaClient,
  input: { email: string; password: string },
): Promise<"created" | "existing"> {
  const { email, passwordHash } = await prepareAdminCredentials(input);
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(${advisoryLockKey[0]}, ${advisoryLockKey[1]})
    `;
    const admins = await transaction.adminUser.findMany({
      select: { id: true, email: true },
      orderBy: { createdAt: "asc" },
    });
    if (admins.length > 0) return "existing";

    await transaction.adminUser.create({ data: { email, passwordHash } });
    return "created";
  });
}

interface HiddenInput {
  isTTY?: boolean;
  setRawMode?: (enabled: boolean) => void;
  resume: () => unknown;
  pause: () => unknown;
  on: (event: "data" | "error", listener: (chunk: Buffer | string) => void) => unknown;
  removeListener: (event: "data" | "error", listener: (chunk: Buffer | string) => void) => unknown;
}

export function readHiddenPassword(
  input: HiddenInput = process.stdin,
  output: { write: (chunk: string) => unknown } = process.stderr,
): Promise<string> {
  if (!input.isTTY || !input.setRawMode) {
    return Promise.reject(new Error("Password input requires an interactive terminal"));
  }

  output.write("Password (input hidden): ");
  input.setRawMode(true);
  input.resume();

  return new Promise((resolvePassword, rejectPassword) => {
    let password = "";
    const restore = () => {
      input.removeListener("data", onData);
      input.removeListener("error", onError);
      input.setRawMode?.(false);
      input.pause();
      output.write("\n");
    };
    const onError = (error: Buffer | string) => {
      restore();
      rejectPassword(error instanceof Error ? error : new Error("Password input failed"));
    };
    const onData = (chunk: Buffer | string) => {
      for (const character of chunk.toString()) {
        if (character === "\u0003" || character === "\u0004") {
          restore();
          rejectPassword(new Error("Password input cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          restore();
          resolvePassword(password);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          password = Array.from(password).slice(0, -1).join("");
        } else if (character === "\u0015") {
          password = "";
        } else if (
          character >= " " &&
          Array.from(password).length <= maximumParentPasswordLength
        ) {
          password += character;
        }
      }
    };

    input.on("data", onData);
    input.on("error", onError);
  });
}

async function readEmail(): Promise<string> {
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await terminal.question("Parent email: ");
  } finally {
    terminal.close();
  }
}

async function main(): Promise<void> {
  const { reset, bootstrap } = parseCreateAdminArgs(process.argv.slice(2));
  if (!bootstrap && !process.stdin.isTTY) throw new Error("Admin setup requires an interactive terminal");

  const config = parseConfig();
  const prisma = createPrismaClient(config.databaseUrl);
  try {
    if (bootstrap) {
      const email = process.env.ADMIN_EMAIL;
      const password = process.env.ADMIN_PASSWORD;
      if (!email || !password) throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required for bootstrap");
      const result = await ensureDefaultAdmin(prisma, { email, password });
      process.stderr.write(result === "created"
        ? "Default parent administrator created.\n"
        : "An administrator already exists; no account or password was changed.\n");
      return;
    }

    const email = await readEmail();
    const password = await readHiddenPassword();
    const confirmation = await readHiddenPassword();
    if (password !== confirmation) throw new Error("Passwords do not match");

    await provisionAdmin(prisma, { email, password, reset });
    process.stderr.write(reset ? "Parent administrator password reset.\n" : "Parent administrator created.\n");
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(() => {
    process.stderr.write("Admin setup failed; check the interactive input and database configuration.\n");
    process.exitCode = 1;
  });
}
