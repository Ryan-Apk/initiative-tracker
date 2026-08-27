/**
 * The Express + Socket.IO application: the real-time heart of the server. It
 * serves the built client and /api/health over HTTP, and over Socket.IO owns
 * DM authentication, permission enforcement, and every state mutation. The flow
 * for a change is always the same: validate via domain.js, persist via
 * database.commit, then broadcast a per-viewer-redacted snapshot to all
 * clients. It holds no combat state itself — the database is canonical — but it
 * does hold in-memory DM sessions, which is why restarting Node logs DMs out.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";
import {
  ValidationError,
  applyConditionToggle,
  lowestAvailableMapNumber,
  normalizeChanges,
  normalizeCombatant,
  normalizeConditionName,
  parseConditions,
  snapshotForViewer,
} from "./domain.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(moduleDirectory, "../dist");

// Constant-time password comparison. Bails on length mismatch first (that leaks
// only length), then uses timingSafeEqual so a match cannot be timed byte by byte.
function safePasswordMatch(candidate, expected) {
  const candidateBuffer = Buffer.from(String(candidate ?? ""));
  const expectedBuffer = Buffer.from(expected);
  if (candidateBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
}

// Invoke a Socket.IO acknowledgement callback if the client supplied one.
function respond(acknowledge, payload) {
  if (typeof acknowledge === "function") acknowledge(payload);
}

// Turn a thrown error into a safe client-facing message: validation messages
// and the duplicate-id case pass through; anything else is logged server-side
// and reported generically so internal details never reach the client.
function serializeError(error) {
  if (error instanceof ValidationError) return error.message;
  if (error?.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
    return "That combatant already exists.";
  }
  console.error(error);
  return "The server could not apply that change.";
}

// Build the application: attach Express to the given HTTP server, stand up
// Socket.IO with the configured origin allowlist, and register every realtime
// event handler. Returns { app, io, close } for the entry point to manage.
export function createApplication({
  httpServer,
  database,
  dmPassword,
  allowedOrigins,
  trustProxy = false,
}) {
  if (!dmPassword) {
    throw new Error("DM_PASSWORD must be set before the server starts.");
  }

  const app = express();
  httpServer.on("request", app);
  const acceptedOrigins = new Set(allowedOrigins || []);
  const io = new Server(httpServer, {
    serveClient: false,
    cors: allowedOrigins?.length
      ? {
          origin: allowedOrigins,
          methods: ["GET", "POST"],
        }
      : undefined,
    allowRequest: acceptedOrigins.size
      ? (request, callback) => {
          const origin = request.headers.origin;
          callback(null, !origin || acceptedOrigins.has(origin));
        }
      : undefined,
  });
  // Live DM sessions: token -> last-seen timestamp. In-memory only, so all DM
  // sessions vanish on restart; combat data (in SQLite) survives.
  const dmSessions = new Map();

  app.disable("x-powered-by");
  app.set("trust proxy", trustProxy);
  app.use(express.json());
  // Lightweight liveness probe used by the dev launcher and container health check.
  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, revision: database.snapshot().revision });
  });

  // In production the built client is served from the same origin; the catch-all
  // returns index.html so client-side routing works on any deep link.
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get("*", (_request, response) => {
      response.sendFile(path.join(clientDist, "index.html"));
    });
  }

  // Whether this socket currently holds a valid DM capability token.
  function isDm(socket) {
    const token = socket.data.dmToken;
    return Boolean(token && dmSessions.has(token));
  }

  // Re-attach a DM token to a socket after (re)connection, refreshing its
  // last-seen time. Returns false if the token is unknown/expired.
  function resumeDmSession(socket, token) {
    if (typeof token !== "string" || !dmSessions.has(token)) return false;
    socket.data.dmToken = token;
    dmSessions.set(token, Date.now());
    return true;
  }

  // Current value of the persisted player-editing lock flag.
  function playerEditingLocked() {
    return Boolean(
      database.raw
        .prepare("SELECT player_locked FROM tracker_meta WHERE singleton = 1")
        .get().player_locked,
    );
  }

  // Guard for player-originated mutations: throw when a non-DM tries to edit
  // while the DM has locked player editing. DM sockets always pass.
  function requirePlayerEditing(socket) {
    if (!isDm(socket) && playerEditingLocked()) {
      throw new ValidationError("The DM has locked player editing.");
    }
  }

  // Lowest unused map number given what enemies currently hold — computed inside
  // the mutation's own transaction so concurrent adds cannot collide.
  function nextMapNumber(db) {
    const assigned = db
      .prepare("SELECT map_number AS mapNumber FROM combatants WHERE map_number IS NOT NULL")
      .all();
    return lowestAvailableMapNumber(assigned);
  }

  // Broadcast the canonical snapshot to every connected client, each redacted
  // for that client's role. Called after any accepted mutation so all viewers
  // converge on the same server state.
  function sendSnapshot(snapshot = database.snapshot()) {
    for (const client of io.sockets.sockets.values()) {
      client.emit("state:snapshot", snapshotForViewer(snapshot, isDm(client)));
    }
    return snapshot;
  }

  // Per-connection wiring: resume any DM session presented at handshake, push an
  // initial snapshot + DM status, then register all command handlers below.
  io.on("connection", (socket) => {
    resumeDmSession(socket, socket.handshake.auth?.dmToken);
    socket.emit("state:snapshot", snapshotForViewer(database.snapshot(), isDm(socket)));
    socket.emit("dm:status", { isDm: isDm(socket) });

    // Client asks for the current state (e.g. right after (re)connecting).
    // TODO: every caller (emitCommand, and test/server.test.js's command())
    // always sends a payload arg, so this handler actually receives that
    // payload as `acknowledge` and the real ack fn as an unused 2nd param —
    // the response never reaches the caller. Client-side impact is masked
    // because the server also pushes "state:snapshot" independently on
    // connect, but this handler itself is dead: fix by taking (_payload,
    // acknowledge) like every other handler below.
    socket.on("state:request", (acknowledge) => {
      respond(acknowledge, {
        ok: true,
        snapshot: snapshotForViewer(database.snapshot(), isDm(socket)),
        isDm: isDm(socket),
      });
    });

    // Re-establish DM privileges from a stored token after a reconnect, without
    // re-entering the password. Fails cleanly if the token has expired.
    socket.on("dm:resume", (payload, acknowledge) => {
      const resumed = resumeDmSession(socket, payload?.token);
      socket.emit("dm:status", { isDm: resumed });
      socket.emit("state:snapshot", snapshotForViewer(database.snapshot(), resumed));
      respond(acknowledge, {
        ok: resumed,
        isDm: resumed,
        error: resumed ? undefined : "The DM session has expired. Enter the password again.",
      });
    });

    // Verify the shared password and, on success, mint a random capability
    // token the client stores and presents on future connects. The DM
    // immediately receives an unredacted snapshot.
    socket.on("dm:login", (payload, acknowledge) => {
      if (!safePasswordMatch(payload?.password, dmPassword)) {
        respond(acknowledge, { ok: false, error: "Incorrect DM password." });
        return;
      }

      const token = crypto.randomBytes(32).toString("base64url");
      dmSessions.set(token, Date.now());
      socket.data.dmToken = token;
      socket.emit("dm:status", { isDm: true });
      socket.emit("state:snapshot", database.snapshot());
      respond(acknowledge, { ok: true, token });
    });

    // Drop DM privileges: invalidate the token and re-send a redacted snapshot.
    socket.on("dm:logout", (_payload, acknowledge) => {
      if (socket.data.dmToken) dmSessions.delete(socket.data.dmToken);
      socket.data.dmToken = null;
      socket.emit("dm:status", { isDm: false });
      socket.emit("state:snapshot", snapshotForViewer(database.snapshot(), false));
      respond(acknowledge, { ok: true });
    });

    // Add a combatant. Entries added by a non-DM are player-controlled;
    // DM-added entries are enemies and receive the next free map number.
    socket.on("combatant:add", (payload, acknowledge) => {
      try {
        requirePlayerEditing(socket);
        const combatant = normalizeCombatant(payload);
        const id = crypto.randomUUID();
        const playerControlled = !isDm(socket);
        const snapshot = database.commit((db) => {
          const mapNumber = playerControlled ? null : nextMapNumber(db);
          db.prepare(`
            INSERT INTO combatants (
              id, name, initiative_roll, initiative_modifier, ac,
              hp_current, hp_max, player_controlled, map_number,
              ac_visible, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            id,
            combatant.name,
            combatant.initiativeRoll,
            combatant.initiativeModifier,
            combatant.ac,
            combatant.hpCurrent,
            combatant.hpMax,
            Number(playerControlled),
            mapNumber,
            0,
            new Date().toISOString(),
          );
        });
        sendSnapshot(snapshot);
        respond(acknowledge, { ok: true, id, revision: snapshot.revision });
      } catch (error) {
        respond(acknowledge, { ok: false, error: serializeError(error) });
      }
    });

    // Partial field edit. Anyone may edit a player-controlled entry; only the
    // DM may edit an enemy. Column names are mapped from a fixed whitelist (the
    // fields come from normalizeChanges), so the dynamic SQL cannot be injected.
    socket.on("combatant:update", (payload, acknowledge) => {
      try {
        requirePlayerEditing(socket);
        if (typeof payload?.id !== "string") {
          throw new ValidationError("A combatant must be selected.");
        }
        const existing = database.raw
          .prepare("SELECT player_controlled FROM combatants WHERE id = ?")
          .get(payload.id);
        if (!existing) throw new ValidationError("That combatant no longer exists.");
        if (!isDm(socket) && !existing.player_controlled) {
          throw new ValidationError("Only the DM can edit this combatant.");
        }

        const changes = normalizeChanges(payload.changes);
        const columnNames = {
          name: "name",
          initiativeRoll: "initiative_roll",
          initiativeModifier: "initiative_modifier",
          ac: "ac",
          hpCurrent: "hp_current",
          hpMax: "hp_max",
        };
        const fields = Object.keys(changes);
        const assignments = fields.map((field) => `${columnNames[field]} = ?`).join(", ");
        const values = fields.map((field) => changes[field]);
        const snapshot = database.commit((db) => {
          const result = db
            .prepare(`UPDATE combatants SET ${assignments} WHERE id = ?`)
            .run(...values, payload.id);
          if (result.changes !== 1) {
            throw new ValidationError("That combatant no longer exists.");
          }
        });
        sendSnapshot(snapshot);
        respond(acknowledge, { ok: true, revision: snapshot.revision });
      } catch (error) {
        respond(acknowledge, { ok: false, error: serializeError(error) });
      }
    });

    // Toggle a single 5e condition on a combatant. Same ownership rule as
    // editing (own player entry, or DM for enemies); the ordered list is
    // recomputed via domain.applyConditionToggle and stored back as JSON.
    socket.on("combatant:set-condition", (payload, acknowledge) => {
      try {
        requirePlayerEditing(socket);
        if (typeof payload?.id !== "string") {
          throw new ValidationError("A combatant must be selected.");
        }
        if (typeof payload?.active !== "boolean") {
          throw new ValidationError("Invalid condition change.");
        }
        const condition = normalizeConditionName(payload.condition);
        const existing = database.raw
          .prepare("SELECT player_controlled, conditions FROM combatants WHERE id = ?")
          .get(payload.id);
        if (!existing) throw new ValidationError("That combatant no longer exists.");
        if (!isDm(socket) && !existing.player_controlled) {
          throw new ValidationError("Only the DM can edit this combatant.");
        }

        const nextConditions = applyConditionToggle(
          parseConditions(existing.conditions),
          condition,
          payload.active,
        );
        const snapshot = database.commit((db) => {
          const result = db
            .prepare("UPDATE combatants SET conditions = ? WHERE id = ?")
            .run(JSON.stringify(nextConditions), payload.id);
          if (result.changes !== 1) {
            throw new ValidationError("That combatant no longer exists.");
          }
        });
        sendSnapshot(snapshot);
        respond(acknowledge, { ok: true, revision: snapshot.revision });
      } catch (error) {
        respond(acknowledge, { ok: false, error: serializeError(error) });
      }
    });

    // DM-only: reclassify an entry between player-controlled and enemy. Becoming
    // an enemy claims the next map number and hides AC; becoming player-controlled
    // clears the map number (set to null).
    socket.on("combatant:set-player-controlled", (payload, acknowledge) => {
      try {
        if (!isDm(socket)) throw new ValidationError("Only the DM can change control.");
        if (typeof payload?.id !== "string" || typeof payload?.playerControlled !== "boolean") {
          throw new ValidationError("Invalid control change.");
        }
        const snapshot = database.commit((db) => {
          const mapNumber = payload.playerControlled ? null : nextMapNumber(db);
          const result = db
            .prepare(`
              UPDATE combatants
              SET player_controlled = ?, map_number = ?, ac_visible = 0
              WHERE id = ?
            `)
            .run(Number(payload.playerControlled), mapNumber, payload.id);
          if (result.changes !== 1) {
            throw new ValidationError("That combatant no longer exists.");
          }
        });
        sendSnapshot(snapshot);
        respond(acknowledge, { ok: true, revision: snapshot.revision });
      } catch (error) {
        respond(acknowledge, { ok: false, error: serializeError(error) });
      }
    });

    // DM-only: reveal or hide one enemy's AC to players (WHERE ... = 0 keeps
    // this from touching player-controlled entries).
    socket.on("combatant:set-ac-visible", (payload, acknowledge) => {
      try {
        if (!isDm(socket)) throw new ValidationError("Only the DM can reveal enemy AC.");
        if (typeof payload?.id !== "string" || typeof payload?.visible !== "boolean") {
          throw new ValidationError("Invalid AC visibility change.");
        }
        const snapshot = database.commit((db) => {
          const result = db
            .prepare(`
              UPDATE combatants
              SET ac_visible = ?
              WHERE id = ? AND player_controlled = 0
            `)
            .run(Number(payload.visible), payload.id);
          if (result.changes !== 1) {
            throw new ValidationError("That enemy no longer exists.");
          }
        });
        sendSnapshot(snapshot);
        respond(acknowledge, { ok: true, revision: snapshot.revision });
      } catch (error) {
        respond(acknowledge, { ok: false, error: serializeError(error) });
      }
    });

    // DM-only bulk version: reveal or hide AC for every enemy at once.
    socket.on("combatants:set-enemy-ac-visible", (payload, acknowledge) => {
      try {
        if (!isDm(socket)) throw new ValidationError("Only the DM can reveal enemy AC.");
        if (typeof payload?.visible !== "boolean") {
          throw new ValidationError("Invalid AC visibility change.");
        }
        const snapshot = database.commit((db) => {
          db.prepare(`
            UPDATE combatants
            SET ac_visible = ?
            WHERE player_controlled = 0
          `).run(Number(payload.visible));
        });
        sendSnapshot(snapshot);
        respond(acknowledge, { ok: true, revision: snapshot.revision });
      } catch (error) {
        respond(acknowledge, { ok: false, error: serializeError(error) });
      }
    });

    // DM-only: flip the persistent player-editing lock (checked by
    // requirePlayerEditing on every player-originated mutation).
    socket.on("tracker:set-player-locked", (payload, acknowledge) => {
      try {
        if (!isDm(socket)) throw new ValidationError("Only the DM can lock player editing.");
        if (typeof payload?.locked !== "boolean") {
          throw new ValidationError("Invalid tracker lock change.");
        }
        const snapshot = database.commit((db) => {
          db.prepare(`
            UPDATE tracker_meta
            SET player_locked = ?
            WHERE singleton = 1
          `).run(Number(payload.locked));
        });
        sendSnapshot(snapshot);
        respond(acknowledge, { ok: true, revision: snapshot.revision });
      } catch (error) {
        respond(acknowledge, { ok: false, error: serializeError(error) });
      }
    });

    // DM-only: delete a single combatant. Its map number becomes free for reuse.
    socket.on("combatant:remove", (payload, acknowledge) => {
      try {
        if (!isDm(socket)) throw new ValidationError("Only the DM can remove combatants.");
        if (typeof payload?.id !== "string") throw new ValidationError("Invalid combatant.");
        const snapshot = database.commit((db) => {
          const result = db.prepare("DELETE FROM combatants WHERE id = ?").run(payload.id);
          if (result.changes !== 1) {
            throw new ValidationError("That combatant no longer exists.");
          }
        });
        sendSnapshot(snapshot);
        respond(acknowledge, { ok: true, revision: snapshot.revision });
      } catch (error) {
        respond(acknowledge, { ok: false, error: serializeError(error) });
      }
    });

    // DM-only: wipe every combatant (end-of-encounter reset).
    socket.on("combat:clear", (_payload, acknowledge) => {
      try {
        if (!isDm(socket)) throw new ValidationError("Only the DM can clear the tracker.");
        const snapshot = database.commit((db) => {
          db.prepare("DELETE FROM combatants").run();
        });
        sendSnapshot(snapshot);
        respond(acknowledge, { ok: true, revision: snapshot.revision });
      } catch (error) {
        respond(acknowledge, { ok: false, error: serializeError(error) });
      }
    });
  });

  return {
    app,
    io,
    async close() {
      dmSessions.clear();
      await io.close();
    },
  };
}
