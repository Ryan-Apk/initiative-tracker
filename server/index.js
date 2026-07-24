import "dotenv/config";
import http from "node:http";
import { createApplication } from "./app.js";
import { loadServerConfig } from "./config.js";
import { createDatabase } from "./database.js";

let config;
try {
  config = loadServerConfig();
} catch (error) {
  console.error(`[config] ${error.message}`);
  process.exit(1);
}

const database = createDatabase(config.databasePath);
const httpServer = http.createServer();
const application = createApplication({
  httpServer,
  database,
  dmPassword: config.dmPassword,
  allowedOrigins: config.allowedOrigins,
  trustProxy: config.trustProxy,
});

httpServer.listen(config.port, config.host, () => {
  console.log(`[server] mode=${config.mode}`);
  console.log(`[server] listening on http://${config.host}:${config.port}`);
  console.log(`[server] health check: http://127.0.0.1:${config.port}/api/health`);
  console.log(`[server] SQLite: ${config.databasePath}`);
  if (config.publicOrigin) console.log(`[server] public origin: ${config.publicOrigin}`);
});

function shutdown() {
  application.close();
  httpServer.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
