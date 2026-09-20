import { parseConfig } from "../src/config.js";
import { MinioStorage } from "../src/storage/minio.js";

const config = parseConfig();
const storage = new MinioStorage(config.minio);

try {
  await storage.ensureBucket();
  process.stdout.write(`MinIO bucket '${config.minio.bucket}' is ready.\n`);
} catch {
  process.stderr.write("MinIO bucket initialization failed. Check storage connectivity and configuration.\n");
  process.exitCode = 1;
} finally {
  storage.close();
}
