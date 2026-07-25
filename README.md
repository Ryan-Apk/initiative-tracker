# Rivergate Initiative Tracker

A live initiative board for the Rivergate table. The browser application is Vite, React, and Tailwind; an Express/Socket.IO server owns the canonical state and persists it to SQLite.

## Development

Use Node 22 and npm. Create the local environment before starting:

```bash
cp .env.development.example .env
# Replace DM_PASSWORD with a long random value
npm install
npm run dev:check
npm run dev
```

Open `http://localhost:5173`.

`npm run dev` is a coordinated launcher, not two unrelated background commands. It:

1. validates the password, ports, origins, and database configuration;
2. starts the backend on `DEV_SERVER_PORT` (default `3001`);
3. waits for `http://127.0.0.1:3001/api/health` to succeed;
4. starts Vite on `DEV_CLIENT_PORT` (default `5173`);
5. proxies `/api` and `/socket.io` to that exact backend port; and
6. stops both processes if either one fails.

The backend log prints its mode, listener, health URL, and SQLite path. Vite uses `strictPort`, so an occupied frontend port produces a useful failure instead of silently selecting a different origin.

Development variables are loaded from `.env.development.local`, `.env.development`, then `.env`, with the first defined value winning. `PORT` is production-only and is deliberately ignored by development; use `DEV_SERVER_PORT` to change the local backend.

| Development variable | Default | Purpose |
| --- | --- | --- |
| `DM_PASSWORD` | Required | Shared DM password; server only, minimum 12 characters |
| `DEV_CLIENT_PORT` | `5173` | Vite browser port |
| `DEV_SERVER_PORT` | `3001` | Express and Socket.IO port |
| `DEV_CLIENT_HOST` | `0.0.0.0` | Vite bind address; allows LAN clients |
| `DEV_CLIENT_ORIGINS` | localhost and 127.0.0.1 on the client port | Exact origins Socket.IO accepts |
| `DEV_SERVER_ORIGIN` | `http://127.0.0.1:DEV_SERVER_PORT` | Advanced Vite proxy override |
| `DATABASE_PATH` | `./data/initiative.sqlite` | Development SQLite file |

Useful commands:

```bash
npm test
npm run build
npm run dev:check
npm run start:check
```

## Productio

Production is deliberately same-origin:

- the browser loads `https://init.example.com`;
- Socket.IO connects to `/socket.io` on that same origin;
- the reverse proxy terminates TLS and forwards all HTTP and WebSocket traffic to the Node container; and
- Node serves the built Vite files, `/api/health`, and Socket.IO from one port.

There is no production API URL in the client bundle.

### Docker Compose

Set secrets and start the service:

```bash
export DM_PASSWORD='use-a-long-random-password'
export PUBLIC_ORIGIN='https://init.example.com'
docker compose up --build -d
```

Compose binds Node to `127.0.0.1:3000`, so it is reachable by a reverse proxy on the host but not directly exposed to the internet. The named `initiative-data` volume persists `/data/initiative.sqlite`.

Production variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DM_PASSWORD` | Required | Server-only shared DM password |
| `PUBLIC_ORIGIN` | Required by Node; Compose defaults to the intended HTTPS subdomain | Exact accepted browser origin |
| `PORT` | `3000` | Container HTTP/Socket.IO port |
| `HOST` | `0.0.0.0` | Container bind address |
| `TRUST_PROXY` | `1` in Compose | Trust exactly the fronting reverse-proxy hop |
| `DATABASE_PATH` | `/data/initiative.sqlite` | SQLite file on the mounted volume |

This implementation does not use a cookie session framework, so there is no `SESSION_SECRET`. A successful DM login creates a random capability token held in browser `sessionStorage` and in the server’s memory. Restarting Node logs every DM out without losing combat data.

### DNS, TLS, and reverse proxy

Before public use:

1. Point the `init` A/AAAA record for `example.com` to the server.
2. Obtain a valid TLS certificate for `init.example.com`.
3. Proxy the entire origin—including `/socket.io`—to `127.0.0.1:3000`.
4. Preserve the host and forwarding headers, and enable WebSocket upgrades.
5. Do not serve the Vite `dist` folder separately; Node must receive Socket.IO traffic.

Example Caddy configuration:

```caddy
init.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy handles HTTPS and WebSocket upgrades automatically.

Equivalent Nginx location:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

Run one application replica. SQLite and in-memory DM sessions are intentionally single-server. Back up the Docker volume if the encounter state matters. Do not place `DM_PASSWORD` in the Dockerfile, Compose file, Vite variables, source code, or Git.

## Tracker behaviour

- Anyone can add a combatant. Entries added outside DM mode begin player-controlled.
- Any client can edit player-controlled entries. Only the DM can edit DM-controlled entries, reclassify, remove, or clear.
- The DM can persistently lock player editing. While locked, public clients cannot add or edit anything; the DM retains full control.
- Initiative Roll stores the unmodified base roll. The server calculates and sorts by Roll + Modifier, then uses modifier, name, and UUID to break ties.
- DM-controlled entries receive the lowest available map number. These stable numerals are independent of initiative order and reused after deletion.
- Public clients see exact HP only for player-controlled entries. Enemies expose a derived word/colour health state while current and maximum HP remain server-redacted.
- Enemy base rolls and modifiers are private; public clients receive only the calculated initiative total.
- Enemy AC begins hidden. The DM can reveal it per enemy or show/hide all current enemy AC values in one action.
- Edits commit on blur or Enter; Escape cancels.
- The server sorts by calculated initiative total descending, modifier descending, case-insensitive name ascending, then UUID.
- Every accepted mutation increments a persisted revision and broadcasts a complete canonical snapshot.
- Field updates are partial. Concurrent edits to different fields merge; the last server-received edit wins for the same field.
- Controls are disabled offline, mutations are volatile, and reconnecting replaces local drafts with the current server snapshot.
- HP rows are neutral if either HP value is missing; black at 0 or below; red above 0 through 25%; orange above 25% through below 50%; yellow from 50% through below 75%; and green at 75% or above. Current HP may exceed maximum and its color ratio caps at 100%.

Names are required and limited to 80 characters. Initiative and modifier must be whole numbers. AC is optional and non-negative. Current HP is an optional whole number; maximum HP is an optional positive whole number. Server validation errors are returned through Socket.IO acknowledgements and displayed in the UI.

## Security limitations

This remains a temporary table tool:

- anyone who knows the password can become a DM;
- DM sessions disappear whenever Node restarts;
- there is no user identity, rate limiting, audit history, or multi-replica coordination;
- the origin restriction is not a substitute for authentication; and
- HTTPS/WSS is mandatory outside a trusted local network.

For a permanent public service, replace the shared password with user accounts, login throttling, durable server-side sessions, authorization auditing, and a database suitable for multiple replicas.
