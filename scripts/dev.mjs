import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import { loadServerConfig } from "../server/config.js";

for (const filename of [".env.development.local", ".env.development", ".env"]) {
  if (fs.existsSync(filename)) dotenv.config({ path: filename, override: false });
}

const clientPort = Number(process.env.DEV_CLIENT_PORT || 5173);
const childEnvironment = {
  ...process.env,
  NODE_ENV: "development",
  DEV_CLIENT_PORT: String(clientPort),
};

let config;
try {
  config = loadServerConfig({ environment: childEnvironment, mode: "development" });
  if (config.port === clientPort) {
    throw new Error("DEV_SERVER_PORT and DEV_CLIENT_PORT must be different.");
  }
} catch (error) {
  console.error(`\n[dev] Configuration error: ${error.message}`);
  console.error("[dev] Run `npm run dev:check` after fixing the local environment.\n");
  process.exit(1);
}

const children = new Set();
let stopping = false;

function start(command, arguments_, label) {
  const child = spawn(command, arguments_, {
    env: childEnvironment,
    stdio: "inherit",
  });
  children.add(child);
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(`[dev] ${label} stopped unexpectedly (${signal || `exit ${code}`}).`);
      shutdown(code || 1);
    }
  });
  return child;
}

function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode), 250);
}

async function waitForServer(serverProcess) {
  const healthUrl = `http://127.0.0.1:${config.port}/api/health`;
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    if (serverProcess.exitCode !== null) {
      throw new Error("The backend exited before becoming healthy.");
    }
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        console.log(`[dev] Backend healthy at ${healthUrl}`);
        return;
      }
    } catch {
      // The backend is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Backend health check timed out at ${healthUrl}.`);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`[dev] Starting backend on 127.0.0.1:${config.port}…`);
const serverProcess = start(process.execPath, ["--watch", "server/index.js"], "backend");

try {
  await waitForServer(serverProcess);
} catch (error) {
  console.error(`[dev] ${error.message}`);
  shutdown(1);
} 

if (!stopping) {
  const viteEntry = path.resolve("node_modules/vite/bin/vite.js");
  console.log(`[dev] Starting Vite on port ${clientPort}; proxy -> http://127.0.0.1:${config.port}`);
  start(
    process.execPath,
    [viteEntry, "--mode", "development", "--port", String(clientPort), "--strictPort"],
    "Vite",
  );
}
