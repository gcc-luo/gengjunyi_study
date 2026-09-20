import { buildApp } from "./app.js";
import { parseConfig } from "./config.js";

const config = parseConfig();
const app = buildApp({ config });

try {
  await app.listen({ host: "0.0.0.0", port: config.port });
} catch (error) {
  app.log.error({ err: error }, "Failed to start the API server");
  await app.close();
  process.exitCode = 1;
}
