import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL must be set before initializing the database client");
}

export const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
