import { parseConfig } from "./config.js";
import { createPrismaClient } from "./db.js";
import { cleanupExpiredFailedSources, processNextVideo } from "./services/media-transcoding.js";
import { MinioStorage } from "./storage/minio.js";

const config = parseConfig();
const prisma = createPrismaClient(config.databaseUrl);
const storage = new MinioStorage(config.minio);
let stopping = false;

const stop = () => { stopping = true; };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

await storage.ensureBucket();
await prisma.video.updateMany({
  where: { status: "PROCESSING", processingStage: { in: ["TRANSCODING", "VERIFYING", "CLEANUP"] } },
  data: { processingStage: "QUEUED", processingProgress: 0 },
});

try {
  while (!stopping) {
    const processed = await processNextVideo(prisma, storage);
    await cleanupExpiredFailedSources(prisma, storage);
    if (!processed) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
} finally {
  storage.close();
  await prisma.$disconnect();
}
