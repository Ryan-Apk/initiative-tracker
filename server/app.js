import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";
import {
  ValidationError,
  normalizeChanges,
  normalizeCombatant,
} from "./domain.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(moduleDirectory, "../dist");

function safePasswordMatch(candidate, expected) {
  const candidateBuffer = Buffer.from(String(candidate ?? ""));
  const expectedBuffer = Buffer.from(expected);
  if (candidateBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
}

function respond(acknowledge, payload) {
  if (typeof acknowledge === "function") acknowledge(payload);
}

function serializeError(error) {
  if (error instanceof ValidationError) return error.message;
  if (error?.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
    return "That combatant already exists.";
  }
  console.error(error);
  return "The server could not apply that change.";
}

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
  const dmSessions = new Map();

  app.disable("x-powered-by");
  app.set("trust proxy", trustProxy);
  app.use(express.json());
  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, revision: database.snapshot().revision });
  });

  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get("*", (_request, response) => {
      response.sendFile(path.join(clientDist, "index.html"));
    });
  }

  function isDm(socket) {
    const token = socket.data.dmToken;
    return Boolean(token && dmSessions.has(token));
  }

  function resumeDmSession(socket, token) {
    if (typeof token !== "string" || !dmSessions.has(token)) return false;
    socket.data.dmToken = token;
    dmSessions.set(token, Date.now());
    return true;
  }

  function sendSnapshot(snapshot = database.snapshot()) {
    io.emit("state:snapshot", snapshot);
    return snapshot;
  }

  io.on("connection", (socket) => {
    resumeDmSession(socket, socket.handshake.auth?.dmToken);
    socket.emit("state:snapshot", database.snapshot());
    socket.emit("dm:status", { isDm: isDm(socket) });

    socket.on("state:request", (acknowledge) => {
      respond(acknowledge, { ok: true, snapshot: database.snapshot(), isDm: isDm(socket) });
    });

    socket.on("dm:resume", (payload, acknowledge) => {
      const resumed = resumeDmSession(socket, payload?.token);
      socket.emit("dm:status", { isDm: resumed });
      respond(acknowledge, {
        ok: resumed,
        isDm: resumed,
        error: resumed ? undefined : "The DM session has expired. Enter the password again.",
      });
    });

    socket.on("dm:login", (payload, acknowledge) => {
      if (!safePasswordMatch(payload?.password, dmPassword)) {
        respond(acknowledge, { ok: false, error: "Incorrect DM password." });
        return;
      }

      const token = crypto.randomBytes(32).toString("base64url");
      dmSessions.set(token, Date.now());
      socket.data.dmToken = token;
      socket.emit("dm:status", { isDm: true });
      respond(acknowledge, { ok: true, token });
    });

    socket.on("dm:logout", (_payload, acknowledge) => {
      if (socket.data.dmToken) dmSessions.delete(socket.data.dmToken);
      socket.data.dmToken = null;
      socket.emit("dm:status", { isDm: false });
      respond(acknowledge, { ok: true });
    });

    socket.on("combatant:add", (payload, acknowledge) => {
      try {
        const combatant = normalizeCombatant(payload);
        const id = crypto.randomUUID();
        const playerControlled = !isDm(socket);
        const snapshot = database.commit((db) => {
          db.prepare(`
            INSERT INTO combatants (
              id, name, initiative_roll, initiative_modifier, ac,
              hp_current, hp_max, player_controlled, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            id,
            combatant.name,
            combatant.initiativeRoll,
            combatant.initiativeModifier,
            combatant.ac,
            combatant.hpCurrent,
            combatant.hpMax,
            Number(playerControlled),
            new Date().toISOString(),
          );
        });
        sendSnapshot(snapshot);
        respond(acknowledge, { ok: true, id, revision: snapshot.revision });
      } catch (error) {
        respond(acknowledge, { ok: false, error: serializeError(error) });
      }
    });

    socket.on("combatant:update", (payload, acknowledge) => {
      try {
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

    socket.on("combatant:set-player-controlled", (payload, acknowledge) => {
      try {
        if (!isDm(socket)) throw new ValidationError("Only the DM can change control.");
        if (typeof payload?.id !== "string" || typeof payload?.playerControlled !== "boolean") {
          throw new ValidationError("Invalid control change.");
        }
        const snapshot = database.commit((db) => {
          const result = db
            .prepare("UPDATE combatants SET player_controlled = ? WHERE id = ?")
            .run(Number(payload.playerControlled), payload.id);
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
    close() {
      dmSessions.clear();
      io.close();
    },
  };
}
