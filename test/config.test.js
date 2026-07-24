import test from "node:test";
import assert from "node:assert/strict";
import { loadServerConfig } from "../server/config.js";

test("development config aligns explicit client origins and backend port", () => {
  const config = loadServerConfig({
    mode: "development",
    environment: {
      DM_PASSWORD: "a-long-test-password",
      DEV_CLIENT_PORT: "4173",
      DEV_SERVER_PORT: "4001",
    },
  });

  assert.equal(config.port, 4001);
  assert.deepEqual(config.allowedOrigins, [
    "http://localhost:4173",
    "http://127.0.0.1:4173",
  ]);
});

test("production requires one secure public origin", () => {
  assert.throws(
    () =>
      loadServerConfig({
        mode: "production",
        environment: {
          DM_PASSWORD: "a-long-test-password",
        },
      }),
    /PUBLIC_ORIGIN is required/,
  );
  assert.throws(
    () =>
      loadServerConfig({
        mode: "production",
        environment: {
          DM_PASSWORD: "a-long-test-password",
          PUBLIC_ORIGIN: "http://init.example.com",
        },
      }),
    /must use HTTPS/,
  );
});

test("production accepts the intended subdomain and trusted proxy hop", () => {
  const config = loadServerConfig({
    mode: "production",
    environment: {
      DM_PASSWORD: "a-long-test-password",
      PUBLIC_ORIGIN: "https://init.mrivory124.com",
      TRUST_PROXY: "1",
      DATABASE_PATH: "./test.sqlite",
    },
  });

  assert.equal(config.publicOrigin, "https://init.mrivory124.com");
  assert.equal(config.trustProxy, 1);
  assert.equal(config.port, 3000);
});
