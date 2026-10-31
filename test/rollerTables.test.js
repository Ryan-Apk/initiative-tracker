import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { io as createClient } from "socket.io-client";
import { createApplication } from "../server/app.js";
import { createDatabase } from "../server/database.js";

function connectClient(url) {
  return new Promise((resolve, reject) => {
    const client = createClient(url, {
      forceNew: true,
      transports: ["websocket"],
    });
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function command(client, event, payload = {}) {
  return new Promise((resolve) => {
    client.emit(event, payload, resolve);
  });
}

// Boots a fresh server + temp SQLite database (which triggers the startup
// scan of server/data/*.txt into roller tables) and returns connected
// player/dm clients plus a teardown-registering context.
async function startRollerServer(context) {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "roller-test-"));
  const databasePath = path.join(temporaryDirectory, "tracker.sqlite");
  const database = createDatabase(databasePath);
  const httpServer = http.createServer();
  const application = createApplication({
    httpServer,
    database,
    dmPassword: "test-password",
  });

  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  const url = `http://127.0.0.1:${address.port}`;
  const player = await connectClient(url);
  const dm = await connectClient(url);
  await command(dm, "dm:login", { password: "test-password" });

  context.after(async () => {
    player.disconnect();
    dm.disconnect();
    await application.close();
    database.close();
  });
  context.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

  return { player, dm, url };
}

test("tables:list surfaces every discovered roller table with a live entry count", async (context) => {
  const { player } = await startRollerServer(context);

  const list = await command(player, "tables:list");
  assert.equal(list.ok, true);
  assert.ok(list.tables.length >= 1);
  for (const table of list.tables) {
    assert.equal(typeof table.tableName, "string");
    assert.ok(table.entryCount > 0);
  }
});

test("tables:roll redacts the description for non-DM viewers but not for the DM", async (context) => {
  const { player, dm } = await startRollerServer(context);
  const { tables } = await command(player, "tables:list");
  const { tableName, entryCount } = tables[0];

  const playerRoll = await command(player, "tables:roll", { tableName });
  assert.equal(playerRoll.ok, true);
  assert.ok(playerRoll.roll >= 1 && playerRoll.roll <= entryCount);
  assert.equal("description" in playerRoll, false);

  const dmRoll = await command(dm, "tables:roll", { tableName });
  assert.equal(dmRoll.ok, true);
  assert.equal(typeof dmRoll.description, "string");
  assert.ok(dmRoll.description.length > 0);
});

test("tables:roll rejects a table name that isn't a known roller table", async (context) => {
  const { player } = await startRollerServer(context);

  const missing = await command(player, "tables:roll", { tableName: "not_a_real_table" });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /does not exist/i);

  // Table identifiers can't be parameterized, so this also guards against
  // SQL injection via a crafted tableName — it must fail the same way.
  const injection = await command(player, "tables:roll", {
    tableName: "combatants; DROP TABLE combatants;--",
  });
  assert.equal(injection.ok, false);
  assert.match(injection.error, /does not exist/i);
});

test("tables:history is DM-only and reflects rolls from anyone, capped at 20", async (context) => {
  const { player, dm, url } = await startRollerServer(context);
  const { tables } = await command(player, "tables:list");
  const { tableName } = tables[0];

  const rejected = await command(player, "tables:history");
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /DM/i);

  const pushes = [];
  dm.on("tables:history", (history) => pushes.push(history));

  // A fresh connection per roll: the rate limit below is per-socket, so
  // reusing one connection 25 times in a row would trip it instead of
  // exercising the history cap this test is actually about.
  for (let i = 0; i < 25; i++) {
    const roller = await connectClient(url);
    await command(roller, "tables:roll", { tableName });
    roller.disconnect();
  }

  const pulled = await command(dm, "tables:history");
  assert.equal(pulled.ok, true);
  assert.equal(pulled.history.length, 20);
  assert.equal(typeof pulled.history[0].description, "string");

  // Every roll (by either viewer) should have produced a live push to the DM.
  assert.equal(pushes.length, 25);
  assert.equal(pushes.at(-1).length, 20);
});

test("tables:roll rate-limits repeated rolls from the same socket to 1/second", async (context) => {
  const { player } = await startRollerServer(context);
  const { tables } = await command(player, "tables:list");
  const { tableName } = tables[0];

  const first = await command(player, "tables:roll", { tableName });
  assert.equal(first.ok, true);

  const immediateRetry = await command(player, "tables:roll", { tableName });
  assert.equal(immediateRetry.ok, false);
  assert.match(immediateRetry.error, /too fast/i);

  await new Promise((resolve) => setTimeout(resolve, 1000));

  const afterCooldown = await command(player, "tables:roll", { tableName });
  assert.equal(afterCooldown.ok, true);
});
