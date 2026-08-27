import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createDatabase } from "../server/database.js";

function temporaryDatabasePath(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "initiative-db-test-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, "tracker.sqlite");
}

test("fresh databases store base rolls and persistent tracker state", (context) => {
  const database = createDatabase(temporaryDatabasePath(context));
  context.after(() => database.close());

  database.commit((db) => {
    db.prepare(`
      INSERT INTO combatants (
        id, name, initiative_roll, initiative_modifier, ac,
        hp_current, hp_max, player_controlled, map_number,
        ac_visible, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("enemy", "Enemy", 20, 2, 15, 10, 20, 0, 1, 0, "2026-01-01");
    db.prepare(
      "UPDATE tracker_meta SET player_locked = 1 WHERE singleton = 1",
    ).run();
  });

  const snapshot = database.snapshot();
  assert.equal(snapshot.playerLocked, true);
  assert.equal(snapshot.combatants[0].initiativeRoll, 20);
  assert.equal(snapshot.combatants[0].initiativeTotal, 22);
  assert.equal(snapshot.combatants[0].mapNumber, 1);
  assert.equal(snapshot.combatants[0].acVisible, false);
  assert.deepEqual(snapshot.combatants[0].conditions, []);
});

test("legacy migration preserves totals and assigns enemy map numbers once", (context) => {
  const databasePath = temporaryDatabasePath(context);
  const legacy = new Database(databasePath);
  legacy.exec(`
    CREATE TABLE tracker_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      revision INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO tracker_meta (singleton, revision) VALUES (1, 4);

    CREATE TABLE combatants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      initiative_roll INTEGER NOT NULL,
      initiative_modifier INTEGER NOT NULL,
      ac INTEGER,
      hp_current INTEGER,
      hp_max INTEGER,
      player_controlled INTEGER NOT NULL CHECK (player_controlled IN (0, 1)),
      created_at TEXT NOT NULL
    );
    INSERT INTO combatants VALUES
      ('enemy-b', 'Enemy B', 14, 1, 12, 10, 10, 0, '2026-01-02'),
      ('player', 'Player', 18, 3, 16, 20, 20, 1, '2026-01-01'),
      ('enemy-a', 'Enemy A', 14, 2, 13, 8, 10, 0, '2026-01-01');
  `);
  legacy.close();

  const migrated = createDatabase(databasePath);
  const firstSnapshot = migrated.snapshot();
  const enemyA = firstSnapshot.combatants.find(({ id }) => id === "enemy-a");
  const enemyB = firstSnapshot.combatants.find(({ id }) => id === "enemy-b");
  const player = firstSnapshot.combatants.find(({ id }) => id === "player");

  assert.equal(enemyA.initiativeRoll, 12);
  assert.equal(enemyA.initiativeTotal, 14);
  assert.equal(enemyA.mapNumber, 1);
  assert.equal(enemyB.initiativeRoll, 13);
  assert.equal(enemyB.initiativeTotal, 14);
  assert.equal(enemyB.mapNumber, 2);
  assert.equal(player.initiativeRoll, 15);
  assert.equal(player.initiativeTotal, 18);
  assert.equal(player.mapNumber, null);
  assert.equal(firstSnapshot.playerLocked, false);
  assert.deepEqual(enemyA.conditions, []);
  migrated.close();

  const reopened = createDatabase(databasePath);
  context.after(() => reopened.close());
  const reopenedEnemyA = reopened
    .snapshot()
    .combatants.find(({ id }) => id === "enemy-a");
  assert.equal(reopenedEnemyA.initiativeRoll, 12);
  assert.equal(reopenedEnemyA.initiativeTotal, 14);
});
