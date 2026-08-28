/**
 * SQLite persistence layer — the canonical store of tracker state. It creates
 * the schema, migrates older databases forward in place, and exposes a small
 * API (snapshot / commit) that the rest of the server builds on. All derived
 * values a snapshot carries (initiative total, health tone, parsed conditions)
 * are computed here from server/domain.js so every read is self-describing.
 * State is intentionally single-file and single-server; see README security
 * notes. better-sqlite3 is synchronous, so these calls block by design.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {ValidationError, healthTone, initiativeTotal, parseConditions, sortCombatants,} from "./domain.js";
import {fileURLToPath} from "node:url";

// Bumped whenever a data transform (not just an additive column) is needed;
// migrateDatabase runs the transform once and records the new version.
const CURRENT_SCHEMA_VERSION = 3;

// Decode a text file, sniffing its BOM (UTF-8 or UTF-16) when present rather
// than assuming UTF-8 outright — roller-table .txt files are hand-authored
// and commonly saved by Notepad, which defaults to UTF-16 LE on "Unicode".
function readTextFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString("utf8");
  }
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  return buffer.toString("utf8");
}

// Whether a table already has a given column, used to make migrations idempotent.
function hasColumn(database, table, column) {
  return database
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((entry) => entry.name === column);
}

// Bring an existing database up to the current schema. Additive columns are
// added when missing; the versioned transaction below runs once to fix up data
// (split modifier out of the stored roll, assign initial enemy map numbers).
function migrateDatabase(database) {
  if (!hasColumn(database, "tracker_meta", "schema_version")) {
    database.exec("ALTER TABLE tracker_meta ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1",);
  }
  if (!hasColumn(database, "tracker_meta", "player_locked")) {
    database.exec("ALTER TABLE tracker_meta ADD COLUMN player_locked INTEGER NOT NULL DEFAULT 0 CHECK (player_locked IN (0, 1))",);
  }
  if (!hasColumn(database, "combatants", "map_number")) {
    database.exec("ALTER TABLE combatants ADD COLUMN map_number INTEGER");
  }
  if (!hasColumn(database, "combatants", "ac_visible")) {
    database.exec("ALTER TABLE combatants ADD COLUMN ac_visible INTEGER NOT NULL DEFAULT 0 CHECK (ac_visible IN (0, 1))",);
  }
  if (!hasColumn(database, "combatants", "conditions")) {
    database.exec("ALTER TABLE combatants ADD COLUMN conditions TEXT NOT NULL DEFAULT '[]'",);
  }

  // TODO write the reconciliation for the roller table metadata (it should update count etc.)

  const currentVersion = database
    .prepare("SELECT schema_version FROM tracker_meta WHERE singleton = 1")
    .get().schema_version;
  if (currentVersion >= CURRENT_SCHEMA_VERSION) return;

  // One-time data transform for the v1 → v2 upgrade. Wrapped in a transaction
  // so a crash mid-migration leaves the database untouched, not half-migrated.
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
    const assignMapNumber = database.prepare("UPDATE combatants SET map_number = ? WHERE id = ?",);
    existingEnemies.forEach((combatant, index) => {
      assignMapNumber.run(index + 1, combatant.id);
    });

    database
      .prepare("UPDATE tracker_meta SET schema_version = ? WHERE singleton = 1")
      .run(CURRENT_SCHEMA_VERSION);
  })();
}

// Open (creating if needed) the database at the given path, ensure the schema
// and migrations are applied, and return the store handle used by the rest of
// the server: { raw, snapshot, commit, close }. Prepared statements are built
// once here and reused for the lifetime of the process.
export function createDatabase(databasePath) {
  const resolvedPath = path.resolve(databasePath);
  fs.mkdirSync(path.dirname(resolvedPath), {recursive: true});

  const database = new Database(resolvedPath);
  // WAL improves read/write concurrency; the single writer is this process.
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
      conditions TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS rollerTableMetadata(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tableName TEXT NOT NULL,
    entryCount INTEGER NOT NULL,
    tableDescription TEXT,
    createdatetime  TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S:%s', 'now', 'localtime') ),
    updatedatetime  TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S:%s', 'now', 'localtime') ) 
    );
    
    CREATE TRIGGER IF NOT EXISTS update_entryCount_updatetime
            BEFORE UPDATE
                ON rollerTableMetadata
    BEGIN
        UPDATE rollerTableMetadata
           SET updatedatetime = strftime('%Y-%m-%d %H:%M:%S:%s', 'now', 'localtime')
         WHERE id = old.id;
    END;

    CREATE TABLE IF NOT EXISTS rollHistory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tableName TEXT NOT NULL,
      roll INTEGER NOT NULL,
      count INTEGER NOT NULL,
      description TEXT,
      rolledAt TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S:%s', 'now', 'localtime') )
    );
  `);

  migrateDatabase(database);

  // name of all the tables in the data folder, this is where all tables will be added and scanned on launch
  // TODO make this not a hardcoded path
  const folderName = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
  try {
    if (!fs.existsSync(folderName)) {
      console.log("created directory for data")
      fs.mkdirSync(folderName);
    }
  } catch (err) {
    console.error(err);
  }

  let dataFiles = [];
  fs.readdirSync(folderName).forEach(file => {
    if (!file.toLowerCase().endsWith('.txt')) return;
    console.log("File found for table roller data: " + file);
    // strip the extension, then sanitize to characters valid in an unquoted insert statement;
    // a leading digit is otherwise unusable as a bare identifier, so prefix rather than strip it
    let tableName = file
      .replace(/\.txt$/i, '')
      .replace(/[^a-z0-9_]+/gi, '_')
      .toLowerCase()
      .replace(/^(?=[0-9])/, '_');
    dataFiles.push({file, tableName});
  })


  for (const {file, tableName} of dataFiles) {
    // check if the table exists
    database.exec(`CREATE TABLE IF NOT EXISTS ${tableName}
        (id INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT NOT NULL)`);
    // check if there are not items in the entry
    const countStatement = database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`)
    const countResults = countStatement.get();
    if (countResults.count > 0) {
      console.log("Will not add lines for " + file + " as there are: " + countResults.count);
      continue;
    }
    // TRY open the corresponding file
    try {
      const insertRow = database.prepare(`INSERT INTO ${tableName} (description) VALUES (?)`);
      const lines = readTextFile(path.join(folderName, file)).split(/\r\n?|\n/);
      for (const line of lines) {
        if (line) {
          try {
            insertRow.run(line);
          } catch {
            console.log("Error with line: " + line + " in " + tableName);
          }
        }
      }
      console.log("Added lines for " + folderName + "\\" + file);
      // update the metadata
      const countStatement = database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`)
      const countResults = countStatement.get();
      const metaInsertRow = database.prepare(`INSERT INTO rollerTableMetadata (tableName, entryCount) VALUES (?,?)`);
      metaInsertRow.run(tableName, countResults.count);
    } catch {
      throw "Error with trying to open file: " + folderName + file;
    }
    // CATCH throw an error and stop the program
    // update the table metadata
  }

  // Enforce that map numbers are unique among the combatants that have one
  // (enemies); NULLs (player-controlled entries) are exempt via the WHERE.
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS combatants_map_number_unique
    ON combatants (map_number)
    WHERE map_number IS NOT NULL
  `);

  const readMeta = database.prepare("SELECT revision, player_locked AS playerLocked FROM tracker_meta WHERE singleton = 1",);
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
      ac_visible AS acVisible,
      conditions
    FROM combatants
  `);
  const incrementRevision = database.prepare("UPDATE tracker_meta SET revision = revision + 1 WHERE singleton = 1",);

  // Build the complete canonical state: metadata plus every combatant, with
  // SQLite integers coerced to booleans, conditions parsed, derived values
  // attached, and the list sorted into combat order. This DM-view snapshot is
  // later redacted per viewer by domain.snapshotForViewer before it is sent.
  function snapshot() {
    const meta = readMeta.get();
    const combatants = readCombatants.all().map((row) => {
      const combatant = {
        ...row,
        playerControlled: Boolean(row.playerControlled),
        acVisible: Boolean(row.acVisible),
        conditions: parseConditions(row.conditions),
      };
      return {
        ...combatant, initiativeTotal: initiativeTotal(combatant), healthTone: healthTone(combatant),
      };
    });
    return {
      revision: meta.revision, playerLocked: Boolean(meta.playerLocked), combatants: sortCombatants(combatants),
    };
  }

  // Run a mutation atomically: apply it, bump the persisted revision, and
  // return the resulting snapshot — all in one transaction so every accepted
  // change is paired with exactly one revision increment.
  function commit(mutation) {
    return database.transaction(() => {
      mutation(database);
      incrementRevision.run();
      return snapshot();
    })();
  }

  // Every roller table the startup scan above found, with a live row count.
  // rollerTableMetadata's own entryCount column can go stale if a .txt file
  // grows after its first import (see the migrateDatabase TODO), so this
  // recomputes the count fresh rather than trusting the stored value.
  function listRollerTables() {
    const tables = database
      .prepare("SELECT tableName, tableDescription FROM rollerTableMetadata ORDER BY tableName")
      .all();
    return tables.map(({tableName, tableDescription}) => ({
      tableName,
      tableDescription,
      entryCount: database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count,
    }));
  }

  // Roll a cryptographically random entry (1..count) from one roller table.
  // tableName must exactly match a row the startup scan already created —
  // SQLite can't parameterize identifiers, so this lookup against a known
  // value is what makes the interpolation below safe. Rows are fetched by
  // order/offset rather than id, so a gap in the id sequence (were one ever
  // to occur) can't make a roll land on nothing.
  function rollOnTable(tableName) {
    const known = database
      .prepare("SELECT tableName FROM rollerTableMetadata WHERE tableName = ?")
      .get(tableName);
    if (!known) throw new ValidationError("That table does not exist.");

    const {count} = database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get();
    if (count === 0) throw new ValidationError("That table has no entries.");

    const roll = crypto.randomInt(1, count + 1);
    const row = database
      .prepare(`SELECT description FROM ${tableName} ORDER BY id LIMIT 1 OFFSET ?`)
      .get(roll - 1);
    return {tableName, roll, count, description: row?.description ?? null};
  }

  // Record one roll (from rollOnTable) into the DM-only history log. Always
  // stores the full description regardless of who rolled — access control is
  // enforced where history is read, not where it's written.
  function recordRoll({tableName, roll, count, description}) {
    database
      .prepare("INSERT INTO rollHistory (tableName, roll, count, description) VALUES (?, ?, ?, ?)")
      .run(tableName, roll, count, description ?? null);
  }

  // The most recent rolls across every table, newest first, DM-only.
  function listRollHistory(limit = 20) {
    return database
      .prepare("SELECT tableName, roll, count, description, rolledAt FROM rollHistory ORDER BY id DESC LIMIT ?")
      .all(limit);
  }

  return {
    raw: database, snapshot, commit, close: () => database.close(),
    listRollerTables, rollOnTable, recordRoll, listRollHistory,
  };
}
