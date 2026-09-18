import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { verifyPassword } from "../../src/auth/password.js";
import { ensureDefaultAdmin, parseCreateAdminArgs } from "../../scripts/create-admin.js";

function createPrismaHarness() {
  const admins: Array<{ id: string; email: string; passwordHash: string }> = [];
  const transaction = {
    $queryRaw: vi.fn(async () => []),
    adminUser: {
      findMany: vi.fn(async () => admins.map(({ id, email }) => ({ id, email }))),
      create: vi.fn(async ({ data }: { data: { email: string; passwordHash: string } }) => {
        const admin = { id: `admin-${admins.length + 1}`, ...data };
        admins.push(admin);
        return admin;
      }),
    },
  };
  const prisma = {
    $transaction: (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
  } as unknown as PrismaClient;
  return { admins, prisma, transaction };
}

describe("create-admin bootstrap mode", () => {
  it("accepts the non-interactive bootstrap option", () => {
    expect(parseCreateAdminArgs(["--bootstrap"])).toEqual({ reset: false, bootstrap: true });
  });

  it("creates the default admin once and never resets its password on rerun", async () => {
    const { admins, prisma, transaction } = createPrismaHarness();
    const input = { email: "parent@family.test", password: "LocalFamilyPassword2026!" };

    await expect(ensureDefaultAdmin(prisma, input)).resolves.toBe("created");
    const originalHash = admins[0]?.passwordHash;
    expect(originalHash).toBeTruthy();
    await expect(verifyPassword(input.password, originalHash)).resolves.toBe(true);

    await expect(ensureDefaultAdmin(prisma, { ...input, password: "DifferentPassword2026!" }))
      .resolves.toBe("existing");

    expect(transaction.adminUser.create).toHaveBeenCalledTimes(1);
    expect(admins[0]?.passwordHash).toBe(originalHash);
  });

  it("does not create a default admin when an administrator already exists", async () => {
    const { admins, prisma, transaction } = createPrismaHarness();
    admins.push({ id: "existing", email: "custom@family.test", passwordHash: "unchanged" });

    await expect(ensureDefaultAdmin(prisma, {
      email: "parent@family.test",
      password: "LocalFamilyPassword2026!",
    })).resolves.toBe("existing");

    expect(transaction.adminUser.create).not.toHaveBeenCalled();
    expect(admins[0]?.passwordHash).toBe("unchanged");
  });
});
