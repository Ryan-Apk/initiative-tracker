import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { sortCombatants } from "./domain.js";

export function createDatabase(databasePath) {
  const resolvedPath = path.resolve(databasePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  const database = new Database(resolvedPath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS tracker_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      revision INTEGER NOT NULL DEFAULT 0
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
      created_at TEXT NOT NULL
    );
  `);

  const readRevision = database.prepare(
    "SELECT revision FROM tracker_meta WHERE singleton = 1",
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
      player_controlled AS playerControlled
    FROM combatants
  `);
  const incrementRevision = database.prepare(
    "UPDATE tracker_meta SET revision = revision + 1 WHERE singleton = 1",
  );

  function snapshot() {
    const revision = readRevision.get().revision;
    const combatants = readCombatants.all().map((row) => ({
      ...row,
      playerControlled: Boolean(row.playerControlled),
    }));
    return { revision, combatants: sortCombatants(combatants) };
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
