import type { PrismaClient } from "../generated/prisma/client.js";

const childSelect = {
  id: true,
  name: true,
  avatar: true,
  grade: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function listChildren(prisma: PrismaClient) {
  return prisma.child.findMany({
    orderBy: { createdAt: "asc" },
    select: childSelect,
  });
}

export function createChild(prisma: PrismaClient, input: { name: string; avatar: string; grade: string }) {
  return prisma.child.create({
    data: { ...input, status: "ACTIVE" },
    select: childSelect,
  });
}

export async function updateChild(prisma: PrismaClient, id: string, input: { name?: string; avatar?: string; grade?: string }) {
  const child = await prisma.child.findUnique({ where: { id }, select: { id: true } });
  if (!child) return null;

  return prisma.child.update({
    where: { id },
    data: input,
    select: childSelect,
  });
}

export function deactivateChild(prisma: PrismaClient, id: string) {
  return prisma.$transaction(async (transaction) => {
    const child = await transaction.child.findUnique({ where: { id }, select: { id: true } });
    if (!child) return null;

    const deactivated = await transaction.child.update({
      where: { id },
      data: { status: "DISABLED" },
      select: childSelect,
    });
    await transaction.session.updateMany({
      where: { activeChildId: id },
      data: { activeChildId: null },
    });
    return deactivated;
  });
}

export async function activateChild(prisma: PrismaClient, id: string) {
  const child = await prisma.child.findUnique({ where: { id }, select: { id: true } });
  if (!child) return null;

  return prisma.child.update({
    where: { id },
    data: { status: "ACTIVE" },
    select: childSelect,
  });
}
