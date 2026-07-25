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
  assert.equal(database.snapshot().combatants[0].initiativeTotal, 16);

  const badLogin = await command(dmClient, "dm:login", { password: "wrong" });
  assert.equal(badLogin.ok, false);
  const login = await command(dmClient, "dm:login", { password: "test-password" });
  assert.equal(login.ok, true);
  assert.ok(login.token);

  const dmAdd = await command(dmClient, "combatant:add", {
    name: "Ada",
    initiativeRoll: 15,
    initiativeModifier: 2,
    ac: 14,
    hpCurrent: 8,
    hpMax: 10,
  });
  assert.equal(dmAdd.ok, true);
  assert.equal(dmAdd.revision, 2);

  const snapshotAfterAdds = database.snapshot();
  assert.equal(snapshotAfterAdds.combatants[0].name, "Ada");
  assert.equal(snapshotAfterAdds.combatants[0].playerControlled, false);
  assert.equal(snapshotAfterAdds.combatants[0].initiativeTotal, 17);
  assert.equal(snapshotAfterAdds.combatants[0].mapNumber, 1);
  assert.equal(snapshotAfterAdds.combatants[0].acVisible, false);

  const publicState = await command(publicClient, "state:request");
  const publicAda = publicState.snapshot.combatants.find(({ id }) => id === dmAdd.id);
  assert.equal(publicAda.initiativeTotal, 17);
  assert.equal(publicAda.initiativeRoll, null);
  assert.equal(publicAda.initiativeModifier, null);
  assert.equal(publicAda.hpCurrent, null);
  assert.equal(publicAda.hpMax, null);
  assert.equal(publicAda.healthTone, "green");

  const revealAc = await command(dmClient, "combatant:set-ac-visible", {
    id: dmAdd.id,
    visible: true,
  });
  assert.equal(revealAc.ok, true);
  assert.equal(revealAc.revision, 3);
  const revealedPublicState = await command(publicClient, "state:request");
  assert.equal(
    revealedPublicState.snapshot.combatants.find(({ id }) => id === dmAdd.id).ac,
    14,
  );

  const lock = await command(dmClient, "tracker:set-player-locked", {
    locked: true,
  });
  assert.equal(lock.ok, true);
  assert.equal(lock.revision, 4);
  assert.equal(database.snapshot().playerLocked, true);

  const rejectedLockedAdd = await command(publicClient, "combatant:add", {
    name: "Blocked",
    initiativeRoll: 10,
    initiativeModifier: 0,
  });
  assert.equal(rejectedLockedAdd.ok, false);
  assert.match(rejectedLockedAdd.error, /locked/i);

  const rejectedEdit = await command(publicClient, "combatant:update", {
    id: publicAdd.id,
    changes: { hpCurrent: 2 },
  });
  assert.equal(rejectedEdit.ok, false);
  assert.match(rejectedEdit.error, /locked/i);
  assert.equal(database.snapshot().revision, 4);

  const dmEditWhileLocked = await command(dmClient, "combatant:update", {
    id: dmAdd.id,
    changes: { hpCurrent: 6 },
  });
  assert.equal(dmEditWhileLocked.ok, true);
  assert.equal(dmEditWhileLocked.revision, 5);

  const unlock = await command(dmClient, "tracker:set-player-locked", {
    locked: false,
  });
  assert.equal(unlock.ok, true);
  assert.equal(unlock.revision, 6);

  const classification = await command(dmClient, "combatant:set-player-controlled", {
    id: dmAdd.id,
    playerControlled: true,
  });
  assert.equal(classification.ok, true);
  assert.equal(classification.revision, 7);
  assert.equal(
    database.snapshot().combatants.find(({ id }) => id === dmAdd.id).mapNumber,
    null,
  );

  const acceptedEdit = await command(publicClient, "combatant:update", {
    id: dmAdd.id,
    changes: { hpCurrent: 2 },
  });
  assert.equal(acceptedEdit.ok, true);
  assert.equal(acceptedEdit.revision, 8);
  assert.equal(
    database.snapshot().combatants.find(({ id }) => id === dmAdd.id).hpCurrent,
    2,
  );

  const enemyOne = await command(dmClient, "combatant:add", {
    name: "Enemy One",
    initiativeRoll: 10,
    initiativeModifier: 0,
  });
  const enemyTwo = await command(dmClient, "combatant:add", {
    name: "Enemy Two",
    initiativeRoll: 9,
    initiativeModifier: 0,
  });
  assert.equal(
    database.snapshot().combatants.find(({ id }) => id === enemyOne.id).mapNumber,
    1,
  );
  assert.equal(
    database.snapshot().combatants.find(({ id }) => id === enemyTwo.id).mapNumber,
    2,
  );

  const removeEnemyOne = await command(dmClient, "combatant:remove", {
    id: enemyOne.id,
  });
  assert.equal(removeEnemyOne.ok, true);
  const replacement = await command(dmClient, "combatant:add", {
    name: "Replacement",
    initiativeRoll: 8,
    initiativeModifier: 0,
  });
  assert.equal(
    database.snapshot().combatants.find(({ id }) => id === replacement.id).mapNumber,
    1,
  );

  const showAllAc = await command(dmClient, "combatants:set-enemy-ac-visible", {
    visible: true,
  });
  assert.equal(showAllAc.ok, true);
  assert.equal(
    database.snapshot().combatants
      .filter(({ playerControlled }) => !playerControlled)
      .every(({ acVisible }) => acVisible),
    true,
  );

  const finalLock = await command(dmClient, "tracker:set-player-locked", {
    locked: true,
  });
  assert.equal(finalLock.ok, true);

  const reopened = createDatabase(databasePath);
  assert.equal(reopened.snapshot().playerLocked, true);
  assert.equal(reopened.snapshot().combatants.length, 4);
  reopened.close();
});
