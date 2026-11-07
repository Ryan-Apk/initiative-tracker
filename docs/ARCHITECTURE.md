# Architecture

A React client and an Express/Socket.IO server, talking over one WebSocket connection. The server owns all state; SQLite is the only durable store.

## Big picture

```mermaid
graph LR
    subgraph Browser
        UI["React UI<br/>(InitiativeTracker, RollerPage)"]
        Transport["socket.js<br/>(commands, hooks)"]
        UI --> Transport
    end

    Transport <-->|Socket.IO<br/>events + ack| Server

    subgraph Node process
        Server["app.js<br/>event handlers"]
        Domain["domain.js<br/>validation, redaction"]
        DB["database.js<br/>SQLite (better-sqlite3)"]
        Server --> Domain
        Server --> DB
    end
```

- **One connection, one source of truth.** The client never computes combat state; it sends commands and renders whatever snapshot the server pushes back.
- **Every mutation follows the same path:** validate in `domain.js` → write in one SQLite transaction → broadcast a fresh snapshot to everyone, redacted per viewer (players don't see hidden enemy stats).
- **DM login** mints a random token held in memory on the server (`Map` of token → last-used time) and in the browser's `sessionStorage`. No DB row, no JWT — restarting the server logs every DM out.
- **Static files**: in production, the same Node process also serves the built client and `/api/health`; there's no separate API origin.

## Data

```mermaid
erDiagram
    tracker_meta {
        int singleton PK
        int revision
        int schema_version
        bool player_locked
    }
    combatants {
        text id PK
        text name
        int initiative_roll
        int initiative_modifier
        int ac
        int hp_current
        int hp_max
        bool player_controlled
        int map_number
        bool ac_visible
        text conditions
    }
    rollHistory {
        int id PK
        text tableName
        int roll
        int count
        text description
    }
    rollerTableMetadata {
        int id PK
        text tableName
        int entryCount
    }
```

- `tracker_meta` is a single row (`singleton = 1`): the current revision number and the player-editing lock.
- `combatants` is the whole encounter. `player_controlled` decides who may edit a row; `map_number` is a stable label assigned only to enemies.
- Roller tables (`rollerTableMetadata` + one generated table per `.txt` file in `server/data/`) and `rollHistory` are a separate feature (the dice-roller page) and don't reference `combatants`.

Nothing else: no foreign keys between these tables, no joins across them at read time — each snapshot read is a flat `SELECT * FROM combatants`.
