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

test("server enforces control, revisions, sorting, and SQLite persistence", async (context) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "initiative-test-"));
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
  const publicClient = await connectClient(url);
  const dmClient = await connectClient(url);

  context.after(async () => {
    publicClient.disconnect();
    dmClient.disconnect();
    application.close();
    await new Promise((resolve) => httpServer.close(resolve));
    database.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const publicAdd = await command(publicClient, "combatant:add", {
    name: "Zed",
    initiativeRoll: 15,
    initiativeModifier: 1,
  });
  assert.equal(publicAdd.ok, true);
  assert.equal(publicAdd.revision, 1);
  assert.equal(database.snapshot().combatants[0].playerControlled, true);

  const badLogin = await command(dmClient, "dm:login", { password: "wrong" });
  assert.equal(badLogin.ok, false);
  const login = await command(dmClient, "dm:login", { password: "test-password" });
  assert.equal(login.ok, true);
  assert.ok(login.token);

  const dmAdd = await command(dmClient, "combatant:add", {
    name: "Ada",
    initiativeRoll: 15,
    initiativeModifier: 2,
    hpCurrent: 8,
    hpMax: 10,
  });
  assert.equal(dmAdd.ok, true);
  assert.equal(dmAdd.revision, 2);

  const snapshotAfterAdds = database.snapshot();
  assert.equal(snapshotAfterAdds.combatants[0].name, "Ada");
  assert.equal(snapshotAfterAdds.combatants[0].playerControlled, false);

  const rejectedEdit = await command(publicClient, "combatant:update", {
    id: dmAdd.id,
    changes: { hpCurrent: 2 },
  });
  assert.equal(rejectedEdit.ok, false);
  assert.equal(database.snapshot().revision, 2);

  const classification = await command(dmClient, "combatant:set-player-controlled", {
    id: dmAdd.id,
    playerControlled: true,
  });
  assert.equal(classification.ok, true);
  assert.equal(classification.revision, 3);

  const acceptedEdit = await command(publicClient, "combatant:update", {
    id: dmAdd.id,
    changes: { hpCurrent: 2 },
  });
  assert.equal(acceptedEdit.ok, true);
  assert.equal(acceptedEdit.revision, 4);
  assert.equal(database.snapshot().combatants[0].hpCurrent, 2);

  const reopened = createDatabase(databasePath);
  assert.equal(reopened.snapshot().revision, 4);
  assert.equal(reopened.snapshot().combatants.length, 2);
  reopened.close();
});
