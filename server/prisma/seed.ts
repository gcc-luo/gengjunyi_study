import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL must be set before seeding the database");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const subjects = [
  { name: "数学", slug: "math" },
  { name: "语文", slug: "chinese" },
  { name: "英语", slug: "english" },
  { name: "科学", slug: "science" },
] as const;

try {
  for (const subject of subjects) {
    await prisma.subject.upsert({
      where: { slug: subject.slug },
      create: subject,
      update: { name: subject.name },
    });
  }
} finally {
  await prisma.$disconnect();
}
