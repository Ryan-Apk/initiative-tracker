import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  healthTone,
  initiativeTotal,
  sortCombatants,
} from "./domain.js";

const CURRENT_SCHEMA_VERSION = 2;

function hasColumn(database, table, column) {
  return database
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((entry) => entry.name === column);
}

function migrateDatabase(database) {
  if (!hasColumn(database, "tracker_meta", "schema_version")) {
    database.exec(
      "ALTER TABLE tracker_meta ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1",
    );
  }
  if (!hasColumn(database, "tracker_meta", "player_locked")) {
    database.exec(
      "ALTER TABLE tracker_meta ADD COLUMN player_locked INTEGER NOT NULL DEFAULT 0 CHECK (player_locked IN (0, 1))",
    );
  }
  if (!hasColumn(database, "combatants", "map_number")) {
    database.exec("ALTER TABLE combatants ADD COLUMN map_number INTEGER");
  }
  if (!hasColumn(database, "combatants", "ac_visible")) {
    database.exec(
      "ALTER TABLE combatants ADD COLUMN ac_visible INTEGER NOT NULL DEFAULT 0 CHECK (ac_visible IN (0, 1))",
    );
  }

  const currentVersion = database
    .prepare("SELECT schema_version FROM tracker_meta WHERE singleton = 1")
    .get().schema_version;
  if (currentVersion >= CURRENT_SCHEMA_VERSION) return;

  database.transaction(() => {
    database.exec(`
      UPDATE combatants
      SET initiative_roll = initiative_roll - initiative_modifier
    `);

    const existingEnemies = database
      .prepare(`
        SELECT id
        FROM combatants
        WHERE player_controlled = 0
        ORDER BY created_at ASC, id ASC
      `)
      .all();
    const assignMapNumber = database.prepare(
      "UPDATE combatants SET map_number = ? WHERE id = ?",
    );
    existingEnemies.forEach((combatant, index) => {
      assignMapNumber.run(index + 1, combatant.id);
    });

    database
      .prepare("UPDATE tracker_meta SET schema_version = ? WHERE singleton = 1")
      .run(CURRENT_SCHEMA_VERSION);
  })();
}

export function createDatabase(databasePath) {
  const resolvedPath = path.resolve(databasePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  const database = new Database(resolvedPath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS tracker_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      revision INTEGER NOT NULL DEFAULT 0,
      schema_version INTEGER NOT NULL DEFAULT 2,
      player_locked INTEGER NOT NULL DEFAULT 0 CHECK (player_locked IN (0, 1))
    );

    INSERT OR IGNORE INTO tracker_meta (singleton, revision) VALUES (1, 0);

    CREATE TABLE IF NOT EXISTS combatants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      initiative_roll INTEGER NOT NULL,
      initiative_modifier INTEGER NOT NULL,
      ac INTEGER,
      hp_current INTEGER,
      hp_max INTEGER,
      player_controlled INTEGER NOT NULL CHECK (player_controlled IN (0, 1)),
      map_number INTEGER,
      ac_visible INTEGER NOT NULL DEFAULT 0 CHECK (ac_visible IN (0, 1)),
      created_at TEXT NOT NULL
    );
  `);

  migrateDatabase(database);
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS combatants_map_number_unique
    ON combatants (map_number)
    WHERE map_number IS NOT NULL
  `);

  const readMeta = database.prepare(
    "SELECT revision, player_locked AS playerLocked FROM tracker_meta WHERE singleton = 1",
  );
  const readCombatants = database.prepare(`
    SELECT
      id,
      name,
      initiative_roll AS initiativeRoll,
      initiative_modifier AS initiativeModifier,
      ac,
      hp_current AS hpCurrent,
      hp_max AS hpMax,
      player_controlled AS playerControlled,
      map_number AS mapNumber,
      ac_visible AS acVisible
    FROM combatants
  `);
  const incrementRevision = database.prepare(
    "UPDATE tracker_meta SET revision = revision + 1 WHERE singleton = 1",
  );

  function snapshot() {
    const meta = readMeta.get();
    const combatants = readCombatants.all().map((row) => {
      const combatant = {
        ...row,
        playerControlled: Boolean(row.playerControlled),
        acVisible: Boolean(row.acVisible),
      };
      return {
        ...combatant,
        initiativeTotal: initiativeTotal(combatant),
        healthTone: healthTone(combatant),
      };
    });
    return {
      revision: meta.revision,
      playerLocked: Boolean(meta.playerLocked),
      combatants: sortCombatants(combatants),
    };
  }

  function commit(mutation) {
    return database.transaction(() => {
      mutation(database);
      incrementRevision.run();
      return snapshot();
    })();
  }

  return {
    raw: database,
    snapshot,
    commit,
    close: () => database.close(),
  };
}
