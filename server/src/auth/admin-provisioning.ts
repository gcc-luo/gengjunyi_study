import { randomBytes } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";
import { hashPassword } from "./password.js";

export const adminProvisioningLockKey = [1_101_775_188, 1_948_282_209] as const;
export const bypassAdminEmail = "parent@family.test";

export async function ensureBypassAdmin(
  prisma: PrismaClient,
): Promise<{ id: string; email: string }> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT 1
      FROM (
        SELECT pg_advisory_xact_lock(${adminProvisioningLockKey[0]}, ${adminProvisioningLockKey[1]})
      ) AS lock_acquired
    `;

    const existing = await transaction.adminUser.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true },
    });
    if (existing) return existing;

    const passwordHash = await hashPassword(randomBytes(32).toString("base64url"));
    return transaction.adminUser.create({
      data: { email: bypassAdminEmail, passwordHash },
      select: { id: true, email: true },
    });
  });
}
