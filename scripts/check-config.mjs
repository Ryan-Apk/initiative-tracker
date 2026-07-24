import fs from "node:fs";
import process from "node:process";
import dotenv from "dotenv";
import { loadServerConfig } from "../server/config.js";

const requestedMode = process.argv[2] || "development";
if (!["development", "production"].includes(requestedMode)) {
  console.error("Usage: node scripts/check-config.mjs development|production");
  process.exit(1);
}

if (requestedMode === "development") {
  for (const filename of [".env.development.local", ".env.development", ".env"]) {
    if (fs.existsSync(filename)) dotenv.config({ path: filename, override: false });
  }
}

try {
  const config = loadServerConfig({
    environment: { ...process.env, NODE_ENV: requestedMode },
    mode: requestedMode,
  });
  console.log(`[config] ${requestedMode} configuration is valid.`);
  console.log(`[config] server: ${config.host}:${config.port}`);
  console.log(`[config] database: ${config.databasePath}`);
  console.log(`[config] allowed origins: ${config.allowedOrigins.join(", ")}`);
  console.log("[config] DM_PASSWORD is set and remains server-only.");
} catch (error) {
  console.error(`[config] ${error.message}`);
  process.exit(1);
}
