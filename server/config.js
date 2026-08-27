/**
 * Environment configuration loader and validator for the backend. Turns raw
 * process.env into one validated, typed config object, applying different rules
 * for development vs production (ports, allowed CORS origins, database path,
 * HTTPS enforcement). server/index.js calls this at startup and exits on any
 * invalid configuration, so the server never boots in a half-configured state.
 */
import path from "node:path";

// Parse and range-check a TCP port, falling back to a default when unset.
function parsePort(value, fallback, label) {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be a whole number between 1 and 65535.`);
  }
  return port;
}

// Parse a comma-separated list of exact HTTP(S) origins, rejecting anything
// with a path or non-http scheme (Socket.IO's allowlist must be exact origins).
function parseOrigins(value, label) {
  if (!value) return [];
  return value.split(",").map((entry) => {
    const origin = entry.trim();
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`${label} contains an invalid URL: ${origin}`);
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error(`${label} entries must be exact HTTP(S) origins without paths.`);
    }
    return origin;
  });
}

// Interpret the TRUST_PROXY env var the way Express expects: boolean, a hop
// count (number of trusted proxies), or a subnet/string passed through as-is.
function parseTrustProxy(value) {
  if (!value || value === "false") return false;
  if (value === "true") return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

// Build the full validated config for the given mode. Throws (with a message
// meant for the operator) on any missing or invalid setting: absent/short DM
// password, bad ports/origins, or a non-HTTPS public origin in production.
export function loadServerConfig({
  environment = process.env,
  mode = environment.NODE_ENV || "development",
} = {}) {
  const production = mode === "production";
  const port = parsePort(
    production ? environment.PORT : environment.DEV_SERVER_PORT,
    production ? 3000 : 3001,
    production ? "PORT" : "DEV_SERVER_PORT",
  );
  const dmPassword = environment.DM_PASSWORD;
  if (!dmPassword) {
    throw new Error(
      "DM_PASSWORD is required. Copy .env.development.example to .env for local development, or inject the variable in production.",
    );
  }
  if (dmPassword.length < 12) {
    throw new Error("DM_PASSWORD must contain at least 12 characters.");
  }

  let allowedOrigins;
  let publicOrigin = null;
  if (production) {
    const origins = parseOrigins(environment.PUBLIC_ORIGIN, "PUBLIC_ORIGIN");
    if (origins.length !== 1) {
      throw new Error(
        "PUBLIC_ORIGIN is required in production and must contain one exact origin, such as https://init.mrivory124.com.",
      );
    }
    [publicOrigin] = origins;
    if (!publicOrigin.startsWith("https://") && environment.ALLOW_INSECURE_ORIGIN !== "true") {
      throw new Error(
        "PUBLIC_ORIGIN must use HTTPS in production. Set ALLOW_INSECURE_ORIGIN=true only for an isolated test deployment.",
      );
    }
    allowedOrigins = origins;
  } else {
    const clientPort = parsePort(
      environment.DEV_CLIENT_PORT,
      5173,
      "DEV_CLIENT_PORT",
    );
    allowedOrigins = parseOrigins(
      environment.DEV_CLIENT_ORIGINS ||
        `http://localhost:${clientPort},http://127.0.0.1:${clientPort}`,
      "DEV_CLIENT_ORIGINS",
    );
  }

  return {
    mode,
    production,
    host: environment.HOST || "0.0.0.0",
    port,
    databasePath: path.resolve(
      environment.DATABASE_PATH || (production ? "/data/initiative.sqlite" : "./data/initiative.sqlite"),
    ),
    dmPassword,
    publicOrigin,
    allowedOrigins,
    trustProxy: parseTrustProxy(environment.TRUST_PROXY),
  };
}
